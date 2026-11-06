import { AbiCoder, Contract, Interface, keccak256, type ContractRunner } from "ethers";
import HallmarkAbi from "./abi/Hallmark.json" with { type: "json" };
import JudgeAbi from "./abi/HallmarkJudge.json" with { type: "json" };
import RegistryAbi from "./abi/ModelRegistry.json" with { type: "json" };
import VerdictAbi from "./abi/HallmarkVerdict.json" with { type: "json" };
import ProbeAbi from "./abi/Probe.json" with { type: "json" };
import ProbeWrapperAbi from "./abi/ProbeWrapper.json" with { type: "json" };

export const abis = {
  Hallmark: HallmarkAbi,
  HallmarkJudge: JudgeAbi,
  ModelRegistry: RegistryAbi,
  HallmarkVerdict: VerdictAbi,
  Probe: ProbeAbi,
  ProbeWrapper: ProbeWrapperAbi,
} as const;

export const ifaces = {
  core: new Interface(HallmarkAbi),
  judge: new Interface(JudgeAbi),
  registry: new Interface(RegistryAbi),
  verdict: new Interface(VerdictAbi),
};

/** Mirrors Hallmark.Status */
export enum Status {
  None = 0,
  Assigned = 1,
  Committed = 2,
  VerifierCommit = 3,
  Reveal = 4,
  Challenge = 5,
  Text = 6,
  CommitteeCommit = 7,
  CommitteeReveal = 8,
  Settled = 9,
  Refunded = 10,
  /** both drawn executors reported the input missing: refunded minus the void fee */
  Voided = 11,
}
export const statusName = (s: number | bigint) => Status[Number(s)] ?? `Unknown(${s})`;
export const isTerminal = (s: number | bigint) => Number(s) === Status.Settled || Number(s) === Status.Refunded || Number(s) === Status.Voided;

/** Mirrors IHallmarkVerdict.Verdict */
export enum Verdict {
  Pending = 0,
  FinalAudited = 1,
  FinalUnaudited = 2,
  ExecutorSlashed = 3,
  Refunded = 4,
  Voided = 5,
  AuditSkipped = 6,
}
export const verdictName = (v: number | bigint) => Verdict[Number(v)] ?? `Unknown(${v})`;

export const Role = { Executor: 1, Verifier: 2, Member: 3 } as const;
export const Outcome = { Agreed: 1, VerifierWrong: 2, ExecutorWrong: 3, BothConsistent: 4, Inconclusive: 5 } as const;
export const SlashReason = {
  NoCommit: 1,
  NoReveal: 2,
  VerifierNoShow: 3,
  Wrong: 4,
  MemberNoShow: 5,
  MemberMismatch: 6,
  NoText: 7,
} as const;
export const PayKind = { Fee: 1, Verifier: 2, Member: 3, Finder: 4, ChallengeRefund: 5, ChallengeForfeit: 6, VoidFee: 7 } as const;
export const ModelClass = { EXACT: 0, TOLERANCE: 1 } as const;

export interface Addresses {
  HALLMARK_ADDRESS: string;
  JUDGE_ADDRESS: string;
  REGISTRY_ADDRESS: string;
  /** HallmarkVerdict (IHallmarkVerdict view over the core); optional for older deployments */
  VERDICT_ADDRESS?: string;
}

export function connect(addrs: Addresses, runner: ContractRunner) {
  return {
    core: new Contract(addrs.HALLMARK_ADDRESS, HallmarkAbi, runner),
    judge: new Contract(addrs.JUDGE_ADDRESS, JudgeAbi, runner),
    registry: new Contract(addrs.REGISTRY_ADDRESS, RegistryAbi, runner),
    verdict: addrs.VERDICT_ADDRESS ? new Contract(addrs.VERDICT_ADDRESS, VerdictAbi, runner) : null,
  };
}
export type Contracts = ReturnType<typeof connect>;

export const COMMIT_DOMAIN = keccak256(new TextEncoder().encode("HALLMARK_COMMIT_V2"));

export const OUT_DOMAIN = keccak256(new TextEncoder().encode("HALLMARK_OUT_V1"));

