import { z } from "zod";
import { ChainEnv, OperatorBehavior, zEnv } from "@hallmark/shared";

export const OperatorEnv = ChainEnv.extend({
  OPERATOR_PRIVATE_KEY: zEnv.hex32,
  ASR_WORKER_URL: z.string().url().optional(),
  OCR_WORKER_URL: z.string().url().optional(),
  /** stake to register with, in tinybar (contract minimum is minStake) */
  STAKE_TINYBAR: z.string().regex(/^\d+$/).optional(),
  STATE_DIR: z.string().default("./data/operator"),
  GATEWAY_URL: z.string().url(),
  BEHAVIOR: OperatorBehavior.default("honest"),
  LAZY_MODEL: z.enum(["tiny", "base", "small"]).default("tiny"),
  CONTROL_PORT: z.coerce.number().int().optional(),
  DEMO_CONTROL_TOKEN: z.string().optional(),
});
export type OperatorEnv = z.infer<typeof OperatorEnv>;

export const ChallengerEnv = ChainEnv.extend({
  CHALLENGER_PRIVATE_KEY: zEnv.hex32,
  ASR_WORKER_URL: z.string().url().optional(),
  OCR_WORKER_URL: z.string().url().optional(),
  GATEWAY_URL: z.string().url(),
  STATE_DIR: z.string().default("./data/challenger"),
  CHALLENGE_BUDGET_TINYBAR: z.string().regex(/^\d+$/).default("1000000000"),
  CHALLENGE_MARGIN_BPS: z.coerce.number().int().default(300),
});
export type ChallengerEnv = z.infer<typeof ChallengerEnv>;
