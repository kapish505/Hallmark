import { describe, expect, it } from "vitest";
import { AbiCoder, keccak256 } from "ethers";
import { z } from "zod";
import {
  auditFee,
  badgeFor,
  bondWindow,
  cer,
  checkCanonicalWav,
  checkPng,
  commitment,
  COMMIT_DOMAIN,
  outCommitOf,
  parseValidator,
  runValidator,
  saltCommitOf,
  ValidatorError,
  deterrenceBond,
  fairnessCeiling,
  formatHbar,
  hbarToTinybar,
  jobIdFor,
  loadEnv,
  longZeroAddress,
  MediaError,
  NO_CEILING,
  NormError,
  normalize,
  overlapText,
  tinybarToWeibar,
  toMirrorTxId,
  toProtocolTxId,
  UnitError,
  validate,
  weibarToTinybar,
  wer,
} from "../src/index.js";
import { synthPng, synthWav } from "../../../scripts/local/chain.js";

describe("NORM_ASR_V1 (spec 1)", () => {
  it("normalizes per spec", () => {
    expect(normalize("Hello,  World! It’s 2 o'clock.", 1).text).toBe("hello world it's 2 o'clock");
    expect(normalize("well-known\tfact\n", 1).text).toBe("well known fact");
    expect(normalize("   ", 1).text).toBe("");
  });
  it("rejects non-ASCII except curly apostrophes", () => {
    expect(() => normalize("café", 1)).toThrow(NormError);
  });
  it("is idempotent and validates its own output", () => {
    for (const s of ["A b, C!", "it’s fine", "x-y-z 1 2 3"]) {
      const n = normalize(s, 1).text;
      expect(normalize(n, 1).text).toBe(n);
      expect(validate(n, 1)).toBe(n ? n.split(" ").length : 0);
    }
  });
  it("enforces word and byte limits", () => {
    expect(() => normalize(Array(97).fill("a").join(" "), 1)).toThrow(NormError);
    expect(() => validate("a  b", 1)).toThrow(NormError);
  });
});

describe("NORM_OCR_V1B (spec 2)", () => {
  it("keeps . and , only between digits; drops other punctuation; splits on whitespace - / _", () => {
    expect(normalize("TOTAL: $42.50 it's", 2).text).toBe("total 42.50 its");
    expect(normalize("1,200.00. end.", 2).text).toBe("1,200.00 end");
    expect(normalize("a.b 4 .5", 2).text).toBe("ab 4 5");
    expect(validate("42.50 1,200", 2)).toBe(2);
    expect(() => validate("4.", 2)).toThrow(NormError);
    expect(normalize("a/b_c-d", 2).text).toBe("a b c d");
    expect(normalize("it’s", 2).text).toBe("its");
  });
  it("rejects apostrophes in validated text", () => {
    expect(() => validate("it's", 2)).toThrow(NormError);
    expect(validate("its fine", 2)).toBe(2);
  });
});

describe("overlap and error rates", () => {
  it("matches the Solidity definition (multiset Dice, floor)", () => {
    expect(overlapText("a b c", "a b c")).toBe(10000);
    expect(overlapText("a a b", "a b b")).toBe(6666);
    expect(overlapText("", "a")).toBe(0);
    expect(overlapText("the quick brown fox", "the quick brown cat")).toBe(7500);
  });
  it("computes WER and CER", () => {
    expect(wer("a b c d", "a x c d")).toBe(0.25);
    expect(cer("abcd", "abce")).toBe(0.25);
    expect(wer("", "")).toBe(0);
  });
});

