import { Wallet } from "ethers";
import { connect, ifaces, makeLogSource, makeProvider, rpcUrls, TxSender, type ChainEnv, type Task } from "@hallmark/shared";
import { EvidenceClient } from "./evidence.js";
import { HttpWorker } from "./worker.js";

/** Shared wiring for the operator and challenger processes. */
export async function wire(
  env: ChainEnv & { GATEWAY_URL: string; ASR_WORKER_URL?: string; OCR_WORKER_URL?: string },
  privateKey: string,
  startCursor: string | null,
) {
  const provider = makeProvider(rpcUrls(env.RPC_URL, env.RPC_FALLBACK_URLS), env.CHAIN_ID);
  const wallet = new Wallet(privateKey, provider);
  const contracts = connect(env, wallet);
  const sender = new TxSender(wallet, { defaultGasLimit: env.GAS_LIMIT_DEFAULT });
  // first start: follow only new jobs (do not replay history)
  let cursor = startCursor;
  if (!cursor) cursor = env.LOG_SOURCE === "mirror" ? `${Math.floor(Date.now() / 1000)}.000000000` : String(await provider.getBlockNumber());
  const source = makeLogSource(env.LOG_SOURCE, {
    mirrorUrl: env.MIRROR_NODE_URL,
    provider,
    watched: [{ address: env.HALLMARK_ADDRESS, iface: ifaces.core }],
    startCursor: cursor,
  });
  const urls: Partial<Record<Task, string>> = {};
  if (env.ASR_WORKER_URL) urls.asr = env.ASR_WORKER_URL;
  if (env.OCR_WORKER_URL) urls.ocr = env.OCR_WORKER_URL;
  const evidenceBase = env.GATEWAY_URL.replace(/\/$/, "");
  return {
    provider,
    wallet,
    contracts,
    sender,
    source,
    worker: new HttpWorker(urls),
    tasks: Object.keys(urls) as Task[],
    evidence: new EvidenceClient(evidenceBase, wallet),
    evidenceBase,
  };
}
