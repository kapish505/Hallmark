import { bondWindow, formatHbar, type Cheat } from "@hallmark/shared";

/**
 * Bond-window calculator. Inputs come from src/measurements.json; every value carries its
 * provenance so an assumed number is never printed as a measured one.
 */
export type Provenance = "measured" | "assumed" | "cited";
export interface Tagged<T = number> {
  value: T;
  source: Provenance;
  note?: string;
}

export interface TaskMeasurements {
  task: "asr" | "ocr";
  class: Tagged<"EXACT" | "TOLERANCE">;
  tauBps: Tagged;
  /** executor fee F, tinybar */
  fee: Tagged;
  /** honest compute cost, tinybar (margin m = F - cost) */
  honestCost: Tagged;
  fpBps: Tagged;
  cheats: Array<{ name: string; c: Tagged; piBps: Tagged }>;
}

export interface Measurements {
  auditBps: Tagged;
  minBond: Tagged;
  tasks: TaskMeasurements[];
}

export function parseMeasurements(json: string | Measurements): Measurements {
  return typeof json === "string" ? (JSON.parse(json) as Measurements) : json;
}

export function analyse(t: TaskMeasurements, auditBps: number, minBond: bigint) {
  const cheats: Cheat[] = t.cheats.map((c) => ({ name: c.name, c: BigInt(Math.round(c.c.value)), piBps: Math.round(c.piBps.value) }));
  const fee = BigInt(Math.round(t.fee.value));
  const margin = fee - BigInt(Math.round(t.honestCost.value));
  const w = bondWindow({ fee, margin, fpBps: Math.round(t.fpBps.value), auditBps, minBond, cheats });
  const sources = new Set<Provenance>([t.fee.source, t.honestCost.source, t.fpBps.source, ...t.cheats.flatMap((c) => [c.c.source, c.piBps.source])]);
  return {
    ...w,
    margin,
    allMeasured: sources.size === 1 && sources.has("measured"),
    sources: [...sources],
    windowRatioOk: t.fpBps.value === 0 || (w.worst.piBps / t.fpBps.value) >= Number(w.worst.c) / Number(margin > 0n ? margin : 1n),
  };
}

export function fmtCeiling(c: bigint) {
  return c >= (1n << 255n) ? "none (fp = 0)" : formatHbar(c);
}
