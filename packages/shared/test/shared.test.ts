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

describe("NORM_OCR_V1 (spec 2)", () => {
  it("drops apostrophes and punctuation; splits on whitespace - / _", () => {
    expect(normalize("TOTAL: $42.50 it's", 2).text).toBe("total 4250 its");
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
    const p = { chainId: 296, core: "0x" + "11".repeat(20), jobId: "0x" + "22".repeat(32), who: "0x" + "33".repeat(20), outputHash: "0x" + "44".repeat(32), salt: "0x" + "55".repeat(32) };
    const enc = AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256", "address", "bytes32", "address", "bytes32", "bytes32"], [COMMIT_DOMAIN, 296, p.core, p.jobId, p.who, p.outputHash, p.salt]);
    expect(commitment(p)).toBe(keccak256(enc));
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

describe("loadEnv", () => {
  it("treats empty values as unset", () => {
    const s = z.object({ A: z.string().default("d") });
    expect(loadEnv(s, { A: "" }).A).toBe("d");
  });
});
