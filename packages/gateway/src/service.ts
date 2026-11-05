import { JsonRpcProvider, Wallet } from "ethers";
import type { FacilitatorClient } from "@x402/core/server";
import {
  connect,
  formatHbar,
  ifaces,
  logger,
  makeLogSource,
  MirrorNode,
  modelIdOf,
  TASK_ENDPOINT,
  TxSender,
  wireUnitsForChain,
  type Contracts,
  type NormSpec,
  type Task,
} from "@hallmark/shared";
import { createApp, type TaskConfig } from "./app.js";
import { BlobStore } from "./blobs.js";
import { Db } from "./db.js";
import type { GatewayEnv } from "./env.js";
import { Indexer } from "./indexer.js";
import { Keeper } from "./keeper.js";
import { Pipeline } from "./pipeline.js";
import { EvmRefunder, HederaRefunder, type Refunder } from "./refund.js";
import { buildPaymentMiddleware } from "./x402.js";

const log = logger("gateway");

/** Read each task's model and quote from the contracts. Prices are never configured by hand. */
export async function loadTasks(contracts: Contracts, keys: Record<Task, string>): Promise<TaskConfig[]> {
  const out: TaskConfig[] = [];
  const auditBps = Number((await contracts.core.getParams()).auditBps);
  for (const task of ["asr", "ocr"] as Task[]) {
    if (!keys[task]) continue;
    const modelId = modelIdOf(keys[task]);
    const m = await contracts.registry.get(modelId);
    if (BigInt(m.fee) === 0n) continue; // not registered
    const [price, bond, , available] = await contracts.core.quote(modelId);
    out.push({
      task,
      modelKey: keys[task],
      modelId,
      priceTinybar: BigInt(price),
      bondTinybar: BigInt(bond),
      cls: Number(m.class),
      tauBps: Number(m.tauBps),
      normSpec: Number(m.normSpec) as NormSpec,
      auditBps,
      expectedErrorBps: Number(m.expectedErrorBps),
      errorSampleSize: Number(m.errorSampleSize),
      available: Boolean(m.enabled) && Boolean(available),
    });
  }
  return out;
}

const DESCRIPTION: Record<Task, string> = {
  asr: "Hallmark speech-to-text (Whisper large-v3, pinned; 16 kHz mono WAV, <= 15 s). Bond-backed, sampled re-run; a failed check refunds you.",
  ocr: "Hallmark OCR (pinned engine; PNG, ASCII text). Bond-backed, sampled re-run; a failed check refunds you.",
};

