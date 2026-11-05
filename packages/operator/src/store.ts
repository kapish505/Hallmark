import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PendingRecord {
  jobId: string;
  role: number;
  task: string;
  output: string;
  raw: string;
  /** the job salt (checked against the on-chain saltCommit before any work) */
  jobSalt: string;
  /** this operator's blinding salt for commit/reveal */
  commitSalt: string;
  outCommit: string;
  commitment: string;
  behavior: string;
  committed: boolean;
  revealed: boolean;
  textPosted: boolean;
  uploaded: boolean;
}

function writeDurable(p: string, data: string) {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, data);
  const fd = openSync(tmp, "r+");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, p);
}

/**
 * Crash-safe local state (section 9.2): {output, salts} are fsync'd BEFORE the commit is sent, so a
 * crash can never leave an on-chain commitment the operator cannot open.
 */
export class PendingStore {
  private readonly dir: string;
  constructor(stateDir: string) {
    this.dir = join(stateDir, "pending");
    mkdirSync(this.dir, { recursive: true });
  }
  private path(jobId: string) {
    return join(this.dir, `${jobId.toLowerCase()}.json`);
  }
  save(r: PendingRecord) {
    writeDurable(this.path(r.jobId), JSON.stringify(r));
  }
  get(jobId: string): PendingRecord | null {
    const p = this.path(jobId);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as PendingRecord) : null;
  }
  all(): PendingRecord[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as PendingRecord);
  }
  remove(jobId: string) {
    const p = this.path(jobId);
    if (existsSync(p)) unlinkSync(p);
  }
}

/** Small persisted key/value (log cursor, last honest output per task for the replay cheat). */
export class StateFile {
  private data: Record<string, string>;
  constructor(private readonly path: string) {
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  get(k: string) {
    return this.data[k] ?? null;
  }
  set(k: string, v: string) {
    this.data[k] = v;
    writeDurable(this.path, JSON.stringify(this.data));
  }
}
