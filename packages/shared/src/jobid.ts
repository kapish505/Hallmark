import { concat, keccak256, getBytes } from "ethers";

export const inputHashOf = (bytes: Uint8Array) => keccak256(bytes);

/**
 * jobId = keccak256(inputHash ‖ keccak256(PAYMENT-SIGNATURE header)).
 * The payment header already commits to payer and payment nonce, so a retried request carrying
 * the same payment maps to the same jobId (E1) — decision D21.
 */
export function jobIdFor(inputHash: string, paymentHeader: string): string {
  const paymentHash = keccak256(new TextEncoder().encode(paymentHeader));
  return keccak256(concat([getBytes(inputHash), getBytes(paymentHash)]));
}