/** Wire every gateway component. Tests and the local e2e inject the facilitator/refunder. */
export async function buildGateway(
  env: GatewayEnv,
  o: { facilitator: FacilitatorClient; facilitatorUrl: string; refunder?: Refunder; tryIt?: (t: Task, b: Uint8Array) => Promise<unknown> },
) {
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  const wallet = new Wallet(env.GATEWAY_PRIVATE_KEY, provider);
  const contracts = connect(env, wallet);
  const sender = new TxSender(wallet, { defaultGasLimit: env.GAS_LIMIT_DEFAULT });
  const units = wireUnitsForChain(env.CHAIN_ID);
  const db = new Db(env.DB_PATH);
  const mirror = env.LOG_SOURCE === "mirror" ? new MirrorNode(env.MIRROR_NODE_URL) : null;
  const keys: Record<Task, string> = { asr: env.ASR_MODEL_KEY, ocr: env.OCR_MODEL_KEY };
  const tasks = await loadTasks(contracts, keys);
  log.info("tasks", Object.fromEntries(tasks.map((t) => [t.task, { price: formatHbar(t.priceTinybar), bond: formatHbar(t.bondTinybar), available: t.available }])));

  const blobs = new BlobStore(env.BLOB_DIR);
  const source = makeLogSource(env.LOG_SOURCE, {
    mirrorUrl: env.MIRROR_NODE_URL,
    provider,
    watched: [{ address: env.HALLMARK_ADDRESS, iface: ifaces.core }],
    startCursor: db.get("cursor"),
  });
  const indexer = new Indexer({ db, source, pollMs: env.POLL_MS, cursorKey: "cursor", provider, chainId: env.CHAIN_ID, core: env.HALLMARK_ADDRESS });

  const payTo = env.GATEWAY_ACCOUNT_ID ?? wallet.address;
  const refunder = o.refunder ?? (env.GATEWAY_ACCOUNT_ID ? new HederaRefunder(env.GATEWAY_ACCOUNT_ID, env.GATEWAY_PRIVATE_KEY) : new EvmRefunder(wallet, units));
  const pipeline = new Pipeline({
    db,
    contracts,
    sender,
    refunder,
    mirror,
    units,
    gasLimitHeavy: env.GAS_LIMIT_HEAVY,
    verifySettlement: env.VERIFY_SETTLEMENT && mirror !== null,
  });
  const makeMiddleware = () =>
    buildPaymentMiddleware({
      facilitator: o.facilitator,
      payTo,
      routes: tasks.filter((t) => t.available).map((t) => ({ path: TASK_ENDPOINT[t.task], priceTinybar: t.priceTinybar, description: DESCRIPTION[t.task] })),
      onSettled: (s) => pipeline.onSettled(s.jobId, s.payer, s.transaction),
    });
  let current = makeMiddleware();
  const paymentMiddleware: Parameters<typeof createApp>[0]["paymentMiddleware"] = (req, res, next) => current(req, res, next);

  const operatorControl: Record<string, string> = {};
  for (const pair of env.OPERATOR_CONTROL_URLS.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [addr, url] = pair.split("=");
    if (addr && url) operatorControl[addr.toLowerCase()] = url.replace(/\/$/, "");
  }

  const app = createApp({
    db,
    contracts,
    indexer,
    blobs,
    paymentMiddleware,
    tasks: () => tasks,
    tryIt: o.tryIt,
    cfg: {
      publicUrl: env.PUBLIC_URL,
      payTo,
      chainId: env.CHAIN_ID,
      hashscanUrl: env.HASHSCAN_URL,
      facilitatorUrl: o.facilitatorUrl,
      maxAudioSeconds: env.MAX_AUDIO_SECONDS,
      maxAudioBytes: env.MAX_AUDIO_BYTES,
      maxImageBytes: env.MAX_IMAGE_BYTES,
      maxImagePixels: env.MAX_IMAGE_PIXELS,
      rateLimitPerMin: env.RATE_LIMIT_PER_MIN,
      contract: env.HALLMARK_ADDRESS,
      demoMode: env.DEMO_MODE,
      demoControlToken: env.DEMO_CONTROL_TOKEN,
      operatorControl,
      watchers: env.EVIDENCE_WATCHERS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
    },
  });

  const keeper = new Keeper({ db, contracts, sender, pollMs: env.POLL_MS, gasLimitHeavy: env.GAS_LIMIT_HEAVY });
  const timers: NodeJS.Timeout[] = [];

  /** Reload quotes; rebuild the x402 routes when a price or availability changed. */
  async function refreshPrices() {
    const fresh = await loadTasks(contracts, keys);
    const ser = (x: TaskConfig[]) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (ser(fresh) === ser(tasks)) return false;
    tasks.splice(0, tasks.length, ...fresh);
    current = makeMiddleware();
    log.info("task quotes reloaded", Object.fromEntries(tasks.map((t) => [t.task, { price: formatHbar(t.priceTinybar), available: t.available }])));
    return true;
  }

  return {
    app,
    db,
    indexer,
    keeper,
    pipeline,
    contracts,
    tasks,
    refreshPrices,
    start() {
      indexer.start();
      if (env.KEEPER) keeper.start();
      timers.push(setInterval(() => void refreshPrices().catch((e) => log.warn("price refresh failed", { error: String(e) })), env.PRICE_REFRESH_MS));
      timers.push(setInterval(() => void pipeline.retryStuck().catch((e) => log.warn("retry failed", { error: String(e) })), 15_000));
      return app.listen(env.PORT, () => log.info(`listening on :${env.PORT}`, { payTo, facilitator: o.facilitatorUrl }));
    },
    stop() {
      indexer.stop();
      keeper.stop();
      for (const t of timers) clearInterval(t);
    },
  };
}
