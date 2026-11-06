import { checkCanonicalWav, checkPng } from "@hallmark/shared";
import type { Manifest } from "./schema.js";
import { loadManifests } from "./validate.js";

/** Manifests to serve: every one in `dir`, or only the comma-separated modelKeys in `only`. */
export function selectManifests(dir: string, only = ""): Manifest[] {
  const all = loadManifests(dir);
  const keys = only
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keys.length) return all;
  const missing = keys.filter((k) => !all.some((m) => m.modelKey === k));
  if (missing.length) throw new Error(`no manifest for ${missing.join(", ")} in ${dir}`);
  return all.filter((m) => keys.includes(m.modelKey));
}

/** Check an input against the model's media rule. Throws MediaError with a readable message. */
export function checkInput(m: Manifest, bytes: Uint8Array): Record<string, unknown> {
  switch (m.input.media) {
    case "wav-pcm16-mono-16k":
      return { ...checkCanonicalWav(bytes, m.input.maxSeconds!) };
    case "png":
      return { ...checkPng(bytes, m.input.maxPixels!) };
  }
}

/** Input limits in the shape the gateway manifest publishes. */
export const limitsOf = (m: Manifest) => ({ maxBytes: m.input.maxBytes, maxSeconds: m.input.maxSeconds, maxPixels: m.input.maxPixels });

/** Worker URL for each model this host serves, read from the env var each manifest names. */
export function workerUrls(ms: Manifest[], env: Record<string, string | undefined> = process.env): Record<string, { url: string; path: string; ext: string }> {
  const out: Record<string, { url: string; path: string; ext: string }> = {};
  for (const m of ms) {
    const url = env[m.worker.urlEnv];
    if (url) out[m.task] = { url, path: m.worker.path, ext: m.input.ext };
  }
  return out;
}
