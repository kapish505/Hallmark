#!/usr/bin/env node
/**
 * hallmark-calibrate <manifest.json> <dataset-dir> --workers <url,url> [--runs 20] [--cheat-runs 3]
 *                    --honest-cost-tinybar N [--audit-bps 3000] [--min-bond 10000000] [--out file]
 *
 * Gate G3 for a candidate model. Runs the pinned container (each --workers URL should be a DIFFERENT
 * machine running the SAME image digest) on every input in <dataset-dir> (files ending in the manifest's
 * input.ext; optional <name>.ref.txt human-checked references for the accuracy figure), then the cheats:
 * the generic ones (empty, garbage, replay of another input) and the manifest's own (`cheats`).
 * Prints the class, tau, false-alarm and catch rates and the bond window, and writes a candidate manifest.
 * It REFUSES to emit an enabled manifest when the window is empty or the model is not coverable.
 *
 * Compute saved by a cheat is a time ratio times --honest-cost-tinybar (an operator estimate, labelled
 * "assumed"). Nothing here proposes or enables anything on chain.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { normalize, type NormSpec } from "@hallmark/shared";
import { calibrate } from "./calibrate.js";
import { describeCeiling, validateManifest } from "./validate.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    workers: { type: "string" },
    runs: { type: "string", default: "20" },
    "cheat-runs": { type: "string", default: "3" },
    "honest-cost-tinybar": { type: "string" },
    "audit-bps": { type: "string", default: "3000" },
    "min-bond": { type: "string", default: "10000000" },
    out: { type: "string" },
  },
});
const [manifestPath, dataDir] = positionals;
if (!manifestPath || !dataDir || !values.workers || !values["honest-cost-tinybar"]) {
  console.error("usage: hallmark-calibrate <manifest.json> <dataset-dir> --workers <url,url> --honest-cost-tinybar N [--runs 20] [--audit-bps 3000] [--out file]");
  process.exit(2);
}
const base = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const spec = base.normSpec as NormSpec;
const workers = values.workers.split(",").map((u) => u.trim().replace(/\/$/, ""));
const runs = Number(values.runs);
const cheatRuns = Number(values["cheat-runs"]);
const honestCost = BigInt(values["honest-cost-tinybar"]);
const files = readdirSync(dataDir).filter((f) => f.endsWith(base.input.ext)).sort();
if (files.length < 8) console.warn(`WARNING: ${files.length} inputs; G3 asks for >= 8`);
if (workers.length < 2) console.warn("WARNING: one machine only; cross-machine agreement is NOT measured (status should stay prelim)");

const norm = (raw: string) => {
  try {
    return normalize(raw, spec).text;
  } catch {
    return "";
  }
};
async function call(url: string, input: Uint8Array, extra: Record<string, string | number> = {}) {
  const form = new FormData();
  form.append("input", new Blob([input]), `input${base.input.ext}`);
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  const t0 = Date.now();
  const r = await fetch(`${url}${base.worker.path}`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { text: string; seconds?: number };
  return { text: norm(j.text), seconds: j.seconds ?? (Date.now() - t0) / 1000 };
}

// ---- honest runs
const inputs = files.map((f) => new Uint8Array(readFileSync(join(dataDir, f))));
const honestRuns: string[][] = [];
const honestSeconds: number[] = [];
for (const [i, f] of files.entries()) {
  const outs: string[] = [];
  let secs = 0;
  for (const w of workers) {
    for (let k = 0; k < runs; k++) {
      const r = await call(w, inputs[i]);
      outs.push(r.text);
      secs += r.seconds;
    }
  }
  honestRuns.push(outs);
  honestSeconds.push(secs / outs.length);
  console.log(`${f}: ${new Set(outs).size} distinct honest output(s) over ${outs.length} runs`);
}
const mode = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0];
const refs = honestRuns.map(mode);

// ---- cheats: generic + the manifest's own
const cost = (saved: number) => (honestCost * BigInt(Math.round(Math.max(0, Math.min(1, saved)) * 1000))) / 1000n;
const cheats: Array<{ name: string; c: bigint; outputs: string[][] }> = [
  { name: "empty", c: honestCost, outputs: refs.map(() => [""]) },
  { name: "garbage", c: honestCost, outputs: refs.map(() => ["lorem ipsum dolor sit amet consectetur"]) },
  { name: "replay-other-input", c: honestCost, outputs: refs.map((_, i) => [refs[(i + 1) % refs.length]]) },
];
for (const [name, c] of Object.entries(base.cheats)) {
  const outputs: string[][] = [];
  let saved = 0;
  let n = 0;
  for (const [i] of files.entries()) {
    const outs: string[] = [];
    for (let k = 0; k < (c.worker ? cheatRuns : 1); k++) {
      const r = c.worker ? await call(workers[0], inputs[i], c.worker) : { text: refs[i], seconds: honestSeconds[i] };
      let text = r.text;
      let secs = r.seconds;
      if (c.keepWords !== undefined) {
        const w = text.split(" ");
        text = w.slice(0, Math.max(1, Math.floor(w.length * c.keepWords))).join(" ");
        if (!c.worker) secs = honestSeconds[i] * c.keepWords;
      }
      outs.push(text);
      saved += honestSeconds[i] > 0 ? 1 - secs / honestSeconds[i] : 1;
      n++;
    }
    outputs.push(outs);
  }
  cheats.push({ name, c: cost(saved / n), outputs });
}

// ---- accuracy against human references (informational)
const unit = (t: string) => (base.accuracy.metric === "WER" ? (t ? t.split(" ") : []) : [...t]);
function edits<T>(a: T[], b: T[]): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
let errs = 0;
let units = 0;
let scored = 0;
for (const [i, f] of files.entries()) {
  try {
    const ref = norm(readFileSync(join(dataDir, f.replace(base.input.ext, ".ref.txt")), "utf8"));
    errs += edits(unit(ref), unit(refs[i]));
    units += unit(ref).length;
    scored++;
  } catch {
    /* no reference for this input */
  }
}