describe("bond math (section 3)", () => {
  it("deterrence bond = max(minBond, ceil(c / (p pi)) - F)", () => {
    expect(deterrenceBond(15_000_000n, 20_000_000n, 3000, 5000, 10_000_000n)).toBe(80_000_000n);
    expect(deterrenceBond(1n, 20_000_000n, 3000, 5000, 10_000_000n)).toBe(10_000_000n);
  });
  it("fairness ceiling = m / (p fp), none when fp = 0", () => {
    expect(fairnessCeiling(2_000_000n, 3000, 50)).toBe(1_333_333_333n);
    expect(fairnessCeiling(1n, 3000, 0)).toBe(NO_CEILING);
  });
  it("uses the worst cheat and flags an empty window", () => {
    const w = bondWindow({
      fee: 10_000_000n,
      margin: 2_000_000n,
      fpBps: 50,
      auditBps: 3000,
      minBond: 1n,
      cheats: [
        { name: "garbage", c: 8_000_000n, piBps: 10_000 },
        { name: "small-model", c: 6_000_000n, piBps: 500 },
      ],
    });
    expect(w.worst.name).toBe("small-model");
    expect(w.floor).toBe(400_000_000n - 10_000_000n);
    expect(w.empty).toBe(false);
    const e = bondWindow({ fee: 10n, margin: 1n, fpBps: 5000, auditBps: 3000, minBond: 1n, cheats: [{ name: "x", c: 10_000n, piBps: 100 }] });
    expect(e.empty).toBe(true);
  });
  it("audit fee rounds up", () => {
    expect(auditFee(3000, 10_000_000n)).toBe(3_000_000n);
    expect(auditFee(1, 3n)).toBe(1n);
  });
});

describe("units", () => {
  it("round-trips tinybar <-> weibar over a range", () => {
    for (const t of [0n, 1n, 123_456_789n, 10n ** 18n]) expect(weibarToTinybar(tinybarToWeibar(t))).toBe(t);
  });
  it("throws on sub-tinybar weibar instead of truncating", () => {
    expect(() => weibarToTinybar(10_000_000_001n)).toThrow(UnitError);
  });
  it("parses decimal HBAR exactly", () => {
    expect(hbarToTinybar("1.5")).toBe(150_000_000n);
    expect(() => hbarToTinybar("0.000000001")).toThrow(UnitError);
    expect(formatHbar(150_000_000n)).toBe("1.5 HBAR");
  });
});

describe("hedera helpers", () => {
  it("converts tx id formats", () => {
    expect(toMirrorTxId("0.0.5@1700000000.123")).toBe("0.0.5-1700000000-123");
    expect(toProtocolTxId("0.0.5-1700000000-123")).toBe("0.0.5@1700000000.123");
  });
  it("derives long-zero addresses", () => {
    expect(longZeroAddress("0.0.255")).toBe("0x00000000000000000000000000000000000000ff");
  });
});

describe("ids and commitments", () => {
  it("jobId is stable for the same payment and differs across payments (edge case 1)", () => {
    const h = keccak256(new Uint8Array([1, 2, 3]));
    expect(jobIdFor(h, "pay-1")).toBe(jobIdFor(h, "pay-1"));
    expect(jobIdFor(h, "pay-1")).not.toBe(jobIdFor(h, "pay-2"));
  });
  it("commitment encodes the Solidity tuple", () => {
    const p = { chainId: 296, core: "0x" + "11".repeat(20), jobId: "0x" + "22".repeat(32), who: "0x" + "33".repeat(20), outCommit: "0x" + "44".repeat(32), commitSalt: "0x" + "55".repeat(32) };
    const enc = AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256", "address", "bytes32", "address", "bytes32", "bytes32"], [COMMIT_DOMAIN, 296, p.core, p.jobId, p.who, p.outCommit, p.commitSalt]);
    expect(commitment(p)).toBe(keccak256(enc));
  });
  it("outCommit is salted: a guessed text cannot be tested without the job salt (edge case 31)", () => {
    const base = { chainId: 296, core: "0x" + "11".repeat(20), jobId: "0x" + "22".repeat(32), text: "yes" };
    const a = outCommitOf({ ...base, jobSalt: "0x" + "01".repeat(32) });
    expect(a).not.toBe(keccak256(new TextEncoder().encode("yes")));
    expect(a).not.toBe(outCommitOf({ ...base, jobSalt: "0x" + "02".repeat(32) }));
    expect(a).toBe(outCommitOf({ ...base, jobSalt: "0x" + "01".repeat(32) }));
    expect(saltCommitOf("0x" + "01".repeat(32))).toBe(keccak256("0x" + "01".repeat(32)));
  });
});

