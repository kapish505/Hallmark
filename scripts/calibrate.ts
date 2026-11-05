/**
 * Gate G3: determinism and separation (the gate that sets every parameter).
 *
 *   tsx scripts/calibrate.ts --task asr --data data/g3/asr --workers http://m1:9000,http://m2:9000 \
 *        --runs 20 --honest-cost-tinybar 15000000 [--fee-tinybar 20000000]
 *   tsx scripts/calibrate.ts --task ocr --data data/g3/ocr --workers http://m1:9001,http://m2:9001 ...
 *
 * --data holds the inputs (ASR: 16 kHz mono PCM16 .wav, 8-15 s; OCR: .png, <= 96 words of ASCII text)
 * and <name>.ref.txt HUMAN-CHECKED reference texts (add-on A2: accuracy report; never used for the
 * class decision). Reference texts go through the same production normalization as outputs.
 * Each worker URL must be a DIFFERENT machine running the SAME image digest (record it with --digest).
 *
 * Honest agreement: every input x runs x machines. Cheats: ASR tiny/base/small, truncate 60%, empty,
 * garbage, replay of another input; OCR fast engine, 50% downscale, 70% crop, empty, garbage, replay.
 * Writes docs/gates/G3.<task>.json and prints the table for docs/MEASUREMENTS.md.
 * Compute saved by a cheat is measured as a time ratio and converted with --honest-cost-tinybar,
 * which is an operator estimate: it is labelled "assumed" in the output.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { normalize, outputHashOf, overlapText, type NormSpec } from "../packages/shared/src/index.js";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    data: { type: "string" },
    workers: { type: "string" },
    runs: { type: "string", default: "20" },
    "honest-cost-tinybar": { type: "string" },
    "fee-tinybar": { type: "string" },
    digest: { type: "string", default: "unrecorded" },
    "cheat-runs": { type: "string", default: "3" },
    /** output file name under docs/gates (default G3.<task>.json) */
    out: { type: "string" },
  },
});
const task = values.task as "asr" | "ocr";
if ((task !== "asr" && task !== "ocr") || !values.data || !values.workers) {
  console.error("usage: calibrate.ts --task asr|ocr --data <dir> --workers <url,url> [--runs 20] [--honest-cost-tinybar N]");
  process.exit(2);
}
const spec: NormSpec = task === "asr" ? 1 : 2;
const workers = values.workers.split(",").map((u) => u.trim().replace(/\/$/, ""));
const runs = Number(values.runs);
const cheatRuns = Number(values["cheat-runs"]);
const ext = task === "asr" ? ".wav" : ".png";
const files = readdirSync(values.data).filter((f) => f.endsWith(ext)).sort();
if (files.length < 8) console.warn(`WARNING: ${files.length} inputs; G3 asks for >= 8`);

