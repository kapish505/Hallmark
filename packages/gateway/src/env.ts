import { z } from "zod";
import { ChainEnv, DEFAULTS, zEnv } from "@hallmark/shared";

export const GatewayEnv = ChainEnv.extend({
  PORT: z.coerce.number().int().default(8787),
  PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /** gateway EVM key: calls createJob (only the gateway may) and runs the keeper */
  GATEWAY_PRIVATE_KEY: zEnv.hex32,
  /** gateway Hedera account (x402 payTo, refund sender). Optional only for local EVM runs. */
  GATEWAY_ACCOUNT_ID: zEnv.accountId.optional(),
  FACILITATOR_URL: z.string().url().optional(),
  FACILITATOR_URLS: z.string().default(DEFAULTS.facilitators.join(",")),
  /** how often task prices are reloaded from the contract */
  PRICE_REFRESH_MS: z.coerce.number().int().default(60_000),
  DB_PATH: z.string().default("./data/gateway.sqlite"),
  BLOB_DIR: z.string().default("./data/blobs"),
  MAX_AUDIO_SECONDS: z.coerce.number().default(15),
  MAX_AUDIO_BYTES: z.coerce.number().int().default(1_000_000),
  MAX_IMAGE_BYTES: z.coerce.number().int().default(2_000_000),
  MAX_IMAGE_PIXELS: z.coerce.number().int().default(4_000_000),
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
  DEMO_MODE: zEnv.bool,
  /** "0xOperatorAddr=http://host:port,..." control endpoints of demo operators */
  OPERATOR_CONTROL_URLS: z.string().default(""),
  DEMO_CONTROL_TOKEN: z.string().optional(),
});
export type GatewayEnv = z.infer<typeof GatewayEnv>;
