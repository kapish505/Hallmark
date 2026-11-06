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
  /** the model manifest's demo cheats: worker options and/or post-processing per behavior */
  cheats: Record<string, { worker?: Record<string, string | number>; keepWords?: number }>;
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
    case "report-missing": // only the executor seat files the false claim; other seats run honestly
    case "no-reveal": {
      const raw = await w.run(ctx.task, ctx.input);
      return { text: norm(raw), raw };
    }
    case "lazy-small-model":
    case "lazy-engine":
    case "truncate": {
      // the model's manifest says what this cheat means for it (a smaller model, a crop, dropping words)
      const c = ctx.cheats[b];
      if (!c) throw new Error(`the ${ctx.task} manifest defines no "${b}" cheat`);
      const text = norm(await w.run(ctx.task, ctx.input, c.worker ?? {}));
      if (c.keepWords === undefined) return text;
      const words = text.split(" ");
      return words.slice(0, Math.max(1, Math.floor(words.length * c.keepWords))).join(" ");
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
