import { loadEnv, logger, type Task } from "@hallmark/shared";
import { HallmarkAgent } from "@hallmark/buyer-agent";
import { GatewayEnv } from "./env.js";
import { buildGateway } from "./service.js";
import { chooseFacilitator, httpFacilitator } from "./x402.js";

const log = logger("gateway");
const env = loadEnv(GatewayEnv);
if (!env.GATEWAY_ACCOUNT_ID && env.LOG_SOURCE === "mirror") throw new Error("GATEWAY_ACCOUNT_ID (x402 payTo + refund sender) is required on Hedera");

const urls = env.FACILITATOR_URL ? [env.FACILITATOR_URL] : env.FACILITATOR_URLS.split(",").map((s) => s.trim());
const { url } = await chooseFacilitator(urls);

let tryIt: ((t: Task, b: Uint8Array) => Promise<unknown>) | undefined;
let agent: HallmarkAgent | null = null;
let maxPrice = 0n;
const demoAccount = process.env.DEMO_BUYER_ACCOUNT_ID;
if (env.DEMO_MODE && demoAccount && env.DEMO_BUYER_PRIVATE_KEY) {
  if (demoAccount === env.GATEWAY_ACCOUNT_ID) throw new Error("demo buyer must differ from payTo (edge case 5)");
  const privateKey = env.DEMO_BUYER_PRIVATE_KEY;
  // created on first use: the agent discovers this gateway's own manifest, so it must be listening
  tryIt = async (task, bytes) => {
    agent ??= await HallmarkAgent.hedera({
      gatewayUrl: env.PUBLIC_URL,
      accountId: demoAccount,
      privateKey,
      policy: { maxPricePerCallTinybar: maxPrice, sessionBudgetTinybar: maxPrice * 1000n },
    });
    return agent.run(task, bytes, { mode: "accept-provisional", timeoutMs: 300_000 });
  };
  log.info("demo 'Try it' enabled (sponsored by a testnet demo account)");
}

const gw = await buildGateway(env, { facilitator: httpFacilitator(url), facilitatorUrl: url, tryIt });
maxPrice = gw.tasks.reduce((m, t) => (t.priceTinybar > m ? t.priceTinybar : m), 0n);
gw.start();
