import { z } from "zod";

/** a model's client-facing name (its manifest `task`); the list of models comes from the manifests */
export type Task = string;

export const TaskInfo = z.object({
  task: z.string(),
  endpoint: z.string(),
  modelId: z.string(),
  modelKey: z.string(),
  priceTinybar: z.string().regex(/^\d+$/),
  bondTinybar: z.string().regex(/^\d+$/),
  class: z.enum(["EXACT", "TOLERANCE"]),
  tauBps: z.number(),
  auditBps: z.number(),
  available: z.boolean(),
  /** add-on A2: pinned model's measured error (metric from its manifest), informational only */
  accuracy: z.object({ expectedErrorBps: z.number(), sampleSize: z.number(), metric: z.enum(["WER", "CER"]), measured: z.boolean() }),
  validators: z.array(z.string()),
  limits: z.object({ maxBytes: z.number(), maxSeconds: z.number().optional(), maxPixels: z.number().optional() }),
});
export type TaskInfo = z.infer<typeof TaskInfo>;

export const Manifest = z.object({
  name: z.string(),
  version: z.string(),
  network: z.literal("hedera:testnet"),
  payTo: z.string(),
  asset: z.literal("0.0.0"),
  chainId: z.number(),
  contract: z.string(),
  facilitator: z.string(),
  /** EVM address of payTo, for the direct-transfer payment option (EVM wallets such as MetaMask) */
  payToEvm: z.string().optional(),
  tasks: z.array(TaskInfo),
  endpoints: z.object({ job: z.string(), result: z.string(), events: z.string() }),
});
export type Manifest = z.infer<typeof Manifest>;

export const JobAccepted = z.object({
  jobId: z.string(),
  /** bearer capability for the result, the job salt and the evidence (only the payer sees the 202) */
  accessToken: z.string(),
  validator: z.string(),
  task: z.string(),
  inputHash: z.string(),
  statusUrl: z.string(),
  eventsUrl: z.string(),
  resultUrl: z.string(),
});
export type JobAccepted = z.infer<typeof JobAccepted>;

/** Result badges (section 9.6). */
export type Badge =
  | "pending"
  | "provisional (unaudited, bond-backed)"
  | "settled (bond-backed, not audited)"
  | "audited (re-run agreed)"
  | "disputed"
  | "slashed"
  | "refunded"
  | "voided (input missing)"
  | "audit skipped";

export function badgeFor(j: {
  status: string;
  audited: boolean;
  auditSkipped: boolean;
  slashedWrong: boolean;
}): Badge {
  if (j.status === "Refunded") return j.slashedWrong ? "slashed" : "refunded";
  if (j.status === "Voided") return "voided (input missing)";
  if (j.status === "Settled") {
    if (j.auditSkipped) return "audit skipped";
    return j.audited ? "audited (re-run agreed)" : "settled (bond-backed, not audited)";
  }
  if (j.status === "Challenge") return "provisional (unaudited, bond-backed)";
  if (["Text", "CommitteeCommit", "CommitteeReveal"].includes(j.status)) return "disputed";
  return "pending";
}

/** Operator demo behaviors (section 9.2). */
export const OperatorBehavior = z.enum([
  "honest",
  "garbage",
  "replay-other-input",
  "lazy-small-model",
  "lazy-engine",
  "truncate",
  "silent",
  "no-reveal",
  "collude",
  /** executor falsely reports the input missing (spam rule: penalized if the next executor commits) */
  "report-missing",
]);
export type OperatorBehavior = z.infer<typeof OperatorBehavior>;

/**
 * Signed output upload (PUT /v1/jobs/:id/outputs). The signature binds operator, job, outCommit and
 * the raw text hash. `raw` (the engine's unnormalized text) feeds the advisory validators only.
 */
export const OutputUpload = z.object({
  jobId: z.string(),
  operator: z.string(),
  outCommit: z.string(),
  text: z.string(),
  raw: z.string().max(8192).default(""),
  signature: z.string(),
});
export type OutputUpload = z.infer<typeof OutputUpload>;
export const outputUploadMessage = (u: { jobId: string; operator: string; outCommit: string; rawHash: string }) =>
  `hallmark-output:${u.jobId.toLowerCase()}:${u.operator.toLowerCase()}:${u.outCommit.toLowerCase()}:${u.rawHash.toLowerCase()}`;

/**
 * Signed read request for private evidence (job salt, input, outputs): headers
 *   X-Hallmark-Address, X-Hallmark-Timestamp (unix s), X-Hallmark-Signature over readMessage(...).
 * Accepted for operators holding a role on the job and for the gateway's listed watchers.
 */
/**
 * Direct (non-gateway) job registration with the evidence store, signed by the buyer key BEFORE it calls
 * Hallmark.createJob itself. Binds the job id, input, salt commitment and model to the buyer address.
 */
export const registerMessage = (r: { jobId: string; inputHash: string; saltCommit: string; modelId: string; buyer: string }) =>
  `hallmark-register:${r.jobId.toLowerCase()}:${r.inputHash.toLowerCase()}:${r.saltCommit.toLowerCase()}:${r.modelId.toLowerCase()}:${r.buyer.toLowerCase()}`;
export const DirectJobRegistration = z.object({
  jobId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  modelId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  jobSalt: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  buyer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** base64 input bytes */
  input: z.string().min(1),
  signature: z.string(),
});
export type DirectJobRegistration = z.infer<typeof DirectJobRegistration>;

export const readMessage = (jobId: string, address: string, ts: number) => `hallmark-read:${jobId.toLowerCase()}:${address.toLowerCase()}:${ts}`;
