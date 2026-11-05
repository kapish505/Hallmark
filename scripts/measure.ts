/**
 * M-series measurements from REAL testnet runs (docs/e2e/testnet-*.json):
 *  M3 HBAR fee + gas per transaction type (Mirror Node charged_tx_fee), chain cost per job (HBAR + USD)
 *  M4 paid -> provisional / final latency
 *  M7 cheats caught
 * Writes docs/measurements.json. Every number written here is "measured"; copy into MEASUREMENTS.md.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS, MirrorNode, sleep } from "../packages/shared/src/index.js";

const dir = join(import.meta.dirname, "../docs/e2e");
const files = readdirSync(dir).filter((f) => f.startsWith("testnet-") && f.endsWith(".json"));
if (!files.length) throw new Error("no docs/e2e/testnet-*.json yet — run scripts/e2e-testnet.ts first");
const mirror = new MirrorNode(process.env.MIRROR_NODE_URL ?? DEFAULTS.mirrorNodeUrl);
const centsPerHbar = await mirror.exchangeRateCentsPerHbar();

const byType: Record<string, { fees: number[]; gas: number[] }> = {};
const perJob: Array<{ scenario: string; totalFeeTinybar: number; seconds: number }> = [];
let caught = 0;
let cheatsAttempted = 0;
const contractTypeOf = (name: string) =>
  ({ JobCreated: "createJob", Committed: "commit", AuditDrawn: "drawAudit", Revealed: "reveal", TextPosted: "postText", Compared: "compare", CommitteeDrawn: "compare->committee", Resolved: "resolve", JobSettled: "settle", Challenged: "challenge", JobRefunded: "expire/refund" } as Record<string, string>)[name];

for (const f of files) {
  const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const seen = new Set<string>();
  let total = 0;
  for (const e of rec.events as Array<{ name: string; tx: string }>) {
    const type = contractTypeOf(e.name);
    if (!type || seen.has(e.tx)) continue;
    seen.add(e.tx);
    for (let i = 0; i < 5; i++) {
      try {
        const f = await mirror.feeForEvmTx(e.tx);
        const fee = f.chargedFeeTinybar;
        (byType[type] ??= { fees: [], gas: [] }).fees.push(fee);
        byType[type].gas.push(f.gasUsed);
        total += fee;
        break;
      } catch {
        await sleep(1000);
      }
    }
  }
  perJob.push({ scenario: rec.scenario, totalFeeTinybar: total, seconds: rec.seconds });
  if (["garbage", "replay-other-input", "lazy-small-model", "lazy-engine", "truncate", "collude-challenge"].includes(rec.scenario)) {
    cheatsAttempted++;
    if (rec.pass) caught++;
  }
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const out = {
  measuredAt: new Date().toISOString(),
  exchangeRateCentsPerHbar: centsPerHbar,
  M3_perTxType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { n: v.fees.length, avgFeeTinybar: avg(v.fees), avgGas: avg(v.gas) }])),
  M3_perJob: perJob.map((j) => ({ ...j, totalFeeHbar: j.totalFeeTinybar / 1e8, totalFeeUsd: (j.totalFeeTinybar / 1e8) * centsPerHbar / 100 })),
  M4_latencySeconds: perJob.map((j) => ({ scenario: j.scenario, paidToFinal: j.seconds })),
  M7_cheatsCaught: { caught, attempted: cheatsAttempted },
  provenance: "measured (Hedera testnet, Mirror Node charged_tx_fee)",
};
writeFileSync(join(import.meta.dirname, "../docs/measurements.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
