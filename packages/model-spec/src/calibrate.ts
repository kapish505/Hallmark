import { outputHashOf, overlapText } from "@hallmark/shared";
import type { Manifest } from "./schema.js";
import { bondWindowFor, type WindowCheck } from "./validate.js";

/**
 * Gate G3 decision for a candidate model, as a pure function over measured outputs.
 * The CLI (calibrate-cli.ts) collects the outputs from real pinned workers; this decides.
 *
 *  - Honest agreement: every pair of honest runs of the same input (within and across machines).
 *  - EXACT when every pair is bit-identical (and there were enough pairs to say so).
 *  - Otherwise TOLERANCE: the highest overlap threshold tau whose honest false-alarm rate is <= 0.5%
 *    (else <= 1%); NOT_COVERABLE if no tau qualifies, fp > 1%, or the worst cheat is caught < 30%.
 *  - pi per cheat = share of its outputs the check catches; the cheat that needs the biggest bond sets (c, pi).
 * Refuses (enabled = false) when the class is NOT_COVERABLE or the bond window is empty.
 */
export interface CalibrationInput {
  /** honest normalized outputs: one array per input, every run on every machine */
  honestRuns: string[][];
  /** cheats: compute saved (tinybar) and their normalized outputs per input */
  cheats: Array<{ name: string; c: bigint; outputs: string[][] }>;
  auditBps: number;
  minBond: bigint;
  /** below this many honest pairs, bit-exact agreement is not trusted as EXACT (G3 asks for >= 200) */
  minExactComparisons?: number;
  /** measured accuracy against human references, if any */
  accuracy?: { expectedErrorBps: number; sampleSize: number };
  machines?: number;
  runs?: number;
}

export interface CalibrationResult {
  class: "EXACT" | "TOLERANCE" | "NOT_COVERABLE";
  tauBps: number;
  fpBps: number;
  piBps: number;
  worstCheat: string;
  cTinybar: bigint;
  perCheat: Array<{ name: string; piBps: number; c: bigint; bond: bigint }>;
  honest: { comparisons: number; exactAgreement: number };
  window: WindowCheck;
  /** null = a manifest may be enabled; otherwise why it may not */
  refused: string | null;
  manifest: Manifest;
}

const TAUS = Array.from({ length: 41 }, (_, i) => 6000 + i * 100);

export function calibrate(base: Manifest, d: CalibrationInput): CalibrationResult {
  // ---- honest agreement
  const overlaps: number[] = [];
  let comparisons = 0;
  let exact = 0;
  const refs: string[] = [];
  for (const runs of d.honestRuns) {
    const counts = new Map<string, number>();
    for (const r of runs) counts.set(r, (counts.get(r) ?? 0) + 1);
    refs.push([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "");
    const hashes = runs.map((r) => outputHashOf(r));
    for (let a = 0; a < runs.length; a++) {
      for (let b = a + 1; b < runs.length; b++) {
        comparisons++;
        const same = hashes[a] === hashes[b];
        if (same) exact++;
        overlaps.push(same ? 10_000 : overlapText(runs[a], runs[b]));
      }
    }
  }
  if (comparisons === 0) throw new Error("no honest comparisons: need >= 2 runs per input");
  const fpAt = (t: number) => overlaps.filter((x) => x < t).length / overlaps.length;

  // ---- class and tau
  let cls: CalibrationResult["class"] = "EXACT";
  let tau = 0;
  if (exact !== comparisons || comparisons < (d.minExactComparisons ?? 200)) {
    cls = "TOLERANCE";
    const ok = TAUS.filter((t) => fpAt(t) <= 0.005);
    const fallback = TAUS.filter((t) => fpAt(t) <= 0.01);
    tau = ok.length ? Math.max(...ok) : fallback.length ? Math.max(...fallback) : 0;
  }
  const fpBps = cls === "EXACT" ? 0 : Math.round(fpAt(tau || 6000) * 10_000);

  // ---- cheats
  const caught = (text: string, i: number) => (cls === "EXACT" ? outputHashOf(text) !== outputHashOf(refs[i]) : (text === refs[i] ? 10_000 : overlapText(text, refs[i])) < tau);
  const perCheat = d.cheats.map((c) => {
    const outs = c.outputs.flatMap((runs, i) => runs.map((t) => caught(t, i)));
    const piBps = outs.length ? Math.round((outs.filter(Boolean).length / outs.length) * 10_000) : 0;
    const bond = piBps === 0 ? (1n << 255n) : bondWindowFor({ ...base, cTinybar: c.c.toString(), piBps, fpBps } as Manifest, d.auditBps, d.minBond).bond;
    return { name: c.name, piBps, c: c.c, bond };
  });
  if (!perCheat.length) throw new Error("no cheats measured: G3 needs at least the generic cheats");
  const worst = perCheat.reduce((w, x) => (x.bond > w.bond ? x : w));
  const minPi = Math.min(...perCheat.map((c) => c.piBps));
  if (cls === "TOLERANCE" && (tau === 0 || fpBps > 100 || minPi < 3000)) cls = "NOT_COVERABLE";

  const manifest: Manifest = {
    ...base,
    checkClass: cls === "EXACT" ? "EXACT" : "TOLERANCE",
    tauBps: cls === "EXACT" ? 0 : tau,
    fpBps,
    piBps: Math.max(1, worst.piBps),
    cTinybar: worst.c.toString(),
    accuracy: d.accuracy ? { ...base.accuracy, ...d.accuracy } : base.accuracy,
    calibration: {
      status: "measured",
      runs: d.runs ?? Math.max(...d.honestRuns.map((r) => r.length)),
      inputs: d.honestRuns.length,
      machines: d.machines ?? 1,
      ranAt: new Date().toISOString(),
      note: `hallmark-calibrate: ${comparisons} honest pairs, ${((exact / comparisons) * 100).toFixed(2)}% bit-exact; worst cheat ${worst.name}`,
      cheatsPiBps: Object.fromEntries(perCheat.map((c) => [c.name, c.piBps])),
    },
    enabled: false,
  };
  const window = bondWindowFor(manifest, d.auditBps, d.minBond);
  let refused: string | null = null;
  if (cls === "NOT_COVERABLE") refused = `NOT COVERABLE: honest runs differ too much or a cheat is caught too rarely (tau ${tau}, fp ${fpBps} bps, weakest catch ${minPi} bps)`;
  else if (worst.piBps === 0) refused = `cheat ${worst.name} is never caught: no bond deters it`;
  else if (window.empty) refused = `bond window is EMPTY at ${d.auditBps / 100}% audit: bond ${window.bond} > ceiling ${window.ceiling}`;
  manifest.enabled = refused === null;
  return {
    class: cls,
    tauBps: manifest.tauBps,
    fpBps,
    piBps: worst.piBps,
    worstCheat: worst.name,
    cTinybar: worst.c,
    perCheat,
    honest: { comparisons, exactAgreement: exact / comparisons },
    window,
    refused,
    manifest,
  };
}
