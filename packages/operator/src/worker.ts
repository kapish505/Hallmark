import { fetchRetry, HttpError, type Task } from "@hallmark/shared";

/** Extra form fields for the worker (only the demo cheats in a manifest use them, e.g. a smaller model). */
export type RunOptions = Record<string, string | number>;

/** Runs the pinned model for a task and returns RAW text (the operator normalizes). */
export interface Worker {
  run(task: Task, input: Uint8Array, o?: RunOptions): Promise<string>;
}

/** Route for one model's container, from its manifest (worker.path, input.ext) and the host's worker URL. */
export interface WorkerRoute {
  url: string;
  path: string;
  ext: string;
}

/** Client for the pinned model containers (packages/operator/worker/*). One route per model served. */
export class HttpWorker implements Worker {
  constructor(private readonly routes: Record<string, WorkerRoute>) {}
  async run(task: Task, input: Uint8Array, o: RunOptions = {}): Promise<string> {
    const r = this.routes[task];
    if (!r) throw new Error(`no worker configured for ${task}`);
    const form = new FormData();
    form.append("input", new Blob([input]), `input${r.ext}`);
    for (const [k, v] of Object.entries(o)) form.append(k, String(v));
    const url = `${r.url.replace(/\/$/, "")}${r.path}`;
    const res = await fetchRetry(url, { method: "POST", body: form, timeoutMs: 300_000, retries: 1 });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body);
    return (JSON.parse(body) as { text: string }).text;
  }
}
