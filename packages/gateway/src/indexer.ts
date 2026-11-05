import { EventEmitter } from "node:events";
import type { JsonRpcProvider } from "ethers";
import { ifaces, logger, outCommitOf, Role, SlashReason, statusName, type ChainEvent, type LogSource } from "@hallmark/shared";
import type { Db } from "./db.js";

const log = logger("indexer");

function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object" && "toArray" in (v as object)) return plain((v as { toArray(): unknown[] }).toArray());
  return v;
}

/** ethers Result -> plain JSON object keyed by parameter name */
export function argsOf(e: ChainEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const frag = ifaces.core.getEvent(e.name);
  frag?.inputs.forEach((inp, i) => (out[inp.name] = plain(e.args[i])));
  return out;
}

/**
 * Follows Hallmark events (Mirror Node by default, persisted cursor) into SQLite and an in-process
 * bus that drives SSE. It also recovers posted text from calldata (postText / revealText), so the
 * keeper can call compareTexts / resolve even if an operator never uploads to the evidence store.
 */
export class Indexer {
  readonly bus = new EventEmitter();
  private timer: NodeJS.Timeout | null = null;
  private gen = 0;

  constructor(
    private readonly d: { db: Db; source: LogSource; pollMs: number; cursorKey: string; provider: JsonRpcProvider | null; chainId: number; core: string },
  ) {
    this.bus.setMaxListeners(1000);
  }

  start() {
    const gen = ++this.gen;
    const tick = async () => {
      try {
        await this.pollOnce();
      } catch (e) {
        log.warn("poll failed", { error: String(e) });
      }
      if (gen === this.gen) this.timer = setTimeout(tick, this.d.pollMs);
    };
    void tick();
  }

  stop() {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
  }

  async pollOnce() {
    const events = await this.d.source.poll();
    for (const e of events) await this.apply(e);
    const c = this.d.source.cursor();
    if (c) this.d.db.set(this.d.cursorKey, c);
  }

  private async apply(e: ChainEvent) {
    const a = argsOf(e);
    const jobId = typeof a.jobId === "string" ? a.jobId.toLowerCase() : null;
    const fresh = this.d.db.insertEvent({ job_id: jobId, name: e.name, args: JSON.stringify(a), tx_hash: e.txHash, log_index: e.logIndex, position: e.position });
    if (!fresh) return;
    if (jobId && this.d.db.job(jobId)) this.project(jobId, e.name, a);
    if (e.name === "TextPosted" || (e.name === "Revealed" && Number(a.role) === Role.Member)) await this.recoverText(e, a);
    this.bus.emit("event", { name: e.name, jobId, args: a, tx: e.txHash });
  }

  private project(jobId: string, name: string, a: Record<string, unknown>) {
    const db = this.d.db;
    switch (name) {
      case "JobCreated":
        db.update(jobId, { executor: String(a.executor), bond: String(a.bond), payment_status: "Created" });
        break;
      case "StatusChanged":
        db.update(jobId, { chain_status: statusName(Number(a.status)), deadline: Number(a.deadline) || null });
        break;
      case "AuditDrawn":
        db.update(jobId, { audited: a.audited ? 1 : 0 });
        break;
      case "VerifierAssigned":
        db.update(jobId, { verifier: String(a.verifier) });
        break;
      case "CommitteeDrawn":
        db.update(jobId, { members: JSON.stringify(a.members) });
        break;
      case "Challenged":
        db.update(jobId, { challenged: 1, audited: 1 });
        break;
      case "Resolved":
        db.update(jobId, { outcome: Number(a.outcome) });
        break;
      case "Slashed": {
        const row = db.job(jobId);
        if (Number(a.reason) === SlashReason.Wrong && row?.executor?.toLowerCase() === String(a.who).toLowerCase()) db.update(jobId, { slashed_wrong: 1 });
        break;
      }
      case "JobSettled":
        db.update(jobId, { audit_skipped: a.auditSkipped ? 1 : 0 });
        break;
    }
  }

  /** decode the text from the transaction calldata and keep it if it matches a hash on chain */
  private async recoverText(e: ChainEvent, a: Record<string, unknown>) {
    if (!this.d.provider) return;
    try {
      const tx = await this.d.provider.getTransaction(e.txHash);
      if (!tx) return;
      const p = ifaces.core.parseTransaction({ data: tx.data });
      if (!p || (p.name !== "postText" && p.name !== "revealText")) return;
      const text = new TextDecoder().decode(Buffer.from(String(p.args[1]).slice(2), "hex"));
      const row = this.d.db.job(String(a.jobId));
      if (!row) return;
      const out = outCommitOf({ chainId: this.d.chainId, core: this.d.core, jobId: String(a.jobId), jobSalt: row.job_salt, text });
      this.d.db.putOutput({ job_id: String(a.jobId), operator: String(a.who), out_commit: out, text, raw: "", source: "calldata" });
    } catch (err) {
      log.warn("could not recover text from calldata", { tx: e.txHash, error: String(err) });
    }
  }
}
