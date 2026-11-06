/**
 * @hallmark/sdk (0.x alpha): a thin client for the Hallmark core.
 *
 *   const hm = new HallmarkClient({ signer, contracts: { hallmark, verdict }, evidenceUrl });
 *   const job = await hm.createJob({ modelKey: "<a manifest modelKey>", input });   // you pay the contract
 *   const v = await hm.waitForVerdict(job.jobId);                                    // FinalAudited, ...
 *   const r = await hm.result(job);                                                   // text, checked against the chain
 *
 * createJob talks to the contract directly: the SDK puts the input and a fresh job salt in the evidence
 * store (signed by your key), then calls Hallmark.createJob from your account with the quoted price.
 * The x402 gateway is one optional adapter (`viaX402`), not a requirement.
 *
 * What a verdict means: FinalAudited = a second bonded operator re-ran the pinned model and agreed (or a
 * committee upheld it). FinalUnaudited / AuditSkipped = settled WITHOUT a re-run (bond-backed only).
 * It checks fidelity to the pinned model, not whether the output is true.
 */
import { AbiCoder, Contract, hexlify, keccak256, randomBytes, type Signer } from "ethers";
import HallmarkAbi from "@hallmark/shared/abi/Hallmark.json" with { type: "json" };
import VerdictAbi from "@hallmark/shared/abi/HallmarkVerdict.json" with { type: "json" };

export const VERDICTS = ["Pending", "FinalAudited", "FinalUnaudited", "ExecutorSlashed", "Refunded", "Voided", "AuditSkipped"] as const;
export type VerdictName = (typeof VERDICTS)[number];

export interface HallmarkContracts {
  /** Hallmark core contract */
  hallmark: string;
  /** HallmarkVerdict (IHallmarkVerdict) view contract */
  verdict: string;
}

export interface ClientOptions {
  /** an ethers Signer connected to a provider for the Hallmark chain; it pays and is the buyer */
  signer: Signer;
  contracts: HallmarkContracts;
  /** evidence store base URL (a Hallmark gateway serves one) */
  evidenceUrl: string;
  /** gas limit for createJob and keeper calls (Hedera needs an explicit one) */
  gasLimit?: number;
  /** legacy gas price in wei (Hedera: reserve-based fees); default: provider fee data */
  gasPrice?: bigint;
  /**
   * wire value per tinybar for msg.value: Hedera's JSON-RPC relay takes weibar (1 tinybar = 1e10 wei);
   * local EVM test chains use 1. Default 1e10 for chain 296/295, else 1.
   */
  weiPerTinybar?: bigint;
}

export interface CreatedJob {
  jobId: string;
  modelId: string;
  inputHash: string;
  priceTinybar: bigint;
  /** bearer capability for the result in the evidence store */
  accessToken: string;
  /** the salt that opens the output commitment (keep it private until you read the result) */
  jobSalt: string;
  txHash: string;
}

export interface Verdict {
  jobId: string;
  verdict: VerdictName;
  /** true only for FinalAudited */
  audited: boolean;
  final: boolean;
  outCommit: string;
  finalizedAt: number;
}

export interface CheckedResult {
  jobId: string;
  text: string;
  verdict: VerdictName;
  /** the delivered text opens the executor's on-chain output commitment */
  commitmentMatches: boolean;
}

const ZERO32 = "0x" + "00".repeat(32);
const OUT_DOMAIN = keccak256(new TextEncoder().encode("HALLMARK_OUT_V1"));

/** keccak256(utf8(key)): the on-chain id of a model manifest's modelKey */
export const modelIdOf = (modelKey: string) => keccak256(new TextEncoder().encode(modelKey));

/** Hallmark.outCommitFor, off chain */
export function outCommitOf(p: { chainId: bigint | number; hallmark: string; jobId: string; jobSalt: string; text: string }): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes"],
      [OUT_DOMAIN, p.chainId, p.hallmark, p.jobId, p.jobSalt, new TextEncoder().encode(p.text)],
    ),
  );
}