async function call(url: string, input: Uint8Array, extra: Record<string, string> = {}): Promise<{ text: string; seconds: number }> {
  const form = new FormData();
  form.append("input", new Blob([input]), `input${ext}`);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const t0 = Date.now();
  const r = await fetch(`${url}/${task}`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { text: string; seconds?: number };
  return { text: j.text, seconds: j.seconds ?? (Date.now() - t0) / 1000 };
}
const norm = (raw: string) => {
  try {
    return normalize(raw, spec).text;
  } catch (e) {
    return `!!${(e as Error).message}`;
  }
};

const health = await Promise.all(workers.map((w) => fetch(`${w}/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }))));
console.log("workers:", JSON.stringify(health));

// ------------------------------------------------------------ honest runs
interface InputResult {
  name: string;
  outputs: Array<{ machine: number; text: string; seconds: number }>;
  reference: string;
  ref?: string;
}
const inputs: InputResult[] = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(values.data, f)));
  const outputs: InputResult["outputs"] = [];
  for (let m = 0; m < workers.length; m++) {
    for (let i = 0; i < runs; i++) {
      const r = await call(workers[m], bytes);
      outputs.push({ machine: m, text: norm(r.text), seconds: r.seconds });
    }
  }
  const counts = new Map<string, number>();
  for (const o of outputs) counts.set(o.text, (counts.get(o.text) ?? 0) + 1);
  const reference = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let ref: string | undefined;
  try {
    ref = norm(readFileSync(join(values.data, f.replace(ext, ".ref.txt")), "utf8"));
  } catch {
    ref = undefined;
  }
  inputs.push({ name: f, outputs, reference, ref });
  console.log(`${f}: ${counts.size} distinct honest output(s) over ${outputs.length} runs`);
}

// all honest pairs, within and across machines
let comparisons = 0;
let exactAgree = 0;
let crossComparisons = 0;
let crossAgree = 0;
const honestOverlaps: number[] = [];
for (const inp of inputs) {
  const o = inp.outputs;
  for (let a = 0; a < o.length; a++) {
    for (let b = a + 1; b < o.length; b++) {
      comparisons++;
      const same = outputHashOf(o[a].text) === outputHashOf(o[b].text);
      if (same) exactAgree++;
      if (o[a].machine !== o[b].machine) {
        crossComparisons++;
        if (same) crossAgree++;
      }
      honestOverlaps.push(same ? 10_000 : overlapText(o[a].text, o[b].text));
    }
  }
}
const allExact = exactAgree === comparisons;
const fpAt = (tau: number) => honestOverlaps.filter((x) => x < tau).length / honestOverlaps.length;

// ------------------------------------------------------------ cheats
interface Cheat {
  name: string;
  run: (bytes: Uint8Array, idx: number) => Promise<{ text: string; seconds: number }>;
}
const honestSeconds = (idx: number) => inputs[idx].outputs.reduce((s, o) => s + o.seconds, 0) / inputs[idx].outputs.length;
const otherRef = (idx: number) => inputs[(idx + 1) % inputs.length].reference;
const cheats: Cheat[] = [
  { name: "empty", run: async () => ({ text: "", seconds: 0 }) },
  { name: "garbage", run: async () => ({ text: "lorem ipsum dolor sit amet consectetur", seconds: 0 }) },
  { name: "replay-other-input", run: async (_b, i) => ({ text: otherRef(i), seconds: 0 }) },
];
if (task === "asr") {
  for (const m of ["tiny", "base", "small"]) cheats.push({ name: `model-${m}`, run: async (b) => { const r = await call(workers[0], b, { model_name: m }); return { text: norm(r.text), seconds: r.seconds }; } });
  cheats.push({ name: "truncate-60pct", run: async (_b, i) => { const w = inputs[i].reference.split(" "); return { text: w.slice(0, Math.max(1, Math.floor(w.length * 0.6))).join(" "), seconds: honestSeconds(i) * 0.6 }; } });
} else {
  cheats.push({ name: "engine-fast", run: async (b) => { const r = await call(workers[0], b, { engine: "fast" }); return { text: norm(r.text), seconds: r.seconds }; } });
  cheats.push({ name: "downscale-50pct", run: async (b) => { const r = await call(workers[0], b, { scale: "0.5" }); return { text: norm(r.text), seconds: r.seconds }; } });
  cheats.push({ name: "crop-70pct", run: async (b) => { const r = await call(workers[0], b, { crop: "0.7" }); return { text: norm(r.text), seconds: r.seconds }; } });
}

const cheatRows: Array<{ name: string; outputs: Array<{ input: string; text: string; overlap: number; exactDiffers: boolean; savedFraction: number }> }> = [];
for (const c of cheats) {
  const outs = [];
  for (let i = 0; i < inputs.length; i++) {
    const bytes = new Uint8Array(readFileSync(join(values.data!, inputs[i].name)));
    const n = c.name.startsWith("model-") || c.name.startsWith("engine") || c.name.startsWith("downscale") || c.name.startsWith("crop") ? cheatRuns : 1;
    for (let k = 0; k < n; k++) {
      const r = await c.run(bytes, i);
      const hs = honestSeconds(i);
      outs.push({
        input: inputs[i].name,
        text: r.text,
        overlap: r.text === inputs[i].reference ? 10_000 : overlapText(r.text, inputs[i].reference),
        exactDiffers: outputHashOf(r.text) !== outputHashOf(inputs[i].reference),
        savedFraction: hs > 0 ? Math.max(0, 1 - r.seconds / hs) : 1,
      });
    }
  }
  cheatRows.push({ name: c.name, outputs: outs });
}

// ------------------------------------------------------------ class decision
const taus = Array.from({ length: 41 }, (_, i) => 6000 + i * 100); // 6000..10000
let cls: "EXACT" | "TOLERANCE" | "NOT_COVERABLE" = "EXACT";
let tau = 10_000;
const piFor = (rows: (typeof cheatRows)[number], t: number) => rows.outputs.filter((o) => (cls === "EXACT" ? o.exactDiffers : o.overlap < t)).length / rows.outputs.length;
if (!allExact || comparisons < 200) {
  cls = "TOLERANCE";
  const ok = taus.filter((t) => fpAt(t) <= 0.005);
  tau = ok.length ? Math.max(...ok) : 0;
  if (!ok.length) {
    const fallback = taus.filter((t) => fpAt(t) <= 0.01);
    tau = fallback.length ? Math.max(...fallback) : 0;
  }
}
const piRows = cheatRows.map((r) => ({
  cheat: r.name,
  piBps: Math.round(piFor(r, tau) * 10_000),
  savedFraction: Math.round((r.outputs.reduce((s, o) => s + o.savedFraction, 0) / r.outputs.length) * 1000) / 1000,
}));
const fpBps = cls === "EXACT" ? 0 : Math.round(fpAt(tau) * 10_000);
const worstPi = Math.min(...piRows.map((r) => r.piBps));
if (cls === "TOLERANCE" && (tau === 0 || fpBps > 100 || worstPi < 3000)) cls = "NOT_COVERABLE";

const honestCost = values["honest-cost-tinybar"] ? BigInt(values["honest-cost-tinybar"]) : null;
// ------------------------------------------------------------ add-on A2: measured accuracy
/** edit distance over arrays */
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
const unit = (t: string) => (task === "asr" ? (t ? t.split(" ") : []) : [...t]);
const scored = inputs.filter((i) => i.ref !== undefined && !i.ref.startsWith("!!"));
const perInput = scored.map((i) => ({ input: i.name, errors: edits(unit(i.ref!), unit(i.reference)), length: unit(i.ref!).length }));
const corpus = (rows: typeof perInput) => {
  const n = rows.reduce((x, r) => x + r.length, 0);
  return n ? rows.reduce((x, r) => x + r.errors, 0) / n : NaN;
};
// bootstrap over inputs (deterministic PRNG so the report is reproducible)
let bs = 12345;
const rnd = () => ((bs = (bs * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const boots: number[] = [];
for (let k = 0; k < 2000 && perInput.length; k++) boots.push(corpus(Array.from({ length: perInput.length }, () => perInput[Math.floor(rnd() * perInput.length)])));
boots.sort((a, b) => a - b);
const accuracy = {
  metric: task === "asr" ? "WER" : "CER",
  normalization: task === "asr" ? "NORM_ASR_V1" : "NORM_OCR_V1B",
  inputsWithReference: perInput.length,
  inputsWithoutReference: inputs.length - perInput.length,
  referenceUnits: perInput.reduce((x, r) => x + r.length, 0),
  corpusError: corpus(perInput),
  ci95: boots.length ? [boots[Math.floor(boots.length * 0.025)], boots[Math.floor(boots.length * 0.975)]] : null,
  perInput,
  registry: { expectedErrorBps: Math.round(corpus(perInput) * 10_000), errorSampleSize: perInput.length },
  limits: "describes the pinned model on this small test set, not any single job; not a guarantee",
};
if (inputs.length - perInput.length) console.warn(`WARNING: ${inputs.length - perInput.length} input(s) have no .ref.txt; A2 needs a human-checked reference for every input`);

const report = {
  task,
  ranAt: new Date().toISOString(),
  imageDigest: values.digest,
  workers: workers.map((w, i) => ({ url: w, health: health[i] })),
  inputs: inputs.length,
  runsPerMachine: runs,
  honest: {
    comparisons,
    exactAgreement: exactAgree / comparisons,
    crossMachineComparisons: crossComparisons,
    crossMachineExactAgreement: crossComparisons ? crossAgree / crossComparisons : null,
    overlapMinBps: Math.min(...honestOverlaps),
    overlapP01Bps: [...honestOverlaps].sort((a, b) => a - b)[Math.floor(honestOverlaps.length * 0.01)],
    fpByTau: Object.fromEntries(taus.filter((t) => t % 500 === 0).map((t) => [t, fpAt(t)])),
  },
  decision: { class: cls, tauBps: cls === "EXACT" ? 0 : tau, fpBps, worstCheatPiBps: worstPi },
  cheats: piRows.map((r) => ({ ...r, cTinybar: honestCost ? ((honestCost * BigInt(Math.round(r.savedFraction * 1000))) / 1000n).toString() : null, cProvenance: "assumed (time ratio x --honest-cost-tinybar)" })),
  accuracy,
  provenance: "measured (this script, real pinned workers); cTinybar is assumed",
};
const dir = join(import.meta.dirname, "../docs/gates");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, values.out ?? `G3.${task}.json`), JSON.stringify(report, null, 2) + "\n");

console.log(`\n## G3 ${task.toUpperCase()} (${inputs.length} inputs x ${runs} runs x ${workers.length} machines, image ${values.digest})`);
console.log(`honest exact-hash agreement: ${(report.honest.exactAgreement * 100).toFixed(2)}% of ${comparisons} comparisons (cross-machine ${report.honest.crossMachineExactAgreement === null ? "n/a" : (report.honest.crossMachineExactAgreement * 100).toFixed(2) + "%"})`);
console.log(`class: ${cls}${cls !== "EXACT" ? `  tau ${tau} bps  fp ${fpBps} bps` : ""}`);
console.log("| cheat | pi (bps) | compute saved |\n|---|---|---|");
for (const r of piRows) console.log(`| ${r.cheat} | ${r.piBps} | ${(r.savedFraction * 100).toFixed(0)}% |`);
if (cls === "NOT_COVERABLE") console.log("\n!! NOT COVERABLE on this stack: restrict inputs or pin one hardware class, and say so in the README.");
if (perInput.length) {
  console.log(`\naccuracy (A2): corpus ${accuracy.metric} ${(accuracy.corpusError * 100).toFixed(2)}% on ${perInput.length} inputs (${accuracy.referenceUnits} reference ${task === "asr" ? "words" : "characters"}), bootstrap 95% CI ${accuracy.ci95!.map((x) => (x * 100).toFixed(2) + "%").join(" - ")}`);
  console.log(`registry: ${task.toUpperCase()}_ERROR_BPS=${accuracy.registry.expectedErrorBps} ${task.toUpperCase()}_ERROR_N=${accuracy.registry.errorSampleSize}  -> copy into docs/ACCURACY.md`);
}
console.log(`\nwrote docs/gates/${values.out ?? `G3.${task}.json`} (${basename(values.data)})`);
