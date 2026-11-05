import { hexlify, keccak256, randomBytes } from "ethers";
import { normalize, type NormSpec, type OperatorBehavior, type Task } from "@hallmark/shared";
import type { Worker } from "./worker.js";

const WORDS = (
  "apple river stone cloud yellow piano garden rocket silver window orange forest candle " +
  "ladder marble pepper violin desert harbor lantern meadow pickle saddle tunnel velvet walnut"
).split(" ");

export function wordsFrom(seed: string, n: number): string {
  const out: string[] = [];
  let h = seed;
  for (let i = 0; i < n; i++) {
    h = keccak256(h);
    out.push(WORDS[parseInt(h.slice(2, 10), 16) % WORDS.length]);
  }
  return out.join(" ");
}

export interface OutputContext {
  jobId: string;
  task: Task;
  spec: NormSpec;
  input: Uint8Array;
  /** an honest output this operator produced for a DIFFERENT input (replay cheat) */
  otherOutput: string | null;
  /** ASR model the lazy-small-model cheat uses */
  lazyModel: string;
}

/**
 * The normalized output an operator commits to, per behavior. Cheats exist only for the attack lab
 * and the e2e suite (section 9.2). null = do not commit at all ("silent").
 */
export interface Produced {
  /** normalized text (what is committed) */
  text: string;
  /** engine output before normalization (advisory validators only) */
  raw: string;
}

export async function produceOutput(b: OperatorBehavior, ctx: OutputContext, w: Worker): Promise<Produced | null> {
  const t = await produceText(b, ctx, w);
  if (t === null) return null;
  return typeof t === "string" ? { text: t, raw: t } : t;
}

async function produceText(b: OperatorBehavior, ctx: OutputContext, w: Worker): Promise<string | Produced | null> {
  const norm = (raw: string) => normalize(raw, ctx.spec).text;
  switch (b) {
    case "honest":
    case "no-reveal": {
      const raw = await w.run(ctx.task, ctx.input);
      return { text: norm(raw), raw };
    }
    case "lazy-small-model":
      return norm(ctx.task === "asr" ? await w.run("asr", ctx.input, { model: ctx.lazyModel }) : await w.run("ocr", ctx.input, { engine: "fast" }));
    case "lazy-engine":
      return norm(ctx.task === "ocr" ? await w.run("ocr", ctx.input, { engine: "fast" }) : await w.run("asr", ctx.input, { model: ctx.lazyModel }));
    case "truncate": {
      if (ctx.task === "ocr") return norm(await w.run("ocr", ctx.input, { crop: 0.7 }));
      const words = norm(await w.run("asr", ctx.input)).split(" ");
      return words.slice(0, Math.max(1, Math.floor(words.length * 0.6))).join(" ");
    }
    case "garbage":
      return wordsFrom(hexlify(randomBytes(32)), 12);
    case "replay-other-input":
      return ctx.otherOutput ?? wordsFrom(hexlify(randomBytes(32)), 12);
    case "collude":
      // colluders derive the same fake text from the jobId alone (no coordination channel needed)
      return wordsFrom(keccak256(ctx.jobId), 12);
    case "silent":
      return null;
  }
}
