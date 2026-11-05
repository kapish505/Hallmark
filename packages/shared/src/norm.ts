import { keccak256 } from "ethers";

/**
 * Normalization (section 10). Must stay consistent with contracts/src/libs/TextNorm.sol, which
 * only VALIDATES normalized text (the chain never sees raw text).
 *
 *  NORM_ASR_V1 (spec 1): lowercase; U+2018/U+2019 -> "'"; keep [a-z0-9']; word separators are
 *      whitespace and '-'; other ASCII punctuation is dropped without separating; single spaces; trim.
 *  NORM_OCR_V1 (spec 2): lowercase; keep [a-z0-9]; whitespace, '-', '/', '_' separate words; other
 *      ASCII punctuation (including apostrophes) is dropped; single spaces; trim.
 *  Both: any other non-ASCII code point is REJECTED (NormError "BadChar"): inputs are restricted to
 *      ASCII text (G3 data rules), and an operator that gets a BadChar output refuses the job input.
 *  Limits: MAX_BYTES 1024, MAX_WORDS 96, raw input MAX_RAW_BYTES 4096.
 */
export const MAX_BYTES = 1024;
export const MAX_WORDS = 96;
export const MAX_RAW_BYTES = 4096;
export const NORM = { ASR_V1: 1, OCR_V1: 2 } as const;
export type NormSpec = 1 | 2;
export const NORM_NAME: Record<NormSpec, string> = { 1: "NORM_ASR_V1", 2: "NORM_OCR_V1" };

export class NormError extends Error {
  constructor(
    public readonly code: "BadChar" | "TooLong" | "TooManyWords" | "BadSpacing" | "BadSpec",
    message: string,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (input: string | Uint8Array) => (typeof input === "string" ? enc.encode(input) : input);

function isWordChar(c: number, spec: NormSpec): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || (c === 0x27 && spec === 1);
}
function isSeparator(c: number, spec: NormSpec): boolean {
  if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2d) return true;
  return spec === 2 && (c === 0x2f || c === 0x5f);
}

export function normalize(input: string | Uint8Array, spec: NormSpec): { text: string; words: number } {
  if (spec !== 1 && spec !== 2) throw new NormError("BadSpec", `unknown spec ${spec}`);
  const raw = toBytes(input);
  if (raw.length > MAX_RAW_BYTES) throw new NormError("TooLong", `raw input ${raw.length} > ${MAX_RAW_BYTES} bytes`);
  const out: number[] = [];
  let words = 0;
  let pendingSpace = false;
  for (let i = 0; i < raw.length; ) {
    let c = raw[i];
    let w = 0;
    if (c >= 0x80) {
      const curly = c === 0xe2 && i + 2 < raw.length && raw[i + 1] === 0x80 && (raw[i + 2] === 0x98 || raw[i + 2] === 0x99);
      if (!curly) throw new NormError("BadChar", `non-ASCII byte 0x${c.toString(16)} at ${i}`);
      if (spec === 1) w = 0x27; // OCR drops apostrophes
      i += 3;
    } else {
      if (c >= 0x41 && c <= 0x5a) c += 32;
      if (isWordChar(c, spec)) w = c;
      else if (isSeparator(c, spec) && out.length > 0) pendingSpace = true;
      i += 1;
    }
    if (w !== 0) {
      if (out.length === 0 || pendingSpace) {
        if (pendingSpace) out.push(0x20);
        pendingSpace = false;
        words += 1;
      }
      out.push(w);
    }
  }
  if (out.length > MAX_BYTES) throw new NormError("TooLong", `normalized ${out.length} > ${MAX_BYTES} bytes`);
  if (words > MAX_WORDS) throw new NormError("TooManyWords", `${words} words > ${MAX_WORDS}`);
  return { text: dec.decode(new Uint8Array(out)), words };
}

/** Same check as TextNorm.validate (what postText / revealText enforce on chain). */
export function validate(input: string | Uint8Array, spec: NormSpec): number {
  if (spec !== 1 && spec !== 2) throw new NormError("BadSpec", `unknown spec ${spec}`);
  const s = toBytes(input);
  if (s.length > MAX_BYTES) throw new NormError("TooLong", `${s.length} > ${MAX_BYTES} bytes`);
  if (s.length === 0) return 0;
  if (s[s.length - 1] === 0x20) throw new NormError("BadSpacing", "trailing space");
  let words = 0;
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 0x20) {
      if (prevSpace) throw new NormError("BadSpacing", `double or leading space at ${i}`);
      prevSpace = true;
    } else if (isWordChar(c, spec)) {
      if (prevSpace) {
        words += 1;
        prevSpace = false;
      }
    } else {
      throw new NormError("BadChar", `byte 0x${c.toString(16)} at ${i}`);
    }
  }
  if (words > MAX_WORDS) throw new NormError("TooManyWords", `${words} words > ${MAX_WORDS}`);
  return words;
}

export const outputHashOf = (normalized: string) => keccak256(enc.encode(normalized));

export function wordHashes(normalized: string): string[] {
  if (normalized.length === 0) return [];
  return normalized.split(" ").map((w) => keccak256(enc.encode(w)));
}

/** Dice overlap over word-hash multisets, in bps, integer division like Solidity. */
export function overlapBps(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const c = counts.get(w) ?? 0;
    if (c > 0) {
      counts.set(w, c - 1);
      common += 1;
    }
  }
  return Math.floor((20000 * common) / (a.length + b.length));
}

export const overlapText = (a: string, b: string) => overlapBps(wordHashes(a), wordHashes(b));

/** Levenshtein distance over arrays (calibration only, off-chain). */
function edit<T>(a: T[], b: T[]): number {
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
/** word error rate of `hyp` against `ref` (both normalized) */
export function wer(ref: string, hyp: string): number {
  const r = ref ? ref.split(" ") : [];
  const h = hyp ? hyp.split(" ") : [];
  return r.length === 0 ? (h.length === 0 ? 0 : 1) : edit(r, h) / r.length;
}
/** character error rate of `hyp` against `ref` (both normalized) */
export function cer(ref: string, hyp: string): number {
  return ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : edit([...ref], [...hyp]) / ref.length;
}
