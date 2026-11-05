import {
  logger,
  ModelClass,
  normalize,
  outputHashOf,
  overlapText,
  readJob,
  Status,
  toWire,
  TxRevert,
  TxSender,
  type ChainEvent,
  type Contracts,
  type LogSource,
  type NormSpec,
  type WireUnits,
} from "@hallmark/shared";
import type { EvidenceClient } from "./evidence.js";
import { taskOfSpec } from "./operator.js";
import type { Worker } from "./worker.js";

/**
 * Challenger bot (section 8.3 challenge): re-runs every unaudited result during its challenge
 * window and challenges when the executor's output does not match (EXACT: different hash;
 * TOLERANCE: overlap below tau minus a safety margin). This is what catches a colluding pair that
 * the random audit missed (edge case 13). Spends at most `budgetTinybar` on challenge bonds.
 */
export class Challenger {
  private readonly log = logger("challenger");
  private timer: NodeJS.Timeout | null = null;
  private seen = new Set<string>();
  private spentTinybar = 0n;
  private gen = 0;

  constructor(
    private readonly d: {
      contracts: Contracts;
      sender: TxSender;
      source: LogSource;
      worker: Worker;
      evidence: EvidenceClient;
      units: WireUnits;
      budgetTinybar: bigint;
      marginBps: number;
      pollMs: number;
      onCursor?: (c: string) => void;
    },
  ) {}

  start() {
    const gen = ++this.gen;
    const tick = async () => {
      try {
        const events = await this.d.source.poll();
        for (const e of events) await this.onEvent(e);
        const c = this.d.source.cursor();
        if (c) this.d.onCursor?.(c);
      } catch (e) {
        this.log.warn("poll failed", { error: String(e) });
      }
      if (gen === this.gen) this.timer = setTimeout(tick, this.d.pollMs);
    };
    void tick();
  }

  stop() {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
  }

  private async onEvent(e: ChainEvent) {
    if (e.name === "StatusChanged" && Number(e.args.status) === Status.Challenge) {
      await this.consider(String(e.args.jobId)).catch((err) => this.log.warn("consider failed", { error: String(err) }));
    }
  }

  async consider(jobId: string) {
    if (this.seen.has(jobId)) return;
    this.seen.add(jobId);
    const core = this.d.contracts.core;
    const j = await readJob(core, jobId);
    if (j.status !== Status.Challenge) return;
    if (this.spentTinybar + j.challengeBond > this.d.budgetTinybar) {
      this.log.warn("challenge budget exhausted; skipping", { jobId });
      return;
    }
    const eHash = String((await core.seat(jobId, j.executor)).outputHash);
    const input = await this.d.evidence.input(j.inputHash);
    const mine = normalize(await this.d.worker.run(taskOfSpec(j.normSpec), input), j.normSpec as NormSpec).text;
    let reason: string | null = null;
    if (outputHashOf(mine).toLowerCase() === eHash.toLowerCase()) reason = null;
    else if (j.cls === ModelClass.EXACT) reason = "hash differs (exact class)";
    else {
      const theirs = await this.d.evidence.outputByHash(eHash);
      if (theirs === null) reason = "executor text unavailable in the evidence store";
      else {
        const ov = overlapText(mine, theirs);
        this.log.info("checked provisional result", { jobId, overlapBps: ov, tau: j.tauBps });
        if (ov < j.tauBps - this.d.marginBps) reason = `overlap ${ov} < tau ${j.tauBps} - margin ${this.d.marginBps}`;
      }
    }
    if (!reason) return;
    try {
      const r = await this.d.sender.send(core, "challenge", [jobId], { value: toWire(j.challengeBond, this.d.units), gasLimit: 3_000_000, label: "challenge" });
      this.spentTinybar += j.challengeBond;
      this.log.warn("challenged", { jobId, reason, tx: r.hash });
    } catch (e) {
      this.log.warn("challenge failed", { jobId, error: e instanceof TxRevert ? e.reason : String(e) });
    }
  }
}
