import { getBytes, toUtf8Bytes } from "ethers";
import { isTerminal, logger, ModelClass, readJob, Status, TxRevert, TxSender, type Contracts } from "@hallmark/shared";
import type { Db } from "./db.js";

const log = logger("keeper");

/**
 * Liveness bot run by the gateway (any EOA could run it; every call is permissionless):
 * drawAudit after the executor commits, settle after the challenge window, compareTexts once both
 * texts are posted, resolve once the committee has revealed, and expire for any stalled stage.
 * It reads the chain directly (never trusts the DB for state).
 */
export class Keeper {
  private timer: NodeJS.Timeout | null = null;
  private gen = 0;
  private busy = false;

  constructor(private readonly d: { db: Db; contracts: Contracts; sender: TxSender; pollMs: number; gasLimitHeavy: number }) {}

  start() {
    const gen = ++this.gen;
    const tick = async () => {
      await this.tickOnce().catch((e) => log.warn("tick failed", { error: String(e) }));
      if (gen === this.gen) this.timer = setTimeout(tick, this.d.pollMs);
    };
    void tick();
  }

  stop() {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
  }

  async tickOnce() {
    if (this.busy) return;
    this.busy = true;
    try {
      const open = this.d.db.jobsWhere("payment_status = 'Created' AND (chain_status IS NULL OR chain_status NOT IN ('Settled', 'Refunded'))");
      for (const r of open) await this.step(r.job_id).catch((e) => log.warn("step failed", { jobId: r.job_id, error: e instanceof TxRevert ? e.reason : String(e) }));
    } finally {
      this.busy = false;
    }
  }

  private async send(method: string, args: unknown[], heavy = false) {
    const r = await this.d.sender.send(this.d.contracts.core, method, args, { label: method, gasLimit: heavy ? this.d.gasLimitHeavy : undefined });
    log.info(method, { jobId: args[0], tx: r.hash });
  }

  private async now() {
    const b = await this.d.sender.wallet.provider!.getBlock("latest");
    return b ? b.timestamp : Math.floor(Date.now() / 1000);
  }

  async step(jobId: string) {
    const core = this.d.contracts.core;
    const j = await readJob(core, jobId);
    if (j.status === Status.None || isTerminal(j.status)) return;
    const late = (await this.now()) > j.deadline;
    switch (j.status) {
      case Status.Committed:
        return this.send("drawAudit", [jobId]);
      case Status.Challenge:
        if (late) return this.send("settle", [jobId]);
        return;
      case Status.Text: {
        const [se, sv] = await Promise.all([core.seat(jobId, j.executor), core.seat(jobId, j.verifier)]);
        if (se.textPosted && sv.textPosted) {
          const te = this.d.db.outputByHash(se.outputHash);
          const tv = this.d.db.outputByHash(sv.outputHash);
          if (te !== null && tv !== null) return this.send("compareTexts", [jobId, toUtf8Bytes(te), toUtf8Bytes(tv)], true);
        }
        if (late) return this.send("expire", [jobId]);
        return;
      }
      case Status.CommitteeReveal: {
        if (j.revealedCount < j.committed && !late) return;
        let texts: Uint8Array[] = [];
        if (j.cls === ModelClass.TOLERANCE) {
          const members: string[] = await core.committeeOf(jobId);
          const parties = [j.executor, j.verifier, ...members];
          const seats = await Promise.all(parties.map((a) => core.seat(jobId, a)));
          texts = seats.map((s, i) => {
            if (i >= 2 && !s.revealed) return new Uint8Array();
            const t = this.d.db.outputByHash(s.outputHash);
            if (t === null) throw new Error(`text for ${s.outputHash} not available yet`);
            return toUtf8Bytes(t);
          });
        }
        return this.send("resolve", [jobId, texts.map((t) => getBytes(t))], true);
      }
      default:
        if (late && j.status !== Status.Committed) return this.send("expire", [jobId]);
    }
  }
}
