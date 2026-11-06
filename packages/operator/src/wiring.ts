import { Wallet } from "ethers";
import { selectManifests, workerUrls } from "@hallmark/model-spec";
import { connect, ifaces, makeLogSource, makeProvider, rpcUrls, TxSender, type ChainEnv } from "@hallmark/shared";
import { EvidenceClient } from "./evidence.js";
import { HttpWorker } from "./worker.js";

/** Shared wiring for the operator and challenger processes. */
export async function wire(
  env: ChainEnv & { GATEWAY_URL: string },
  privateKey: string,
  startCursor: string | null,
) {
  const provider = makeProvider(rpcUrls(env.RPC_URL, env.RPC_FALLBACK_URLS), env.CHAIN_ID, { thirdwebSecretKey: env.THIRDWEB_SECRET_KEY });
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
  // models come from manifests; each manifest names the env var that holds its worker URL on this host
  const models = selectManifests(env.MODELS_DIR, env.MODELS);
  const urls = workerUrls(models);
  const evidenceBase = env.GATEWAY_URL.replace(/\/$/, "");
  return {
    provider,
    wallet,
    contracts,
    sender,
    source,
    worker: new HttpWorker(urls),
    models,
    tasks: Object.keys(urls),
    evidence: new EvidenceClient(evidenceBase, wallet),
    evidenceBase,
  };
}
