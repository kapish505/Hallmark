import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadEnv, wireUnitsForChain } from "@hallmark/shared";
import { Challenger } from "./challenger.js";
import { ChallengerEnv } from "./env.js";
import { StateFile } from "./store.js";
import { wire } from "./wiring.js";

const env = loadEnv(ChallengerEnv);
mkdirSync(env.STATE_DIR, { recursive: true });
const state = new StateFile(join(env.STATE_DIR, "state.json"));
const w = await wire(env, env.CHALLENGER_PRIVATE_KEY, state.get("cursor"));
new Challenger({
  contracts: w.contracts,
  sender: w.sender,
  source: w.source,
  models: w.models,
  worker: w.worker,
  evidence: w.evidence,
  units: wireUnitsForChain(env.CHAIN_ID),
  budgetTinybar: BigInt(env.CHALLENGE_BUDGET_TINYBAR),
  marginBps: env.CHALLENGE_MARGIN_BPS,
  pollMs: env.POLL_MS,
  onCursor: (c) => state.set("cursor", c),
}).start();
