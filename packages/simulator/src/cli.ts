import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatHbar } from "@hallmark/shared";
import { analyse, fmtCeiling, parseMeasurements } from "./model.js";

const { values } = parseArgs({
  options: {
    file: { type: "string", default: join(import.meta.dirname, "../../../docs/MEASUREMENTS.md") },
    p: { type: "string" },
    sweep: { type: "boolean", default: false },
  },
});
const m = parseMeasurements(readFileSync(values.file!, "utf8"));
const p = values.p ? Number(values.p) : m.auditBps.value;
const minBond = BigInt(Math.round(m.minBond.value));
console.log(`audit rate p = ${p / 100}%  (${values.p ? "command line" : m.auditBps.source})   compute multiplier 1 + p = ${(1 + p / 10_000).toFixed(2)}x  [assumed: one re-run per audit]`);
console.log(`minBond ${formatHbar(minBond)} (${m.minBond.source})\n`);
for (const t of m.tasks) {
  const a = analyse(t, p, minBond);
  const tag = a.allMeasured ? "MEASURED" : `NOT MEASURED (inputs: ${a.sources.join(", ")})`;
  console.log(`== ${t.task.toUpperCase()}  class ${t.class.value}${t.class.value === "TOLERANCE" ? ` tau ${t.tauBps.value} bps` : ""}  [${tag}]`);
  console.log(`   F ${formatHbar(BigInt(Math.round(t.fee.value)))}  m ${formatHbar(a.margin)}  fp ${t.fpBps.value} bps`);
  for (const c of t.cheats) console.log(`   cheat ${c.name.padEnd(22)} c' ${formatHbar(BigInt(Math.round(c.c.value))).padEnd(16)} pi' ${c.piBps.value} bps (${c.piBps.source})`);
  console.log(`   deterrence floor  ${formatHbar(a.floor)}  (worst cheat: ${a.worst.name})`);
  console.log(`   fairness ceiling  ${fmtCeiling(a.ceiling)}`);
  console.log(a.empty ? "   !! WINDOW EMPTY: no bond deters the worst cheat without punishing honest operators; do not enable" : "   window OK");
  if (values.sweep) {
    for (const q of [500, 1000, 2000, 3000, 5000, 10_000]) {
      const s = analyse(t, q, minBond);
      console.log(`     p ${String(q / 100).padStart(3)}%  floor ${formatHbar(s.floor).padEnd(18)} ceiling ${fmtCeiling(s.ceiling).padEnd(18)} ${s.empty ? "EMPTY" : "ok"}`);
    }
  }
  console.log();
}
