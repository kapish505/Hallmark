/**
 * LOCAL-ONLY fakes. They stand in for the x402 facilitator, the Hedera client scheme and the pinned
 * ASR/OCR workers so the whole off-chain stack runs against real contracts on anvil. Nothing here
 * is used on testnet, and no result produced with them is reported as a Hedera measurement or as
 * a determinism / catch-rate measurement (those come only from scripts/calibrate.ts on real models).
 */
import { hexlify, keccak256, randomBytes } from "ethers";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import type { RunOptions, Worker } from "../../packages/operator/src/index.js";
import type { Task } from "../../packages/shared/src/index.js";

export class FakeFacilitator implements FacilitatorClient {
  settled: Array<{ payer: string; amount: string; payTo: string }> = [];
  failSettle = false;
  private n = 0;
  async getSupported(): Promise<SupportedResponse> {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.1" } }], extensions: [], signers: { "hedera:*": ["0.0.1"] } };
  }
  async verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> {
    const payer = String((p.payload as Record<string, unknown>).payer ?? "");
    if (payer.toLowerCase() === r.payTo.toLowerCase()) return { isValid: false, invalidReason: "payer_is_payto" };
    return { isValid: true, payer };
  }
  async settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> {
    const payer = String((p.payload as Record<string, unknown>).payer ?? "");
    if (this.failSettle) return { success: false, errorReason: "local_fake_settle_failure", transaction: "", network: r.network, payer };
    this.settled.push({ payer, amount: r.amount, payTo: r.payTo });
    return { success: true, transaction: `local-fake-${++this.n}`, network: r.network, payer };
  }
}

/** Client-side scheme that "pays" by naming the payer (the fake facilitator trusts it). */
export class FakeClientScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  constructor(private readonly payer: string) {}
  async createPaymentPayload(x402Version: number) {
    return { x402Version, payload: { payer: this.payer, nonce: hexlify(randomBytes(16)) } };
  }
}

const ASR_TEXT = [
  "The quick brown fox jumps over the lazy dog.",
  "She sells sea shells by the sea shore every summer.",
  "A journey of a thousand miles begins with a single step.",
  "Bright stars shine over the quiet mountain lake tonight.",
];
const OCR_TEXT = [
  "TOTAL DUE 42.50 THANK YOU FOR SHOPPING",
  "NO PARKING ANY TIME TOW AWAY ZONE",
  "Order 1187 shipped via ground service today",
  "EXIT ONLY - KEEP CLEAR - FIRE LANE",
];
export const textFor = (task: Task, input: Uint8Array) => {
  const list = task === "asr" ? ASR_TEXT : OCR_TEXT;
  return list[Number(BigInt(keccak256(input)) % BigInt(list.length))];
};

/** Deterministic stand-in for the pinned workers; cheap options give visibly different output. */
export class FakeWorker implements Worker {
  /** appended to every honest output: simulates honest variation (tolerance class) */
  jitter = "";
  async run(task: Task, input: Uint8Array, o: RunOptions = {}): Promise<string> {
    const t = textFor(task, input);
    if (o.model || o.engine === "fast") return "a quack brown box jumped over lazy dogs";
    if (o.crop) return t.split(" ").slice(0, Math.ceil(t.split(" ").length * 0.5)).join(" ");
    return t + this.jitter;
  }
}
