#!/usr/bin/env -S npx tsx
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatHbar, hbarToTinybar } from "@hallmark/shared";
import { HallmarkAgent } from "./agent.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    gateway: { type: "string", default: process.env.GATEWAY_URL },
    task: { type: "string" },
    validator: { type: "string" },
    "max-price": { type: "string", default: process.env.AGENT_MAX_PRICE_HBAR },
    budget: { type: "string", default: process.env.AGENT_BUDGET_HBAR },
    "allow-pay-to": { type: "string", default: process.env.AGENT_ALLOWED_PAY_TO },
    "require-final": { type: "boolean", default: false },
    "accept-provisional": { type: "boolean", default: false },
    rpc: { type: "string", default: process.env.RPC_URL },
  },
});

const usage = `usage: hallmark-agent <input.wav|input.png> --gateway URL --max-price HBAR --budget HBAR
       [--task asr|ocr] [--require-final | --accept-provisional] [--validator min_words:5|date_iso|amount_present|invoice_total]
env: BUYER_ACCOUNT_ID, BUYER_PRIVATE_KEY (ECDSA, testnet)`;
const file = positionals[0];
if (!file || !values.gateway || !values["max-price"] || !values.budget) {
  console.error(usage);
  process.exit(2);
}
const accountId = process.env.BUYER_ACCOUNT_ID;
const privateKey = process.env.BUYER_PRIVATE_KEY;
if (!accountId || !privateKey) {
  console.error("BUYER_ACCOUNT_ID and BUYER_PRIVATE_KEY must be set");
  process.exit(2);
}
const task = (values.task ?? (file.toLowerCase().endsWith(".png") ? "ocr" : "asr")) as "asr" | "ocr";

const agent = await HallmarkAgent.hedera({
  gatewayUrl: values.gateway.replace(/\/$/, ""),
  accountId,
  privateKey,
  rpcUrl: values.rpc,
  policy: {
    maxPricePerCallTinybar: hbarToTinybar(values["max-price"]),
    sessionBudgetTinybar: hbarToTinybar(values.budget),
    allowedPayTo: values["allow-pay-to"]?.split(",").map((s) => s.trim()),
  },
});
const m = await agent.discover();
console.log(`discovered ${m.name} ${m.version}, payTo ${m.payTo}`);
for (const t of m.tasks) {
  console.log(`  ${t.task}  ${formatHbar(BigInt(t.priceTinybar)).padEnd(16)} audit ${t.auditBps / 100}%  bond ${formatHbar(BigInt(t.bondTinybar))}  ${t.class}${t.available ? "" : "  (unavailable)"}`);
}
try {
  const r = await agent.run(task, new Uint8Array(readFileSync(file)), {
    filename: file.split("/").pop(),
    mode: values["require-final"] ? "require-final" : "accept-provisional",
    validator: values.validator,
  });
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  console.log("spending summary:", JSON.stringify(agent.spend.summary(), null, 2));
}
