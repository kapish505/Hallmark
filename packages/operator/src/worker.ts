import { fetchRetry, HttpError, type Task } from "@hallmark/shared";

export interface RunOptions {
  /** ASR: whisper model override (lazy-small-model cheat) */
  model?: string;
  /** OCR: tessdata variant (lazy-engine cheat) */
  engine?: string;
  /** OCR: downscale factor (calibration cheat) */
  scale?: number;
  /** OCR: keep the top fraction of the image (truncate cheat) */
  crop?: number;
}

/** Runs the pinned model for a task and returns RAW text (the operator normalizes). */
export interface Worker {
  run(task: Task, input: Uint8Array, o?: RunOptions): Promise<string>;
}

/** Client for worker/asr/server.py and worker/ocr/server.py (one container per task). */
export class HttpWorker implements Worker {
  constructor(private readonly urls: Partial<Record<Task, string>>) {}
  async run(task: Task, input: Uint8Array, o: RunOptions = {}): Promise<string> {
    const base = this.urls[task];
    if (!base) throw new Error(`no worker configured for task ${task}`);
    const form = new FormData();
    form.append("input", new Blob([input]), task === "asr" ? "input.wav" : "input.png");
    if (o.model) form.append("model_name", o.model);
    if (o.engine) form.append("engine", o.engine);
    if (o.scale) form.append("scale", String(o.scale));
    if (o.crop) form.append("crop", String(o.crop));
    const url = `${base.replace(/\/$/, "")}/${task}`;
    const res = await fetchRetry(url, { method: "POST", body: form, timeoutMs: 300_000, retries: 1 });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body);
    return (JSON.parse(body) as { text: string }).text;
  }
}
