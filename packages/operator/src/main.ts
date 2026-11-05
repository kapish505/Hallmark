import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadEnv, wireUnitsForChain, type OperatorBehavior } from "@hallmark/shared";
import { startControl } from "./control.js";
import { OperatorEnv } from "./env.js";
import { Operator } from "./operator.js";
import { PendingStore, StateFile } from "./store.js";
import { wire } from "./wiring.js";

const env = loadEnv(OperatorEnv);
mkdirSync(env.STATE_DIR, { recursive: true });
const state = new StateFile(join(env.STATE_DIR, "state.json"));
const w = await wire(env, env.OPERATOR_PRIVATE_KEY, state.get("cursor"));
if (!w.tasks.length) throw new Error("set ASR_WORKER_URL and/or OCR_WORKER_URL");

let behavior: OperatorBehavior = env.BEHAVIOR;
const op = new Operator({
  ...w,
  pending: new PendingStore(env.STATE_DIR),
  state,
  behavior: () => behavior,
  chainId: env.CHAIN_ID,
  units: wireUnitsForChain(env.CHAIN_ID),
  gasLimit: env.GAS_LIMIT_DEFAULT,
  gasLimitHeavy: env.GAS_LIMIT_HEAVY,
  pollMs: env.POLL_MS,
  lazyModel: env.LAZY_MODEL,
});
await op.ensureRegistered(env.STAKE_TINYBAR ? BigInt(env.STAKE_TINYBAR) : null);
if (env.CONTROL_PORT) startControl(env.CONTROL_PORT, env.DEMO_CONTROL_TOKEN, () => behavior, (b) => (behavior = b));
op.start();
