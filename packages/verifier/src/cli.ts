#!/usr/bin/env -S npx tsx
import { JsonRpcProvider } from "ethers";
import { z } from "zod";
import { DEFAULTS, loadEnv, zEnv } from "@hallmark/shared";
import { verifyJob } from "./verify.js";

const jobId = process.argv[2];
const tokenIdx = process.argv.indexOf("--token");
const token = tokenIdx > 0 ? process.argv[tokenIdx + 1] : process.env.BUYER_ACCESS_TOKEN;
if (!jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobId)) {
  console.error("usage: hallmark-verify <jobId> [--token <buyer access token>]  (without a token the text checks are skipped)");
  process.exit(2);
}
const env = loadEnv(
  z.object({
    RPC_URL: z.string().url().default(DEFAULTS.rpcUrl),
    CHAIN_ID: z.coerce.number().default(296),
    HALLMARK_ADDRESS: zEnv.address,
    JUDGE_ADDRESS: zEnv.address,
    REGISTRY_ADDRESS: zEnv.address,
    GATEWAY_URL: z.string().url(),
  }),
);
const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
const results = await verifyJob(jobId, { provider, addresses: env, gatewayUrl: env.GATEWAY_URL.replace(/\/$/, ""), token });
for (const r of results) console.log(`${r.result.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
const failed = results.filter((r) => r.result === "FAIL").length;
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exitCode = failed ? 1 : 0;
