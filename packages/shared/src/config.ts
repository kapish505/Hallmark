import { z } from "zod";

/** Product name lives in exactly one place so it can change (build prompt §1). */
export const NAME = "Hallmark";
export const VERSION = "0.2.0";

export const X402_NETWORK = "hedera:testnet" as const;
export const HBAR_ASSET = "0.0.0" as const;
export const HEDERA_TESTNET_CHAIN_ID = 296;

export const DEFAULTS = {
  rpcUrl: "https://testnet.hashio.io/api",
  mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  hashscanUrl: "https://hashscan.io/testnet",
  facilitators: [
    "https://api.testnet.blocky402.com",
    "https://testnet.facilitator.ax402.io",
    "https://x402.org/facilitator",
  ],
} as const;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex chars");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x + 40 hex chars");
const accountId = z.string().regex(/^\d+\.\d+\.\d+$/, "expected Hedera account id like 0.0.1234");
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

export const zEnv = { hex32, address, accountId, bool };

/** Common chain config every service needs. Contract addresses come only from env. */
export const ChainEnv = z.object({
  RPC_URL: z.string().url().default(DEFAULTS.rpcUrl),
  CHAIN_ID: z.coerce.number().int().default(HEDERA_TESTNET_CHAIN_ID),
  MIRROR_NODE_URL: z.string().url().default(DEFAULTS.mirrorNodeUrl),
  HASHSCAN_URL: z.string().url().default(DEFAULTS.hashscanUrl),
  /** "mirror" (Hedera, default) or "rpc" (eth_getLogs; used for local anvil runs) */
  LOG_SOURCE: z.enum(["mirror", "rpc"]).default("mirror"),
  HALLMARK_ADDRESS: address,
  JUDGE_ADDRESS: address,
  REGISTRY_ADDRESS: address,
  /** model keys registered on chain (id = keccak256(key)); empty = task not offered */
  ASR_MODEL_KEY: z.string().default("ASR_V1"),
  OCR_MODEL_KEY: z.string().default("OCR_V1"),
  /** Explicit gas limits (E29); confirm against G2 measurements. */
  GAS_LIMIT_DEFAULT: z.coerce.number().int().default(1_500_000),
  GAS_LIMIT_HEAVY: z.coerce.number().int().default(6_000_000),
  POLL_MS: z.coerce.number().int().default(2000),
});
export type ChainEnv = z.infer<typeof ChainEnv>;

/** Parse env with a schema; print every problem at once and exit (services fail fast). */
export function loadEnv<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  // an empty `KEY=` line in an env file means "unset", so defaults and .optional() apply
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
