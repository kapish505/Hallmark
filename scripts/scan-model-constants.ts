/**
 * Fails if a model-specific constant appears in core code outside the model manifests (models/*.json)
 * and the model containers (packages/operator/worker/*). Adding a model must mean adding a manifest,
 * not editing contracts, the gateway, the operator, the SDK or the shared library.
 *
 *   npx tsx scripts/scan-model-constants.ts        (exit 1 and a list of hits if any)
 *
 * Forbidden: the names of the models we ship (task ids, engines), and every concrete value a manifest
 * carries (model keys, image digests, hardware class, fee/c/margin numbers, routes, worker env vars,
 * file extensions). Allowed on purpose: the normalization rule library and the media checkers, which a
 * manifest refers to by id; they are listed in ALLOW with the reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
export const SCOPE = [
  "contracts/src",
  "contracts/script",
  "packages/shared/src",
  "packages/model-spec/src",
  "packages/gateway/src",
  "packages/operator/src",
  "packages/sdk/src",
];
/** rule libraries a manifest points at by id: not model constants */
export const ALLOW: Record<string, string> = {
  "contracts/src/libs/TextNorm.sol": "normalization rule library (rule ids 1, 2)",
  "packages/shared/src/norm.ts": "normalization rule library, byte-for-byte twin of TextNorm.sol",
  "packages/shared/src/media.ts": "media checker library (manifest input.media names the checker)",
  "packages/model-spec/src/schema.ts": "manifest schema: lists the media checker and metric names",
  "packages/model-spec/src/runtime.ts": "dispatches input.media to the media checker library",
};

const FIXED = [/\basr\b/i, /\bocr\b/i, /whisper/i, /tesseract/i, /large-v3/i, /16\s?khz/i];

function manifestValues(): Array<{ what: string; re: RegExp }> {
  const out: Array<{ what: string; re: RegExp }> = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  for (const f of readdirSync(join(ROOT, "models")).filter((x) => x.endsWith(".json"))) {
    const m = JSON.parse(readFileSync(join(ROOT, "models", f), "utf8"));
    const add = (what: string, v: string, word = true) => v && out.push({ what: `${f}: ${what}`, re: new RegExp(word ? `(?<![\\w])${esc(v)}(?![\\w])` : esc(v), "i") });
    add("modelKey", m.modelKey);
    add("task", m.task);
    add("endpoint", m.endpoint, false);
    add("runtimeDigest", m.runtime.runtimeDigest.slice(2), false);
    add("hwClass", m.runtime.hwClass.slice(2), false);
    add("worker.urlEnv", m.worker.urlEnv);
    add("input.ext", m.input.ext);
    for (const k of ["feeTinybar", "cTinybar", "marginTinybar"]) {
      const n = String(m[k]);
      // whole millions (0.01 HBAR steps) also appear as generic defaults (minBond, gas limits): only distinctive values are checked
      if (BigInt(n) % 1_000_000n === 0n) continue;
      add(k, n);
      add(`${k} (with _)`, n.replace(/\B(?=(\d{3})+(?!\d))/g, "_"));
    }
  }
  return out;
}

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [dir];
  return readdirSync(abs).flatMap((n) => (n === "abi" || n === "node_modules" ? [] : files(join(dir, n))));
}

const allChecks = () => [...FIXED.map((re) => ({ what: `name ${re.source}`, re })), ...manifestValues()];

/** which checks a piece of text trips (used by the test's positive control) */
export const hitsIn = (text: string) => allChecks().filter((c) => c.re.test(text)).map((c) => c.what);

export function scan(): Array<{ file: string; line: number; what: string; text: string }> {
  const checks = allChecks();
  const hits: Array<{ file: string; line: number; what: string; text: string }> = [];
  for (const f of SCOPE.flatMap(files).filter((x) => /\.(ts|sol)$/.test(x))) {
    const rel = relative(ROOT, join(ROOT, f));
    if (ALLOW[rel]) continue;
    readFileSync(join(ROOT, f), "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const c of checks) if (c.re.test(text)) hits.push({ file: rel, line: i + 1, what: c.what, text: text.trim().slice(0, 140) });
      });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = scan();
  for (const h of hits) console.log(`${h.file}:${h.line}  [${h.what}]  ${h.text}`);
  console.log(hits.length ? `\n${hits.length} model constant(s) outside manifests` : "no model constants outside manifests");
  process.exit(hits.length ? 1 : 0);
}
