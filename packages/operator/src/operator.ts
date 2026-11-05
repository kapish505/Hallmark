import { hexlify, randomBytes, toUtf8Bytes, type Wallet } from "ethers";
import {
  commitment,
  isTerminal,
  logger,
  ModelClass,
  NormError,
  outputHashOf,
  readJob,
  Role,
  Status,
  toWire,
  TxRevert,
  TxSender,
  validate,
  type ChainEvent,
  type Contracts,
  type LogSource,
  type NormSpec,
  type OperatorBehavior,
  type Task,
  type WireUnits,
} from "@hallmark/shared";
import { produceOutput } from "./behaviors.js";
import { evidenceRef, type EvidenceClient } from "./evidence.js";
import type { PendingRecord, PendingStore, StateFile } from "./store.js";
import type { Worker } from "./worker.js";

export interface OperatorDeps {
  contracts: Contracts;
  sender: TxSender;
  wallet: Wallet;
  source: LogSource;
  worker: Worker;
  evidence: EvidenceClient;
  evidenceBase: string;
  pending: PendingStore;
  state: StateFile;
  /** behavior for a role on a job (role-aware so the attack lab can e.g. make only committee seats silent) */
  behavior: (role: number, jobId: string) => OperatorBehavior;
  chainId: number;
  units: WireUnits;
  gasLimit: number;
  gasLimitHeavy: number;
  pollMs: number;
  lazyModel: string;
  /** tasks this operator has workers for; jobs for other tasks are left to time out (penalty) */
  tasks: Task[];
  name?: string;
}

export const taskOfSpec = (spec: number): Task => (spec === 2 ? "ocr" : "asr");

/**
 * Operator loop (section 9.2). One process serves every role it is drawn for:
 *   executor (JobCreated), verifier (VerifierAssigned), committee member (CommitteeDrawn).
 * For each: fetch input -> verify hash -> run pinned model -> normalize -> PERSIST {output, salt}
 * -> commit -> reveal (hash, or text for tolerance committee) -> postText if asked -> upload text.
 * Every step is decided from chain state, so a restart picks up exactly where it stopped.
 */
export class Operator {
  private readonly log;
  private timer: NodeJS.Timeout | null = null;
  private working = new Set<string>();
  private advancing = new Map<string, Promise<void>>();
  private gen = 0;
  readonly address: string;

  constructor(private readonly d: OperatorDeps) {
    this.address = d.sender.address;
    this.log = logger(d.name ?? `operator:${this.address.slice(0, 8)}`);
  }

  private me(a: string) {
    return a.toLowerCase() === this.address.toLowerCase();
  }

  /** Register with `stakeTinybar` if not registered yet. */
  async ensureRegistered(stakeTinybar: bigint | null) {
    const o = await this.d.contracts.core.operators(this.address);
    if (o.registered) {
      this.log.info("registered", { free: o.free.toString(), locked: o.locked.toString() });
      return;
    }
    if (!stakeTinybar) throw new Error("operator not registered and STAKE_TINYBAR not set");
    const r = await this.d.sender.send(this.d.contracts.core, "registerOperator", [], {
      value: toWire(stakeTinybar, this.d.units),
      label: "registerOperator",
    });
    this.log.info("registered operator", { stake: stakeTinybar.toString(), tx: r.hash });
  }

  start() {
    const gen = ++this.gen;
    const tick = async () => {
      try {
        await this.pollOnce();
      } catch (e) {
        this.log.warn("poll failed", { error: String(e) });
      }
      if (gen === this.gen) this.timer = setTimeout(tick, this.d.pollMs);
    };
    void this.recover().finally(() => void tick());
  }

  stop() {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
  }

  async pollOnce() {
    const events = await this.d.source.poll();
    for (const e of events) this.onEvent(e);
    const c = this.d.source.cursor();
    if (c) this.d.state.set("cursor", c);
    for (const r of this.d.pending.all()) {
      if (!this.working.has(r.jobId)) await this.advance(r.jobId).catch((e) => this.warn("advance failed", r.jobId, e));
    }
  }

  private warn(msg: string, jobId: string, e: unknown) {
    this.log.warn(msg, { jobId, error: e instanceof TxRevert ? e.reason : String(e) });
  }

  private onEvent(e: ChainEvent) {
    const jobId = e.args.jobId ? String(e.args.jobId) : null;
    if (!jobId) return;
    if (e.name === "JobCreated" && this.me(String(e.args.executor))) void this.take(jobId, Role.Executor);
    else if (e.name === "VerifierAssigned" && this.me(String(e.args.verifier))) void this.take(jobId, Role.Verifier);
    else if (e.name === "CommitteeDrawn" && (e.args.members as string[]).some((m) => this.me(String(m)))) void this.take(jobId, Role.Member);
    else if (e.name === "StatusChanged" && this.d.pending.get(jobId)) void this.advance(jobId).catch((err) => this.warn("advance failed", jobId, err));
  }

  async recover() {
    for (const r of this.d.pending.all()) {
      this.log.info("recovering pending job", { jobId: r.jobId, role: r.role, committed: r.committed, revealed: r.revealed });
      await this.advance(r.jobId).catch((e) => this.warn("recover failed", r.jobId, e));
    }
  }