describe("canonical inputs", () => {
  it("accepts 16 kHz mono PCM16 WAV within the duration limit", () => {
    expect(checkCanonicalWav(synthWav(2), 15).durationSec).toBeCloseTo(2);
    expect(() => checkCanonicalWav(synthWav(20), 15)).toThrow(MediaError);
  });
  it("reads PNG dimensions and enforces the pixel limit", () => {
    expect(checkPng(synthPng(64, 32), 10_000)).toMatchObject({ width: 64, height: 32 });
    expect(() => checkPng(synthPng(64, 32), 100)).toThrow(MediaError);
    expect(() => checkPng(synthWav(1), 100)).toThrow(MediaError);
  });
});

describe("badges", () => {
  it("maps job states to section 9.6 badges", () => {
    const b = (status: string, audited = false, auditSkipped = false, slashedWrong = false) => badgeFor({ status, audited, auditSkipped, slashedWrong });
    expect(b("Challenge")).toBe("provisional (unaudited, bond-backed)");
    expect(b("Settled", true)).toBe("audited (re-run agreed)");
    expect(b("Settled", true, true)).toBe("audit skipped");
    expect(b("Refunded", true, false, true)).toBe("slashed");
    expect(b("Refunded")).toBe("refunded");
    expect(b("CommitteeCommit")).toBe("disputed");
  });
});

describe("validators (add-on A3)", () => {
  it("parses only the whitelist", () => {
    expect(parseValidator(undefined)).toEqual({ name: "none" });
    expect(parseValidator("min_words:5")).toEqual({ name: "min_words", arg: 5 });
    for (const bad of ["eval:1", "min_words:-1", "min_words:99999", "x".repeat(100), "min_words:1e3"]) expect(() => parseValidator(bad)).toThrow(ValidatorError);
  });
  it("min_words, date_iso, amount_present", () => {
    expect(runValidator({ name: "min_words", arg: 3 }, "a b c")).toBe("pass");
    expect(runValidator({ name: "min_words", arg: 4 }, "a b c")).toBe("fail");
    expect(runValidator({ name: "date_iso" }, "due 2026-02-28 ok")).toBe("pass");
    expect(runValidator({ name: "date_iso" }, "due 2026-02-30")).toBe("fail");
    expect(runValidator({ name: "date_iso" }, "12026-02-28")).toBe("fail");
    expect(runValidator({ name: "amount_present" }, "pay $42.50")).toBe("pass");
    expect(runValidator({ name: "amount_present" }, "pay 42")).toBe("fail");
    expect(runValidator({ name: "none" }, "x")).toBe("n/a");
  });
  it("invoice_total: items add up to the total within 0.01", () => {
    const inv = "Coffee 3.50\nBagel 2.25\nJuice 1,004.25\nSubtotal 1,010.00\nTOTAL 1,010.00";
    expect(runValidator({ name: "invoice_total" }, inv)).toBe("pass");
    expect(runValidator({ name: "invoice_total" }, inv.replace("TOTAL 1,010.00", "TOTAL 1,011.00"))).toBe("fail");
    expect(runValidator({ name: "invoice_total" }, "no amounts here")).toBe("n/a");
  });
  it("adversarial input is bounded: huge strings return n/a quickly (edge case 36)", () => {
    const huge = "1".repeat(1_000_000);
    const t0 = Date.now();
    expect(runValidator({ name: "invoice_total" }, huge)).toBe("n/a");
    expect(runValidator({ name: "amount_present" }, "9".repeat(8000))).toBe("fail");
    expect(runValidator({ name: "date_iso" }, "2026-".repeat(1600))).toBe("fail");
    expect(runValidator({ name: "invoice_total" }, ("total 1.00 ").repeat(700))).toMatch(/n\/a|pass|fail/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("an honest output that fails a validator only reports fail (edge case 35: no money effect)", () => {
    expect(runValidator({ name: "date_iso" }, "the quick brown fox")).toBe("fail");
  });
});

describe("loadEnv", () => {
  it("treats empty values as unset", () => {
    const s = z.object({ A: z.string().default("d") });
    expect(loadEnv(s, { A: "" }).A).toBe("d");
  });
});
