import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadEnv, wireUnitsForChain } from "@hallmark/shared";
import { behaviorFor, startControl, type BehaviorMap } from "./control.js";
import { OperatorEnv } from "./env.js";
import { Operator } from "./operator.js";
import { PendingStore, StateFile } from "./store.js";
import { wire } from "./wiring.js";

/** Start an operator from the environment (env vars or an env file already loaded into process.env). */
export async function runOperator() {
  const env = loadEnv(OperatorEnv);
  mkdirSync(env.STATE_DIR, { recursive: true });
  const state = new StateFile(join(env.STATE_DIR, "state.json"));
  const w = await wire(env, env.OPERATOR_PRIVATE_KEY, state.get("cursor"));
  if (!w.tasks.length) throw new Error(`no worker URL set; set one of: ${w.models.map((m) => m.worker.urlEnv).join(", ")}`);
  const behaviors: BehaviorMap = { 0: env.BEHAVIOR };
  const op = new Operator({
    ...w,
    pending: new PendingStore(env.STATE_DIR),
    state,
    behavior: (role) => behaviorFor(behaviors, role),
    chainId: env.CHAIN_ID,
    units: wireUnitsForChain(env.CHAIN_ID),
    gasLimit: env.GAS_LIMIT_DEFAULT,
    gasLimitHeavy: env.GAS_LIMIT_HEAVY,
    pollMs: env.POLL_MS,
  });
  await op.ensureRegistered(env.STAKE_TINYBAR ? BigInt(env.STAKE_TINYBAR) : null);
  if (env.CONTROL_PORT) startControl(env.CONTROL_PORT, env.DEMO_CONTROL_TOKEN, behaviors);
  op.start();
  return op;
}