  /** Produce and persist this operator's output for a role it was just drawn for. */
  async take(jobId: string, role: number) {
    if (this.working.has(jobId) || this.d.pending.get(jobId)?.role === role) return;
    this.working.add(jobId);
    try {
      const j = await readJob(this.d.contracts.core, jobId);
      const task = taskOfSpec(j.normSpec);
      if (!this.d.tasks.includes(task)) {
        this.log.error(`drawn for a ${task} job but no ${task} worker is configured`, { jobId });
        return;
      }
      const behavior = this.d.behavior(role, jobId);
      const input = await this.d.evidence.input(j.inputHash); // throws on hash mismatch (edge case 22)
      const lastKey = `lastHonest:${task}`;
      const last = this.d.state.get(lastKey);
      const other = last ? (JSON.parse(last) as { inputHash: string; output: string }) : null;
      let output: string | null;
      try {
        output = await produceOutput(
          behavior,
          {
            jobId,
            task,
            spec: j.normSpec as NormSpec,
            input,
            otherOutput: other && other.inputHash !== j.inputHash ? other.output : null,
            lazyModel: this.d.lazyModel,
          },
          this.d.worker,
        );
      } catch (e) {
        this.log.error("could not produce a valid output; not committing", { jobId, error: e instanceof NormError ? `${e.code}: ${e.message}` : String(e) });
        return;
      }
      if (output === null) {
        this.log.warn("behavior=silent: not committing", { jobId, role });
        return;
      }
      const words = validate(output, j.normSpec as NormSpec);
      if (words < j.minWords || words > j.maxWords) {
        this.log.error("output word count outside model bounds; not committing", { jobId, words });
        return;
      }
      const salt = hexlify(randomBytes(32));
      const outputHash = outputHashOf(output);
      const c = commitment({ chainId: this.d.chainId, core: await this.d.contracts.core.getAddress(), jobId, who: this.address, outputHash, salt });
      // persist BEFORE the commit transaction exists
      this.d.pending.save({ jobId, role, task, output, salt, outputHash, commitment: c, behavior, committed: false, revealed: false, textPosted: false, uploaded: false });
      if (behavior === "honest") this.d.state.set(lastKey, JSON.stringify({ inputHash: j.inputHash, output }));
      this.log.info("output ready", { jobId, role, task, behavior, words });
      await this.advance(jobId);
    } catch (e) {
      this.warn("job failed", jobId, e);
    } finally {
      this.working.delete(jobId);
    }
  }

  advance(jobId: string): Promise<void> {
    const running = this.advancing.get(jobId);
    if (running) return running;
    const p = this.advanceOnce(jobId).finally(() => this.advancing.delete(jobId));
    this.advancing.set(jobId, p);
    return p;
  }

  private async advanceOnce(jobId: string) {
    const r = this.d.pending.get(jobId);
    if (!r) return;
    const core = this.d.contracts.core;
    const j = await readJob(core, jobId);
    const s = await core.seat(jobId, this.address);
    const committed = s.commitment !== "0x" + "0".repeat(64);
    // done, or our bond was released/penalized (no longer a party to this job)
    if (isTerminal(j.status) || !s.bondHeld) {
      await this.uploadIfNeeded(r);
      this.d.pending.remove(jobId);
      return;
    }
    const isE = r.role === Role.Executor && this.me(j.executor);
    const isV = r.role === Role.Verifier && this.me(j.verifier);
    const isM = r.role === Role.Member && Number(s.role) === Role.Member;
    const ref = evidenceRef(this.d.evidenceBase, r.outputHash);

    const commitTurn =
      (j.status === Status.Assigned && isE) || (j.status === Status.VerifierCommit && isV) || (j.status === Status.CommitteeCommit && isM && s.bondHeld);
    if (commitTurn && !committed) {
      await this.d.sender.send(core, "commit", [jobId, r.commitment], { gasLimit: this.d.gasLimit, label: "commit" });
      this.save(r, { committed: true });
      this.log.info("committed", { jobId, role: r.role, behavior: r.behavior });
      return;
    }

    const revealTurn = (j.status === Status.Reveal && (isE || isV)) || (j.status === Status.CommitteeReveal && isM);
    if (revealTurn && committed && !s.revealed) {
      if (r.behavior === "no-reveal") {
        this.log.warn("behavior=no-reveal: withholding reveal", { jobId });
        return;
      }
      if (j.status === Status.CommitteeReveal && j.cls === ModelClass.TOLERANCE) {
        await this.d.sender.send(core, "revealText", [jobId, toUtf8Bytes(r.output), r.salt, ref], { gasLimit: this.d.gasLimitHeavy, label: "revealText" });
      } else {
        await this.d.sender.send(core, "reveal", [jobId, r.outputHash, r.salt, ref], { gasLimit: this.d.gasLimit, label: "reveal" });
      }
      this.save(r, { committed: true, revealed: true });
      this.log.info("revealed", { jobId, role: r.role });
      await this.uploadIfNeeded(this.d.pending.get(jobId)!);
      return;
    }

    if (j.status === Status.Text && (isE || isV) && !s.textPosted && r.behavior !== "no-reveal") {
      await this.d.sender.send(core, "postText", [jobId, toUtf8Bytes(r.output)], { gasLimit: this.d.gasLimitHeavy, label: "postText" });
      this.save(r, { textPosted: true });
      this.log.info("posted text", { jobId, role: r.role });
    }
    if (s.revealed) await this.uploadIfNeeded(r);
  }

  /** Output text goes to the evidence store only AFTER this operator's own reveal (blindness). */
  private async uploadIfNeeded(r: PendingRecord) {
    if (!r.revealed || r.uploaded) return;
    try {
      await this.d.evidence.upload(this.d.wallet, r.jobId, r.outputHash, r.output);
      this.save(r, { uploaded: true });
    } catch (e) {
      this.warn("evidence upload failed (will retry)", r.jobId, e);
    }
  }

  private save(r: PendingRecord, patch: Partial<PendingRecord>) {
    const cur = this.d.pending.get(r.jobId) ?? r;
    this.d.pending.save({ ...cur, ...patch });
  }
}
