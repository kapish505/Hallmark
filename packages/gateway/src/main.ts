import { loadEnv } from "@hallmark/shared";
import { GatewayEnv } from "./env.js";
import { buildGateway } from "./service.js";
import { chooseFacilitator, httpFacilitator } from "./x402.js";

const env = loadEnv(GatewayEnv);
if (!env.GATEWAY_ACCOUNT_ID && env.LOG_SOURCE === "mirror") throw new Error("GATEWAY_ACCOUNT_ID (x402 payTo + refund sender) is required on Hedera");
const urls = env.FACILITATOR_URL ? [env.FACILITATOR_URL] : env.FACILITATOR_URLS.split(",").map((s) => s.trim());
const { url } = await chooseFacilitator(urls);
// no sponsored buyer: people pay with their own wallet (web) and agents with their own key (CLI)
const gw = await buildGateway(env, { facilitator: httpFacilitator(url), facilitatorUrl: url });
gw.start();
