import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PaymentStatus =
  | "PendingSettlement" // handler returned 202, facilitator has not settled yet
  | "Settled" // payment settled, createJob not yet confirmed
  | "Created" // createJob confirmed on chain
  | "RefundPending" // createJob reverted, HAPI refund not yet confirmed (retried)
  | "Rejected" // createJob reverted and the payer was refunded
  | "SettlementFailed" // facilitator said success but the Mirror Node shows the transfer failed
  | "External" // direct job: registered here, the buyer pays the contract itself (no gateway payment)
  | "BuyerMismatch"; // direct job id was created on chain by a different buyer than the registrant

export interface JobRow {
  job_id: string;
  payment_key: string;
  task: string;
  model_id: string;
  input_hash: string;
  bytes: number;
  meta: string;
  price: string;
  /** add-on A1: never exposed publicly; only buyer, role operators and watchers may read it */
  job_salt: string;
  salt_commit: string;
  access_token: string;
  validator: string;
  payment_status: PaymentStatus;
  payer: string | null;
  buyer_evm: string | null;
  settle_tx: string | null;
  create_tx: string | null;
  refund_tx: string | null;
  error: string | null;
  chain_status: string | null;
  executor: string | null;
  verifier: string | null;
  members: string | null;
  bond: string | null;
  audited: number;
  audit_skipped: number;
  challenged: number;
  outcome: number | null;
  slashed_wrong: number;
  deadline: number | null;
  created_at: number;
  updated_at: number;
}

export interface EventRow {
  id: number;
  job_id: string | null;
  name: string;
  args: string;
  tx_hash: string;
  log_index: number;
  position: string;
}

export interface OutputRow {
  job_id: string;
  operator: string;
  /** the salted outCommit this text opens */
  out_commit: string;
  text: string;
  raw: string;
  source: string;
}

export interface CanaryRow {
  job_id: string;
  clip: string;
  task: string;
  status: string;
  badge: string;
  error: number;
  matched: number | null;
  pass: number;
  cost: string;
  at: number;
}

