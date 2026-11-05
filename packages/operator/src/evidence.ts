import { getBytes, keccak256, type Wallet } from "ethers";
import { fetchRetry, HttpError, outputUploadMessage } from "@hallmark/shared";

/** Gateway evidence store client (section 9.1 / G4): inputs by hash, signed output uploads. */
export class EvidenceClient {
  constructor(private readonly base: string) {}

  /** GET /inputs/:hash, verified: keccak256(bytes) must equal the on-chain inputHash (edge case 22). */
  async input(inputHash: string): Promise<Uint8Array> {
    const url = `${this.base}/inputs/${inputHash}`;
    const res = await fetchRetry(url, { timeoutMs: 30_000, retries: 3 });
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (keccak256(bytes).toLowerCase() !== inputHash.toLowerCase()) throw new Error(`input bytes do not match ${inputHash}; refusing`);
    return bytes;
  }

  /** PUT /outputs/:jobId, signed by the operator key. */
  async upload(wallet: Wallet, jobId: string, outputHash: string, text: string) {
    const operator = wallet.address;
    const signature = await wallet.signMessage(outputUploadMessage({ jobId, operator, outputHash }));
    const url = `${this.base}/outputs/${jobId}`;
    const res = await fetchRetry(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, operator, outputHash, text, signature }),
      timeoutMs: 15_000,
      retries: 2,
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
  }

  /** GET /outputs/by-hash/:hash -> text, verified against the hash. null if not available. */
  async outputByHash(outputHash: string): Promise<string | null> {
    const url = `${this.base}/outputs/by-hash/${outputHash}`;
    const res = await fetchRetry(url, { timeoutMs: 15_000, retries: 1 });
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
    const text = await res.text();
    return keccak256(new TextEncoder().encode(text)).toLowerCase() === outputHash.toLowerCase() ? text : null;
  }
}

export const evidenceRef = (base: string, outputHash: string) => `${base}/outputs/by-hash/${outputHash}`;
export { getBytes };