const r = calibrate(base, {
  honestRuns,
  cheats,
  auditBps: Number(values["audit-bps"]),
  minBond: BigInt(values["min-bond"]),
  accuracy: units ? { expectedErrorBps: Math.round((errs / units) * 10_000), sampleSize: scored } : undefined,
  machines: workers.length,
  runs,
});
if (workers.length < 2) r.manifest.calibration.status = "prelim";

console.log(`\n## hallmark-calibrate ${base.modelKey} (${files.length} inputs x ${runs} runs x ${workers.length} machine(s), ${basename(dataDir)})`);
console.log(`honest bit-exact agreement: ${(r.honest.exactAgreement * 100).toFixed(2)}% of ${r.honest.comparisons} pairs`);
console.log(`class ${r.class}${r.class !== "EXACT" ? `  tau ${r.tauBps} bps` : ""}  false alarms ${r.fpBps} bps`);
console.log("| cheat | caught (bps) | compute saved (tinybar, assumed) |\n|---|---|---|");
for (const c of r.perCheat) console.log(`| ${c.name} | ${c.piBps} | ${c.c} |`);
console.log(`worst cheat: ${r.worstCheat}  ->  bond >= ${r.window.bond} tinybar, ceiling ${describeCeiling(r.window.ceiling)} at ${Number(values["audit-bps"]) / 100}% audit`);
if (units) console.log(`accuracy: ${base.accuracy.metric} ${((errs / units) * 100).toFixed(2)}% on ${scored} referenced inputs (informational)`);

const out = values.out ?? manifestPath.replace(/\.json$/, ".calibrated.json");
writeFileSync(out, JSON.stringify(r.manifest, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
if (r.refused) {
  console.log(`\nREFUSED: ${r.refused}\nwrote ${out} with enabled = false (describe only; do not propose it for enabling)`);
  process.exit(1);
}
console.log(`\nwindow holds: wrote ${out} with enabled = true. Next: hallmark-models propose ${out}`);