/** Off-chain twin of Hallmark.commitmentFor: an operator's blinded commitment to its outCommit. */
export function commitment(p: {
  chainId: number | bigint;
  core: string;
  jobId: string;
  who: string;
  outCommit: string;
  commitSalt: string;
}): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "bytes32", "address", "bytes32", "bytes32"],
      [COMMIT_DOMAIN, p.chainId, p.core, p.jobId, p.who, p.outCommit, p.commitSalt],
    ),
  );
}

/**
 * Off-chain twin of Hallmark.outCommitFor (add-on A1): the salted output commitment that replaces a
 * plain text hash everywhere on chain. Without jobSalt a guessed text cannot be tested against it.
 */
export function outCommitOf(p: { chainId: number | bigint; core: string; jobId: string; jobSalt: string; text: string }): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes"],
      [OUT_DOMAIN, p.chainId, p.core, p.jobId, p.jobSalt, new TextEncoder().encode(p.text)],
    ),
  );
}

/** saltCommit = keccak256(jobSalt) as stored in the job; operators check it before working. */
export const saltCommitOf = (jobSalt: string) => keccak256(jobSalt);

/** Model key (a manifest's modelKey) -> on-chain model id (keccak256 of the UTF-8 key). */
export const modelIdOf = (key: string) => keccak256(new TextEncoder().encode(key));

/** Plain-object view of Hallmark.getJob (bigints kept for amounts). */
export interface JobView {
  buyer: string;
  status: number;
  cls: number;
  normSpec: number;
  tauBps: number;
  auditBps: number;
  audited: boolean;
  auditSkipped: boolean;
  challenged: boolean;
  redraws: number;
  committeeSize: number;
  executor: string;
  deadline: number;
  committed: number;
  revealedCount: number;
  minWords: number;
  verifier: string;
  maxWords: number;
  challenger: string;
  createdAt: number;
  modelId: string;
  inputHash: string;
  saltCommit: string;
  fee: bigint;
  protocolFee: bigint;
  auditFee: bigint;
  bond: bigint;
  challengeBond: bigint;
  reward: bigint;
  /** first executor that reported the input missing (zero address if none) */
  missingBy: string;
  /** unix seconds when the job became final (0 while open) */
  finalizedAt: number;
  executorSlashed: boolean;
}

export async function readJob(core: Contract, jobId: string): Promise<JobView> {
  const j = await core.getJob(jobId);
  return {
    buyer: j.buyer,
    status: Number(j.status),
    cls: Number(j.cls),
    normSpec: Number(j.normSpec),
    tauBps: Number(j.tauBps),
    auditBps: Number(j.auditBps),
    audited: j.audited,
    auditSkipped: j.auditSkipped,
    challenged: j.challenged,
    redraws: Number(j.redraws),
    committeeSize: Number(j.committeeSize),
    executor: j.executor,
    deadline: Number(j.deadline),
    committed: Number(j.committed),
    revealedCount: Number(j.revealedCount),
    minWords: Number(j.minWords),
    verifier: j.verifier,
    maxWords: Number(j.maxWords),
    challenger: j.challenger,
    createdAt: Number(j.createdAt),
    modelId: j.modelId,
    inputHash: j.inputHash,
    saltCommit: j.saltCommit,
    fee: BigInt(j.fee),
    protocolFee: BigInt(j.protocolFee),
    auditFee: BigInt(j.auditFee),
    bond: BigInt(j.bond),
    challengeBond: BigInt(j.challengeBond),
    reward: BigInt(j.reward),
    missingBy: j.missingBy,
    finalizedAt: Number(j.finalizedAt),
    executorSlashed: j.executorSlashed,
  };
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Best-effort decode of a custom error from any of our contracts. */
export function decodeError(err: unknown): string {
  const data = findRevertData(err);
  if (data) {
    for (const i of Object.values(ifaces)) {
      try {
        const e = i.parseError(data);
        if (e) return e.args.length ? `${e.name}(${e.args.join(", ")})` : e.name;
      } catch {
        /* try next */
      }
    }
    return `revert ${data}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function findRevertData(e: unknown, seen = new Set<unknown>()): string | null {
  if (!e || typeof e !== "object" || seen.has(e)) return null;
  seen.add(e);
  const o = e as Record<string, unknown>;
  for (const k of ["data", "result"]) {
    if (typeof o[k] === "string" && /^0x[0-9a-fA-F]{8}/.test(o[k] as string)) return o[k] as string;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === "transaction" || k === "payload") continue;
    const r = findRevertData(v, seen);
    if (r) return r;
  }
  return null;
}
