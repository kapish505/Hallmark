import { AbiCoder, keccak256 } from "ethers";
import { z } from "zod";

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "32-byte hex");
const tinybar = z.string().regex(/^\d+$/, "integer tinybar as a string");
const bps = z.number().int().min(0).max(10_000);

/**
 * A model manifest: everything a pool needs to serve and check one pinned model. The on-chain part
 * (ModelRegistry.Model) is derived from it; the rest tells operators how to run the model and clients
 * what input it takes. Numbers that set bonds (c, pi, fp, tau) must come from a calibration run
 * (hallmark-calibrate), never from a guess.
 */
export const Manifest = z
  .object({
    schema: z.literal("hallmark.model/0"),
    /** on-chain id = keccak256(utf8(modelKey)) */
    modelKey: z.string().regex(/^[A-Z0-9_]{2,64}$/),
    /** short client-facing name used in routes and the console (e.g. a task id) */
    task: z.string().regex(/^[a-z0-9-]{2,32}$/),
    title: z.string().min(1).max(80),
    description: z.string().max(400),
    /** x402 route the gateway client serves this model on */
    endpoint: z.string().regex(/^\/v1\/[a-z0-9/-]+$/),
    runtime: z.object({
      /** container image reference, pinned by digest */
      image: z.string().min(1),
      /** bytes32 recorded on chain: the image digest every honest operator runs */
      runtimeDigest: bytes32,
      /** bytes32 recorded on chain: one hardware/OS class per pool */
      hwClass: bytes32,
      hwClassLabel: z.string().min(1),
    }),
    /** normalization rule id from the rule library (TextNorm.sol / norm.ts) */
    normSpec: z.number().int().min(1).max(2),
    normName: z.string(),
    checkClass: z.enum(["EXACT", "TOLERANCE"]),
    tauBps: bps,
    feeTinybar: tinybar,
    /** compute an operator saves with the worst measured cheat */
    cTinybar: tinybar,
    /** operator margin m = F - c_honest */
    marginTinybar: tinybar,
    /** measured catch rate of the worst cheat */
    piBps: bps.refine((v) => v > 0, "piBps must be > 0"),
    /** measured false-alarm rate of honest re-runs */
    fpBps: bps,
    minWords: z.number().int().min(1).max(96),
    maxWords: z.number().int().min(1).max(96),
    accuracy: z.object({ metric: z.enum(["WER", "CER"]), expectedErrorBps: bps, sampleSize: z.number().int().min(0) }),
    input: z.object({
      /** media checker from the shared library */
      media: z.enum(["wav-pcm16-mono-16k", "png"]),
      ext: z.string().regex(/^\.[a-z0-9]+$/),
      contentType: z.string(),
      maxBytes: z.number().int().positive(),
      maxSeconds: z.number().positive().optional(),
      maxPixels: z.number().int().positive().optional(),
      hint: z.string().default(""),
    }),
    worker: z.object({
      /** env var that holds this model's worker URL on an operator */
      urlEnv: z.string().regex(/^[A-Z0-9_]+$/),
      /** POST path on the worker */
      path: z.string().regex(/^\/[a-z0-9/-]*$/),
      /** port the container listens on */
      port: z.number().int().min(1).max(65535),
    }),
    /** advisory validators the gateway offers (no money effect) */
    validators: z.array(z.string()).min(1),
    /** demo-only cheats for the attack lab and calibration: worker form fields and/or post-processing */
    cheats: z
      .record(z.object({ worker: z.record(z.union([z.string(), z.number()])).optional(), keepWords: z.number().min(0).max(1).optional() }))
      .default({}),
    calibration: z.object({
      status: z.enum(["measured", "prelim", "unmeasured"]),
      runs: z.number().int().min(0),
      inputs: z.number().int().min(0),
      machines: z.number().int().min(0),
      ranAt: z.string(),
      note: z.string().default(""),
    }),
    /** false = describe only; enabling is the registry owner's decision after review */
    enabled: z.boolean().default(false),
  })
  .refine((m) => m.minWords <= m.maxWords, "minWords must be <= maxWords")
  .refine((m) => m.checkClass === "EXACT" || m.tauBps > 0, "a TOLERANCE model needs tauBps > 0")
  .refine((m) => m.input.media !== "wav-pcm16-mono-16k" || m.input.maxSeconds !== undefined, "audio input needs maxSeconds")
  .refine((m) => m.input.media !== "png" || m.input.maxPixels !== undefined, "image input needs maxPixels");
export type Manifest = z.infer<typeof Manifest>;

export const modelIdOfKey = (key: string) => keccak256(new TextEncoder().encode(key));

/** keccak256 of the canonical JSON (sorted keys): pins the exact manifest a proposal refers to */
export function manifestHash(m: Manifest): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return keccak256(new TextEncoder().encode(JSON.stringify(canon(m))));
}

/** The on-chain ModelRegistry.Model struct for this manifest. */
export function onChainModel(m: Manifest, enabled = m.enabled) {
  return {
    class: m.checkClass === "EXACT" ? 0 : 1,
    tauBps: m.tauBps,
    normSpec: m.normSpec,
    minWords: m.minWords,
    maxWords: m.maxWords,
    enabled,
    piBps: m.piBps,
    fpBps: m.fpBps,
    expectedErrorBps: m.accuracy.expectedErrorBps,
    errorSampleSize: m.accuracy.sampleSize,
    runtimeDigest: m.runtime.runtimeDigest,
    hwClass: m.runtime.hwClass,
    fee: BigInt(m.feeTinybar),
    cTinybar: BigInt(m.cTinybar),
    marginTinybar: BigInt(m.marginTinybar),
  };
}

const MODEL_TUPLE = "tuple(uint8,uint16,uint8,uint16,uint16,bool,uint16,uint16,uint16,uint32,bytes32,bytes32,uint128,uint128,uint128)";

/** ModelRegistry.proposalHash for this manifest: keccak256(abi.encode(modelId, Model)) with enabled = false */
export function proposalHashOf(m: Manifest): string {
  const s = onChainModel(m, false);
  const tuple = [s.class, s.tauBps, s.normSpec, s.minWords, s.maxWords, s.enabled, s.piBps, s.fpBps, s.expectedErrorBps, s.errorSampleSize, s.runtimeDigest, s.hwClass, s.fee, s.cTinybar, s.marginTinybar];
  return keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32", MODEL_TUPLE], [modelIdOfKey(m.modelKey), tuple]));
}