const registerMessage = (r: { jobId: string; inputHash: string; saltCommit: string; modelId: string; buyer: string }) =>
  `hallmark-register:${r.jobId.toLowerCase()}:${r.inputHash.toLowerCase()}:${r.saltCommit.toLowerCase()}:${r.modelId.toLowerCase()}:${r.buyer.toLowerCase()}`;

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HallmarkClient {
  readonly core: Contract;
  readonly verdictView: Contract;
  private readonly base: string;

  constructor(private readonly o: ClientOptions) {
    this.core = new Contract(o.contracts.hallmark, HallmarkAbi, o.signer);
    this.verdictView = new Contract(o.contracts.verdict, VerdictAbi, o.signer);
    this.base = o.evidenceUrl.replace(/\/$/, "");
  }

  private async wire(tinybar: bigint): Promise<bigint> {
    if (this.o.weiPerTinybar !== undefined) return tinybar * this.o.weiPerTinybar;
    const { chainId } = await this.o.signer.provider!.getNetwork();
    return chainId === 296n || chainId === 295n ? tinybar * 10_000_000_000n : tinybar;
  }

  private async txOpts(value?: bigint) {
    const gasPrice = this.o.gasPrice ?? (await this.o.signer.provider!.getFeeData()).gasPrice ?? undefined;
    return { gasLimit: this.o.gasLimit ?? 3_000_000, type: 0, gasPrice, ...(value !== undefined ? { value } : {}) };
  }

  /** price (tinybar), per-job bond, and whether the pool can take a job for this model now */
  async quote(modelKey: string) {
    const [price, bond, , available] = await this.core.quote(modelIdOf(modelKey));
    return { priceTinybar: BigInt(price), bondTinybar: BigInt(bond), available: Boolean(available) };
  }

  /** Register the input with the evidence store, then create the job on chain from your own account. */
  async createJob(p: { modelKey: string; input: Uint8Array }): Promise<CreatedJob> {
    const buyer = await this.o.signer.getAddress();
    const modelId = modelIdOf(p.modelKey);
    const q = await this.quote(p.modelKey);
    if (!q.available) throw new Error(`${p.modelKey} is not available right now (model disabled or not enough bonded operators); nothing was paid`);
    const jobId = hexlify(randomBytes(32));
    const jobSalt = hexlify(randomBytes(32));
    const inputHash = keccak256(p.input);
    const saltCommit = keccak256(jobSalt);
    const signature = await this.o.signer.signMessage(registerMessage({ jobId, inputHash, saltCommit, modelId, buyer }));
    const res = await fetch(`${this.base}/v1/core/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, modelId, jobSalt, buyer, input: b64(p.input), signature }),
    });
    const reg = (await res.json().catch(() => ({}))) as { locator?: string; accessToken?: string; inputHash?: string; error?: string };
    if (!res.ok) throw new Error(`evidence store refused the input (HTTP ${res.status}): ${reg.error ?? "unknown"}; nothing was paid`);
    if (reg.inputHash?.toLowerCase() !== inputHash.toLowerCase()) throw new Error("evidence store reported a different input hash; nothing was paid");
    const tx = await this.core.createJob(jobId, buyer, inputHash, saltCommit, modelId, reg.locator ?? this.base, await this.txOpts(await this.wire(q.priceTinybar)));
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error(`createJob failed: ${tx.hash}`);
    return { jobId, modelId, inputHash, priceTinybar: q.priceTinybar, accessToken: reg.accessToken!, jobSalt, txHash: tx.hash };
  }

  /** The verdict as other contracts read it (IHallmarkVerdict). */
  async verdict(jobId: string): Promise<Verdict> {
    const [v, oc, at] = await Promise.all([this.verdictView.status(jobId), this.verdictView.outCommit(jobId), this.verdictView.finalizedAt(jobId)]);
    const name = VERDICTS[Number(v)] ?? "Pending";
    return { jobId, verdict: name, audited: name === "FinalAudited", final: Number(at) !== 0, outCommit: String(oc), finalizedAt: Number(at) };
  }

  /**
   * Poll until the verdict is final. With `poke` (default), also advance the job when it is due:
   * drawAudit after the commit, settle after the challenge window, expire a stalled stage. Anyone may
   * call these; a gateway keeper usually does it first.
   */
  async waitForVerdict(jobId: string, opts: { timeoutMs?: number; pollMs?: number; poke?: boolean } = {}): Promise<Verdict> {
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const v = await this.verdict(jobId);
      if (v.final) return v;
      if (Date.now() > deadline) throw new Error(`timed out waiting for the verdict of ${jobId}`);
      if (opts.poke !== false) await this.poke(jobId).catch(() => undefined);
      await sleep(opts.pollMs ?? 4000);
    }
  }

  /** Advance a job one step if it is due (no-op otherwise). Returns the action taken. */
  async poke(jobId: string): Promise<string | null> {
    const j = await this.core.getJob(jobId);
    const st = Number(j.status);
    const now = Math.floor(Date.now() / 1000);
    const late = now > Number(j.deadline) + 2;
    if (st === 2) {
      await (await this.core.drawAudit(jobId, await this.txOpts())).wait();
      return "drawAudit";
    }
    if (st === 5 && late) {
      await (await this.core.settle(jobId, await this.txOpts())).wait();
      return "settle";
    }
    if (late && [1, 3, 4, 6, 7].includes(st)) {
      await (await this.core.expire(jobId, await this.txOpts())).wait();
      return "expire";
    }
    return null;
  }

  /** Read the result from the evidence store and check it against the chain. */
  async result(job: { jobId: string; accessToken: string }): Promise<CheckedResult> {
    const res = await fetch(`${this.base}/v1/jobs/${job.jobId}/result`, { headers: { Authorization: `Bearer ${job.accessToken}` } });
    const body = (await res.json().catch(() => ({}))) as { text?: string; jobSalt?: string; error?: string };
    const v = await this.verdict(job.jobId);
    if (res.status !== 200 || typeof body.text !== "string" || typeof body.jobSalt !== "string") {
      throw new Error(`no result for ${job.jobId} (${v.verdict}${body.error ? `: ${body.error}` : ""})`);
    }
    const { chainId } = await this.o.signer.provider!.getNetwork();
    const mine = outCommitOf({ chainId, hallmark: this.o.contracts.hallmark, jobId: job.jobId, jobSalt: body.jobSalt, text: body.text });
    const onChain = v.outCommit !== ZERO32 ? v.outCommit : String((await this.core.seat(job.jobId, (await this.core.getJob(job.jobId)).executor)).outCommit);
    return { jobId: job.jobId, text: body.text, verdict: v.verdict, commitmentMatches: mine.toLowerCase() === onChain.toLowerCase() };
  }

  /**
   * Independent check from public chain data only: the job exists, commits to `input` (if given), and
   * its verdict. Use hallmark-verify for the full re-derivation of every step.
   */
  async verify(jobId: string, input?: Uint8Array) {
    const j = await this.core.getJob(jobId);
    const v = await this.verdict(jobId);
    return {
      exists: Number(j.status) !== 0,
      inputMatches: input ? keccak256(input).toLowerCase() === String(j.inputHash).toLowerCase() : null,
      buyer: String(j.buyer),
      modelId: String(j.modelId),
      verdict: v.verdict,
      audited: v.audited,
      final: v.final,
    };
  }
}

/**
 * Optional adapter: pay through an x402 gateway instead of calling the contract yourself. Pass a fetch
 * that already handles x402 (e.g. wrapFetchWithPayment from @x402/fetch with a Hedera signer). The
 * gateway settles, creates the job with you as buyer, and returns the same job id and access token.
 */
export async function viaX402(p: { gatewayUrl: string; endpoint: string; input: Uint8Array; filename: string; fetchWithPayment: typeof fetch }) {
  const form = new FormData();
  form.append("file", new Blob([p.input]), p.filename);
  const res = await p.fetchWithPayment(`${p.gatewayUrl.replace(/\/$/, "")}${p.endpoint}`, { method: "POST", body: form });
  if (res.status !== 202) throw new Error(`gateway answered ${res.status}: ${await res.text()}`);
  const acc = (await res.json()) as { jobId: string; accessToken: string; inputHash: string };
  if (acc.inputHash.toLowerCase() !== keccak256(p.input).toLowerCase()) throw new Error("gateway reported a different input hash");
  return { jobId: acc.jobId, accessToken: acc.accessToken };
}

