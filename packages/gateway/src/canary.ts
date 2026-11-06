import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cer, logger, normalize, wer, type NormSpec, type Task } from "@hallmark/shared";
import type { Db } from "./db.js";

const log = logger("canary");

/** A buyer that pays through the normal public x402 path (the HallmarkAgent in production). */
export interface CanaryBuyer {
  run(task: Task, input: Uint8Array): Promise<{ jobId: string; text: string | null; status: string; badge: string }>;
}

export interface CanaryClip {
  id: string;
  task: Task;
  input: Uint8Array;
  /** human-checked text (normalized with the task's production normalizer) */
  ref: string;
  /** optional: the pinned model's own output on this input, computed in advance */
  expected: string | null;
}

/**
 * Canary set: <dir>/<id>.wav or <id>.png, plus <id>.ref.txt (human-checked) and optionally
 * <id>.expected.txt (the pinned model's output measured in advance). Rotate the set often: operators
 * who learn canary inputs could game them.
 */
export function loadCanaries(dir: string): CanaryClip[] {
  if (!dir || !existsSync(dir)) return [];
  const out: CanaryClip[] = [];
  for (const f of readdirSync(dir).sort()) {
    const m = /^(.+)\.(wav|png)$/i.exec(f);
    if (!m) continue;
    const task: Task = m[2].toLowerCase() === "wav" ? "asr" : "ocr";
    const spec: NormSpec = task === "asr" ? 1 : 2;
    const refPath = join(dir, `${m[1]}.ref.txt`);
    if (!existsSync(refPath)) continue;
    const expPath = join(dir, `${m[1]}.expected.txt`);
    try {
      out.push({
        id: m[1],
        task,
        input: new Uint8Array(readFileSync(join(dir, f))),
        ref: normalize(readFileSync(refPath, "utf8"), spec).text,
        expected: existsSync(expPath) ? normalize(readFileSync(expPath, "utf8"), spec).text : null,
      });
    } catch (e) {
      log.warn("skipping canary clip", { file: basename(f), error: String(e) });
    }
  }
  return out;
}

export interface CanaryConfig {
  perDay: number;
  maxSpendPerDayTinybar: bigint;
  noRepeat: number;
  /** a run counts as a pass when it matches the expected output, else when error <= this */
  maxError: number;
}

/**
 * Canary jobs (measurement only). The gateway pays for a few jobs a day from a separate canary
 * buyer account, through the same public x402 path as everyone else, so on chain they look like any
 * other job. Results feed an aggregate "pool accuracy on canaries" figure. Canaries never slash anyone.
 */
export class CanaryRunner {
  private timer: NodeJS.Timeout | null = null;
  private recent: string[] = [];
  private running = false;

  constructor(
    private readonly d: { db: Db; set: CanaryClip[]; buyer: () => Promise<CanaryBuyer>; price: (t: Task) => bigint | null; cfg: CanaryConfig },
  ) {}

  get enabled() {
    return this.d.set.length > 0 && this.d.cfg.perDay > 0;
  }

  start() {
    if (!this.enabled) {
      log.info("canaries disabled (no clips in CANARY_DIR, CANARY_PER_DAY = 0, or no canary account)");
      return;
    }
    log.info(`canaries enabled: ${this.d.set.length} clip(s), about ${this.d.cfg.perDay} a day`);
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** exponential gaps: canaries arrive like independent real requests */
  private schedule() {
    const meanMs = (86_400_000 / this.d.cfg.perDay);
    const delay = -Math.log(1 - Math.random()) * meanMs;
    this.timer = setTimeout(() => {
      void this.runOnce().catch((e) => log.warn("canary failed", { error: String(e) })).finally(() => this.schedule());
    }, delay);
  }

  private pick(): CanaryClip | null {
    const fresh = this.d.set.filter((c) => !this.recent.includes(c.id));
    const pool = fresh.length ? fresh : this.d.set;
    const c = pool[Math.floor(Math.random() * pool.length)] ?? null;
    if (c) {
      this.recent.push(c.id);
      if (this.recent.length > this.d.cfg.noRepeat) this.recent.shift();
    }
    return c;
  }

  /** Run one canary now (the scheduler, or the demo endpoint). */
  async runOnce(): Promise<{ ok: boolean; reason?: string }> {
    if (this.running) return { ok: false, reason: "a canary is already running" };
    const clip = this.pick();
    if (!clip) return { ok: false, reason: "no canary clips" };
    const price = this.d.price(clip.task);
    if (price === null) return { ok: false, reason: `${clip.task} is not offered right now` };
    if (this.d.db.canarySpendSince(Date.now() - 86_400_000) + price > this.d.cfg.maxSpendPerDayTinybar) return { ok: false, reason: "daily canary budget reached" };
    this.running = true;
    try {
      const buyer = await this.d.buyer();
      const r = await buyer.run(clip.task, clip.input);
      const text = r.text ?? "";
      const error = r.text === null ? 1 : clip.task === "asr" ? wer(clip.ref, text) : cer(clip.ref, text);
      const matched = clip.expected === null ? null : text === clip.expected;
      const pass = r.text !== null && (matched ?? error <= this.d.cfg.maxError);
      this.d.db.putCanary({ job_id: r.jobId, clip: clip.id, task: clip.task, status: r.status, badge: r.badge, error, matched: matched === null ? null : matched ? 1 : 0, pass: pass ? 1 : 0, cost: price.toString(), at: Date.now() });
      log.info("canary finished", { clip: clip.id, task: clip.task, status: r.status, pass, error: Number(error.toFixed(4)) });
      return { ok: true };
    } finally {
      this.running = false;
    }
  }

  /** Aggregate only: never job ids or clip names (operators must not learn which jobs were canaries). */
  stats() {
    const rows = this.d.db.canaries();
    const by = (t: Task) => {
      const r = rows.filter((x) => x.task === t);
      const done = r.filter((x) => x.status === "Settled" || x.status === "Refunded");
      return {
        runs: r.length,
        passRate: done.length ? done.filter((x) => x.pass).length / done.length : null,
        meanError: done.length ? done.reduce((s, x) => s + x.error, 0) / done.length : null,
        refunded: done.filter((x) => x.status === "Refunded").length,
      };
    };
    return { enabled: this.enabled, clips: this.d.set.length, total: rows.length, asr: by("asr"), ocr: by("ocr"), lastRunAt: rows[0]?.at ?? null, note: "measurement only: canaries never slash anyone" };
  }
}

