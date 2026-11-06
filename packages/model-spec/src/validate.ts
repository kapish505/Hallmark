import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deterrenceBond, fairnessCeiling, NO_CEILING } from "@hallmark/shared";
import { Manifest, modelIdOfKey } from "./schema.js";

export interface WindowCheck {
  bond: bigint;
  ceiling: bigint;
  empty: boolean;
}

/** Same math as ModelRegistry.window / BondMath.sol: (deterrence bond, fairness ceiling) at an audit rate. */
export function bondWindowFor(m: Manifest, auditBps: number, minBond: bigint): WindowCheck {
  const bond = deterrenceBond(BigInt(m.cTinybar), BigInt(m.feeTinybar), auditBps, m.piBps, minBond);
  const ceiling = fairnessCeiling(BigInt(m.marginTinybar), auditBps, m.fpBps);
  return { bond, ceiling, empty: bond > ceiling };
}

export class ManifestError extends Error {}

/** Parse and validate one manifest. With `bondParams`, also refuse an enabled manifest whose window is empty. */
export function validateManifest(raw: unknown, bondParams?: { auditBps: number; minBond: bigint }): Manifest {
  const p = Manifest.safeParse(raw);
  if (!p.success) throw new ManifestError(p.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  const m = p.data;
  if (m.enabled && m.calibration.status === "unmeasured") throw new ManifestError(`${m.modelKey}: enabled without a calibration run`);
  if (bondParams && m.enabled) {
    const w = bondWindowFor(m, bondParams.auditBps, bondParams.minBond);
    if (w.empty) throw new ManifestError(`${m.modelKey}: bond window is EMPTY at ${bondParams.auditBps / 100}% audit (bond ${w.bond} > ceiling ${w.ceiling})`);
  }
  return m;
}

export const describeCeiling = (c: bigint) => (c === NO_CEILING ? "none (fp = 0)" : `${c} tinybar`);

/** Default manifest directory: $MODELS_DIR, else ./models (repo root). */
export const modelsDir = () => resolve(process.env.MODELS_DIR ?? "models");

/** Load every *.json manifest in a directory, validated, sorted by modelKey. */
export function loadManifests(dir = modelsDir()): Manifest[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const out = files.map((f) => {
    try {
      return validateManifest(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch (e) {
      throw new ManifestError(`${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const keys = new Set<string>();
  const tasks = new Set<string>();
  for (const m of out) {
    if (keys.has(m.modelKey)) throw new ManifestError(`duplicate modelKey ${m.modelKey}`);
    if (tasks.has(m.task)) throw new ManifestError(`duplicate task ${m.task}`);
    keys.add(m.modelKey);
    tasks.add(m.task);
  }
  return out.sort((a, b) => a.modelKey.localeCompare(b.modelKey));
}

/** Manifest lookup by on-chain model id. */
export function byModelId(ms: Manifest[]): Map<string, Manifest> {
  return new Map(ms.map((m) => [modelIdOfKey(m.modelKey).toLowerCase(), m]));
}