export class Db {
  readonly sql: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    this.sql.pragma("journal_mode = WAL");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        payment_key TEXT NOT NULL UNIQUE,
        task TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        meta TEXT NOT NULL DEFAULT '{}',
        price TEXT NOT NULL,
        job_salt TEXT NOT NULL, salt_commit TEXT NOT NULL, access_token TEXT NOT NULL, validator TEXT NOT NULL DEFAULT 'none',
        payment_status TEXT NOT NULL,
        payer TEXT, buyer_evm TEXT, settle_tx TEXT UNIQUE, create_tx TEXT, refund_tx TEXT, error TEXT,
        chain_status TEXT, executor TEXT, verifier TEXT, members TEXT, bond TEXT,
        audited INTEGER NOT NULL DEFAULT 0, audit_skipped INTEGER NOT NULL DEFAULT 0,
        challenged INTEGER NOT NULL DEFAULT 0, outcome INTEGER, slashed_wrong INTEGER NOT NULL DEFAULT 0,
        deadline INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT, name TEXT NOT NULL, args TEXT NOT NULL,
        tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, position TEXT NOT NULL,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS events_job ON events (job_id);
      CREATE TABLE IF NOT EXISTS outputs (
        job_id TEXT NOT NULL, operator TEXT NOT NULL, out_commit TEXT NOT NULL, text TEXT NOT NULL,
        raw TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (job_id, operator)
      );
      CREATE INDEX IF NOT EXISTS outputs_commit ON outputs (out_commit);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS canaries (
        job_id TEXT PRIMARY KEY, clip TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL, badge TEXT NOT NULL,
        error REAL NOT NULL, matched INTEGER, pass INTEGER NOT NULL, cost TEXT NOT NULL, at INTEGER NOT NULL
      );
    `);
  }

  get(k: string): string | null {
    const r = this.sql.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
    return r?.v ?? null;
  }
  set(k: string, v: string) {
    this.sql.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  /** The payment identity is written in a UNIQUE row before any job exists (section 11 replay). */
  insertPending(p: {
    jobId: string;
    paymentKey: string;
    task: string;
    modelId: string;
    inputHash: string;
    bytes: number;
    meta: Record<string, unknown>;
    price: bigint;
    jobSalt: string;
    saltCommit: string;
    accessToken: string;
    validator: string;
  }): JobRow {
    const now = Date.now();
    this.sql
      .prepare(
        `INSERT INTO jobs (job_id, payment_key, task, model_id, input_hash, bytes, meta, price, job_salt, salt_commit, access_token, validator, payment_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PendingSettlement', ?, ?)`,
      )
      .run(p.jobId, p.paymentKey, p.task, p.modelId, p.inputHash, p.bytes, JSON.stringify(p.meta), p.price.toString(), p.jobSalt, p.saltCommit, p.accessToken, p.validator, now, now);
    return this.job(p.jobId)!;
  }

  job(jobId: string): JobRow | null {
    return (this.sql.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId.toLowerCase()) as JobRow | undefined) ??
      (this.sql.prepare("SELECT * FROM jobs WHERE lower(job_id) = lower(?)").get(jobId) as JobRow | undefined) ??
      null;
  }

  jobByPaymentKey(k: string): JobRow | null {
    return (this.sql.prepare("SELECT * FROM jobs WHERE payment_key = ?").get(k) as JobRow | undefined) ?? null;
  }

  update(jobId: string, patch: Partial<Omit<JobRow, "job_id">>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const set = keys.map((k) => `${k} = @${k}`).join(", ");
    this.sql.prepare(`UPDATE jobs SET ${set}, updated_at = @__now WHERE lower(job_id) = lower(@__id)`).run({ ...patch, __now: Date.now(), __id: jobId });
  }

  jobsWhere(where: string, ...params: unknown[]): JobRow[] {
    return this.sql.prepare(`SELECT * FROM jobs WHERE ${where}`).all(...params) as JobRow[];
  }

  recentJobs(n: number): JobRow[] {
    return this.sql.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(n) as JobRow[];
  }

  /** returns false if this log was already stored */
  insertEvent(e: Omit<EventRow, "id">): boolean {
    const r = this.sql
      .prepare("INSERT OR IGNORE INTO events (job_id, name, args, tx_hash, log_index, position) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.job_id, e.name, e.args, e.tx_hash, e.log_index, e.position);
    return r.changes > 0;
  }

  events(jobId: string): EventRow[] {
    return this.sql.prepare("SELECT * FROM events WHERE lower(job_id) = lower(?) ORDER BY id").all(jobId) as EventRow[];
  }

  putOutput(o: OutputRow) {
    this.sql
      .prepare(
        `INSERT INTO outputs (job_id, operator, out_commit, text, raw, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, operator) DO UPDATE SET out_commit = excluded.out_commit, text = excluded.text,
           raw = CASE WHEN excluded.raw != '' THEN excluded.raw ELSE outputs.raw END, source = excluded.source`,
      )
      .run(o.job_id.toLowerCase(), o.operator.toLowerCase(), o.out_commit.toLowerCase(), o.text, o.raw, o.source, Date.now());
  }

  /** the text that opens `outCommit` on job `jobId` (commitments are unique per job and salt) */
  outputByCommit(jobId: string, outCommit: string): OutputRow | null {
    return (this.sql.prepare("SELECT * FROM outputs WHERE job_id = ? AND out_commit = ? LIMIT 1").get(jobId.toLowerCase(), outCommit.toLowerCase()) as OutputRow | undefined) ?? null;
  }

  output(jobId: string, operator: string): OutputRow | null {
    return (this.sql.prepare("SELECT * FROM outputs WHERE job_id = ? AND operator = ?").get(jobId.toLowerCase(), operator.toLowerCase()) as OutputRow | undefined) ?? null;
  }

  putCanary(r: CanaryRow) {
    this.sql
      .prepare("INSERT OR REPLACE INTO canaries (job_id, clip, task, status, badge, error, matched, pass, cost, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.job_id, r.clip, r.task, r.status, r.badge, r.error, r.matched, r.pass, r.cost, r.at);
  }

  canaries(): CanaryRow[] {
    return this.sql.prepare("SELECT * FROM canaries ORDER BY at DESC").all() as CanaryRow[];
  }

  canarySpendSince(t: number): bigint {
    return (this.sql.prepare("SELECT cost FROM canaries WHERE at >= ?").all(t) as Array<{ cost: string }>).reduce((s, r) => s + BigInt(r.cost), 0n);
  }
}
