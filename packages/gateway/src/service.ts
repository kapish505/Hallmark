import { Wallet } from "ethers";
import type { FacilitatorClient } from "@x402/core/server";
import {
  connect,
  formatHbar,
  ifaces,
  logger,
  makeLogSource,
  MirrorNode,
  modelIdOf,
  TxSender,
  wireUnitsForChain,
  type Contracts,
  type NormSpec,
  type Task,
  makeProvider,
  rpcUrls,
} from "@hallmark/shared";
import { HallmarkAgent } from "@hallmark/buyer-agent";
import { modelIdOfKey, selectManifests, type Manifest as ModelManifest } from "@hallmark/model-spec";
import { createApp, type TaskConfig } from "./app.js";
import { CanaryRunner, loadCanaries, type CanaryBuyer } from "./canary.js";
import { DemoController } from "./demo.js";
import { BlobStore } from "./blobs.js";
import { Db } from "./db.js";
import type { GatewayEnv } from "./env.js";
import { Indexer } from "./indexer.js";
import { Keeper } from "./keeper.js";
import { Pipeline } from "./pipeline.js";
import { EvmRefunder, HederaRefunder, type Refunder } from "./refund.js";
import { buildPaymentMiddleware } from "./x402.js";

const log = logger("gateway");

/**
 * Read each served model's registry entry and quote from the contracts. Prices are never configured by
 * hand: the manifest says which models and how to take their input; the chain says what they cost.
 */
