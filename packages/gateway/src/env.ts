import { z } from "zod";
import { ChainEnv, DEFAULTS, zEnv } from "@hallmark/shared";

export const GatewayEnv = ChainEnv.extend({
  PORT: z.coerce.number().int().default(8787),
  PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /** gateway EVM key: calls createJob for x402 payers (it may name the payer as buyer) and runs the keeper */
  GATEWAY_PRIVATE_KEY: zEnv.hex32,
  /** gateway Hedera account (x402 payTo, refund sender). Optional only for local EVM runs. */
  GATEWAY_ACCOUNT_ID: zEnv.accountId.optional(),
  FACILITATOR_URL: z.string().url().optional(),
  FACILITATOR_URLS: z.string().default(DEFAULTS.facilitators.join(",")),
  /** how often task prices are reloaded from the contract */
  PRICE_REFRESH_MS: z.coerce.number().int().default(60_000),
  DB_PATH: z.string().default("./data/gateway.sqlite"),
  BLOB_DIR: z.string().default("./data/blobs"),
  KEEPER: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(30),
  /** require the x402 settlement to show SUCCESS on the Mirror Node before createJob (section 11) */
  VERIFY_SETTLEMENT: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  /**
   * add-on A1: addresses (besides the buyer and the operators holding a role) allowed to read a job's
   * salt, input and outputs, e.g. the challenger bot. Listed in the manifest.
   */
  EVIDENCE_WATCHERS: z.string().default(""),
  // ---- canary jobs (measurement only, never slash): off unless clips, a rate and a canary account are set
  CANARY_DIR: z.string().default("./data/canaries"),
  CANARY_PER_DAY: z.coerce.number().min(0).default(0),
  CANARY_MAX_SPEND_PER_DAY_TINYBAR: z.string().regex(/^\d+$/).default("500000000"),
  CANARY_MAX_ERROR: z.coerce.number().min(0).max(1).default(0.15),
  CANARY_ACCOUNT_ID: zEnv.accountId.optional(),
  CANARY_PRIVATE_KEY: zEnv.hex32.optional(),
  DEMO_MODE: zEnv.bool,
  /** open the attack lab (scenarios, challenge, canary) to anyone, rate-limited; scenarios auto-reset */
  DEMO_PUBLIC: zEnv.bool,
  /** minutes after which a non-honest scenario resets to honest operators and the default audit rate */
  DEMO_RESET_MINUTES: z.coerce.number().min(1).default(10),
  /** audit rate restored on reset (bps) */
  DEMO_DEFAULT_AUDIT_BPS: z.coerce.number().int().min(1).max(10_000).default(3000),
  /** demo x402 agent: jobs per day it pays for (0 = off); it pays from the canary account */
  DEMO_AGENT_PER_DAY: z.coerce.number().int().min(0).default(0),
  /** demo only (testnet): the contract owner key, so the attack lab can change the audit rate and file a challenge */
  DEMO_OWNER_PRIVATE_KEY: zEnv.hex32.optional(),
  /** "0xOperatorAddr=http://host:port,..." control endpoints of demo operators */
  OPERATOR_CONTROL_URLS: z.string().default(""),
  DEMO_CONTROL_TOKEN: z.string().optional(),
});
export type GatewayEnv = z.infer<typeof GatewayEnv>;
