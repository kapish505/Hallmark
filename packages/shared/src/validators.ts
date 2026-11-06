/**
 * Buyer validators (add-on A3). A FIXED whitelist of pure functions; no buyer-supplied code.
 *   none | min_words:<n> | date_iso | amount_present | invoice_total
 * They run on the executor's raw output text (falling back to the normalized text). They are
 * ADVISORY: the on-chain commitment binds the normalized text (letters, digits and, for normalization rule 2, '.'/','
 * between digits), not raw punctuation or layout. A failure never slashes or refunds anybody: a hard
 * input can make the pinned model produce an output that fails the check while the operator was honest.
 * Bounded: inputs over MAX_INPUT bytes return n/a; every scan is a single linear pass (no regex
 * backtracking).
 */
export type ValidatorName = "none" | "min_words" | "date_iso" | "amount_present" | "invoice_total";
export interface ValidatorSpec {
  name: ValidatorName;
  arg?: number;
}
export type Validated = "pass" | "fail" | "n/a";

export const MAX_INPUT = 8192;
const MAX_MIN_WORDS = 1000;

export class ValidatorError extends Error {}

/** Parse a request's `validator` field; throws ValidatorError for anything off the whitelist. */
export function parseValidator(v: string | undefined | null): ValidatorSpec {
  if (v === undefined || v === null || v === "" || v === "none") return { name: "none" };
  if (v.length > 32) throw new ValidatorError("validator too long");
  if (v === "date_iso" || v === "amount_present" || v === "invoice_total") return { name: v };
  if (v.startsWith("min_words:")) {
    const s = v.slice("min_words:".length);
    if (!/^[0-9]{1,4}$/.test(s)) throw new ValidatorError("min_words needs an integer 0-1000");
    const n = Number(s);
    if (n > MAX_MIN_WORDS) throw new ValidatorError("min_words needs an integer 0-1000");
    return { name: "min_words", arg: n };
  }
  throw new ValidatorError("validator must be one of none, min_words:<n>, date_iso, amount_present, invoice_total");
}

export const validatorLabel = (v: ValidatorSpec) => (v.name === "min_words" ? `min_words:${v.arg}` : v.name);

const isDigit = (c: number) => c >= 48 && c <= 57;

/** words separated by ASCII whitespace */
function countWords(t: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const ws = c === 32 || c === 9 || c === 10 || c === 13;
    if (!ws && !inWord) n++;
    inWord = !ws;
  }
  return n;
}

/** YYYY-MM-DD with month 01-12 and day valid for that month, not surrounded by digits */
function hasIsoDate(t: string): boolean {
  for (let i = 0; i + 10 <= t.length; i++) {
    if (t[i + 4] !== "-" || t[i + 7] !== "-") continue;
    let ok = true;
    for (const k of [0, 1, 2, 3, 5, 6, 8, 9]) if (!isDigit(t.charCodeAt(i + k))) ok = false;
    if (!ok) continue;
    if ((i > 0 && isDigit(t.charCodeAt(i - 1))) || (i + 10 < t.length && isDigit(t.charCodeAt(i + 10)))) continue;
    const y = Number(t.slice(i, i + 4));
    const m = Number(t.slice(i + 5, i + 7));
    const d = Number(t.slice(i + 8, i + 10));
    if (m < 1 || m > 12 || d < 1) continue;
    const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (d <= dim) return true;
  }
  return false;
}

/**
 * Amounts in one line, in cents: digits (optionally grouped with ',' every 3) then '.' and exactly two
 * digits, not followed by another digit. Linear scan.
 */
export function amountsInLine(line: string): bigint[] {
  const out: bigint[] = [];
  let i = 0;
  while (i < line.length) {
    if (!isDigit(line.charCodeAt(i)) || (i > 0 && (isDigit(line.charCodeAt(i - 1)) || line[i - 1] === "," || line[i - 1] === "."))) {
      i++;
      continue;
    }
    let j = i;
    let whole = "";
    while (j < line.length && (isDigit(line.charCodeAt(j)) || (line[j] === "," && isDigit(line.charCodeAt(j + 1) || 0)))) {
      if (line[j] !== ",") whole += line[j];
      j++;
      if (whole.length > 15) break;
    }
    if (line[j] === "." && isDigit(line.charCodeAt(j + 1) || 0) && isDigit(line.charCodeAt(j + 2) || 0) && !isDigit(line.charCodeAt(j + 3) || 0) && whole.length <= 15) {
      out.push(BigInt(whole) * 100n + BigInt(line.slice(j + 1, j + 3)));
      i = j + 3;
    } else i = Math.max(j, i + 1);
  }
  return out;
}

function hasWord(lineLower: string, w: string): boolean {
  let from = 0;
  for (;;) {
    const k = lineLower.indexOf(w, from);
    if (k < 0) return false;
    const before = k === 0 ? "" : lineLower[k - 1];
    const after = lineLower[k + w.length] ?? "";
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return true;
    from = k + 1;
  }
}

/**
 * invoice_total: the LAST line containing the word "total" gives the total (its last amount); every
 * earlier line that has an amount and does not contain "total" or "subtotal" is a line item (its last
 * amount). pass if |sum(items) - total| <= 0.01. n/a if there is no total line or no item.
 */
function invoiceTotal(t: string): Validated {
  const lines = t.split("\n");
  let totalIdx = -1;
  for (let i = 0; i < lines.length; i++) if (hasWord(lines[i].toLowerCase(), "total") && amountsInLine(lines[i]).length) totalIdx = i;
  if (totalIdx < 0) return "n/a";
  const total = amountsInLine(lines[totalIdx]).at(-1)!;
  let sum = 0n;
  let items = 0;
  for (let i = 0; i < totalIdx; i++) {
    const l = lines[i].toLowerCase();
    if (hasWord(l, "total") || hasWord(l, "subtotal")) continue;
    const a = amountsInLine(lines[i]);
    if (a.length) {
      sum += a.at(-1)!;
      items++;
    }
  }
  if (!items) return "n/a";
  const diff = sum > total ? sum - total : total - sum;
  return diff <= 1n ? "pass" : "fail";
}

export function runValidator(v: ValidatorSpec, text: string | null | undefined): Validated {
  if (v.name === "none" || text === null || text === undefined) return "n/a";
  if (text.length > MAX_INPUT) return "n/a";
  switch (v.name) {
    case "min_words":
      return countWords(text) >= (v.arg ?? 0) ? "pass" : "fail";
    case "date_iso":
      return hasIsoDate(text) ? "pass" : "fail";
    case "amount_present":
      return text.split("\n").some((l) => amountsInLine(l).length > 0) ? "pass" : "fail";
    case "invoice_total":
      return invoiceTotal(text);
  }
}