export async function loadTasks(contracts: Contracts, manifests: ModelManifest[]): Promise<TaskConfig[]> {
  const out: TaskConfig[] = [];
  const auditBps = Number((await contracts.core.getParams()).auditBps);
  for (const manifest of manifests) {
    const task = manifest.task;
    const modelId = modelIdOfKey(manifest.modelKey);
    const m = await contracts.registry.get(modelId);
    if (BigInt(m.fee) === 0n) continue; // not registered
    const [price, bond, , available] = await contracts.core.quote(modelId);
    out.push({
      task,
      manifest,
      modelKey: manifest.modelKey,
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


/** Wire every gateway component. Tests and the local e2e inject the facilitator/refunder. */
export async function buildGateway(
  env: GatewayEnv,
  o: { facilitator: FacilitatorClient; facilitatorUrl: string; refunder?: Refunder },
) {
  const provider = makeProvider(rpcUrls(env.RPC_URL, env.RPC_FALLBACK_URLS), env.CHAIN_ID, { thirdwebSecretKey: env.THIRDWEB_SECRET_KEY });
  const wallet = new Wallet(env.GATEWAY_PRIVATE_KEY, provider);
  const contracts = connect(env, wallet);
  const sender = new TxSender(wallet, { defaultGasLimit: env.GAS_LIMIT_DEFAULT });
  const units = wireUnitsForChain(env.CHAIN_ID);
  const db = new Db(env.DB_PATH);
  const mirror = env.LOG_SOURCE === "mirror" ? new MirrorNode(env.MIRROR_NODE_URL) : null;
  const manifests = selectManifests(env.MODELS_DIR, env.MODELS);
  const tasks = await loadTasks(contracts, manifests);
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
    locator: env.PUBLIC_URL,
    verifySettlement: env.VERIFY_SETTLEMENT && mirror !== null,
  });
  const makeMiddleware = () =>
    buildPaymentMiddleware({
      facilitator: o.facilitator,
      payTo,
      routes: tasks.filter((t) => t.available).map((t) => ({ path: t.manifest.endpoint, priceTinybar: t.priceTinybar, description: `Hallmark ${t.manifest.description} Bond-backed, sampled re-run; a failed check refunds you.` })),
      onSettled: (s) => pipeline.onSettled(s.jobId, s.payer, s.transaction),
    });
  let current = makeMiddleware();
  const paymentMiddleware: Parameters<typeof createApp>[0]["paymentMiddleware"] = (req, res, next) => current(req, res, next);

  const operatorControl: Record<string, string> = {};
  for (const pair of env.OPERATOR_CONTROL_URLS.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [addr, url] = pair.split("=");
    if (addr && url) operatorControl[addr.toLowerCase()] = url.replace(/\/$/, "");
  }

  // canary jobs: a separate buyer account paying through the same public x402 path
  let canaryBuyer: CanaryBuyer | null = null;
  const canary = new CanaryRunner({
    db,
    set: env.CANARY_ACCOUNT_ID && env.CANARY_PRIVATE_KEY ? loadCanaries(env.CANARY_DIR, manifests) : [],
    price: (t) => tasks.find((x) => x.task === t && x.available)?.priceTinybar ?? null,
    cfg: { perDay: env.CANARY_PER_DAY, maxSpendPerDayTinybar: BigInt(env.CANARY_MAX_SPEND_PER_DAY_TINYBAR), noRepeat: 10, maxError: env.CANARY_MAX_ERROR },
    buyer: async () => {
      if (canaryBuyer) return canaryBuyer;
      const max = tasks.reduce((m, t) => (t.priceTinybar > m ? t.priceTinybar : m), 0n) * 2n;
      const agent = await HallmarkAgent.hedera({
        gatewayUrl: env.PUBLIC_URL,
        accountId: env.CANARY_ACCOUNT_ID!,
        privateKey: env.CANARY_PRIVATE_KEY!,
        rpcUrl: env.RPC_URL,
        rpcFallbackUrls: env.RPC_FALLBACK_URLS,
        thirdwebSecretKey: env.THIRDWEB_SECRET_KEY,
        policy: { maxPricePerCallTinybar: max, sessionBudgetTinybar: max * 10_000n },
      });
      canaryBuyer = {
        run: async (task, input) => {
          const r = await agent.run(task, input, { mode: "require-final", timeoutMs: 20 * 60_000 });
          return { jobId: r.jobId, text: r.text, status: r.status, badge: r.badge };
        },
      };
      return canaryBuyer;
    },
  });

  const demo = new DemoController({
    contracts,
    owner: env.DEMO_MODE && env.DEMO_OWNER_PRIVATE_KEY ? new TxSender(new Wallet(env.DEMO_OWNER_PRIVATE_KEY, provider), { defaultGasLimit: env.GAS_LIMIT_DEFAULT }) : null,
    units,
    operatorControl,
    token: env.DEMO_CONTROL_TOKEN ?? "",
    refreshPrices: () => refreshPrices(),
  });
  indexer.bus.on("event", (e: { name: string; jobId: string | null; args: Record<string, unknown> }) => {
    if (e.name === "StatusChanged" && Number(e.args.status) === 5 && e.jobId && db.job(e.jobId)) {
      void demo.maybeChallenge(e.jobId).catch((err) => log.warn("demo challenge failed", { error: String(err) }));
    }
  });

  const app = createApp({
    db,
    contracts,
    indexer,
    blobs,
    paymentMiddleware,
    tasks: () => tasks,
    manifests,
    canary,
    demo,
    direct: mirror
      ? { lookup: (h) => mirror.evmTransfer(h), onPaid: (jobId, payer, settleTx) => pipeline.onSettled(jobId, payer, settleTx),
          onUnacceptable: (jobId, payer, settleTx) => {
            db.update(jobId, { payment_status: "RefundPending", payer, settle_tx: settleTx });
            void pipeline.refund(jobId);
          },
        }
      : undefined,
    cfg: {
      publicUrl: env.PUBLIC_URL,
      payTo,
      payToEvm: wallet.address,
      chainId: env.CHAIN_ID,
      hashscanUrl: env.HASHSCAN_URL,
      facilitatorUrl: o.facilitatorUrl,
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
    const fresh = await loadTasks(contracts, manifests);
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
    canary,
    demo,
    refreshPrices,
    start() {
      indexer.start();
      if (env.KEEPER) keeper.start();
      canary.start();
      timers.push(setInterval(() => void refreshPrices().catch((e) => log.warn("price refresh failed", { error: String(e) })), env.PRICE_REFRESH_MS));
      timers.push(setInterval(() => void pipeline.retryStuck().catch((e) => log.warn("retry failed", { error: String(e) })), 15_000));
      return app.listen(env.PORT, () => log.info(`listening on :${env.PORT}`, { payTo, facilitator: o.facilitatorUrl }));
    },
    stop() {
      indexer.stop();
      keeper.stop();
      canary.stop();
      for (const t of timers) clearInterval(t);
    },
  };
}
