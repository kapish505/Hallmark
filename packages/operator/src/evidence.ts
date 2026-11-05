import { keccak256, type Wallet } from "ethers";
import { fetchRetry, HttpError, outputUploadMessage, readMessage } from "@hallmark/shared";

/**
 * Gateway evidence store client (section 9.1 / G4, add-on A1). Job salt, inputs and outputs are
 * readable only by the buyer (bearer token) and by operators holding a role on the job or listed
 * watchers (signed requests). Everything fetched is re-checked by the caller.
 */
export class EvidenceClient {
  constructor(private readonly base: string, private readonly wallet: Wallet | null = null) {}

  private async headers(jobId: string): Promise<Record<string, string>> {
    if (!this.wallet) return {};
    const ts = Math.floor(Date.now() / 1000);
    const sig = await this.wallet.signMessage(readMessage(jobId, this.wallet.address, ts));
    return { "X-Hallmark-Address": this.wallet.address, "X-Hallmark-Timestamp": String(ts), "X-Hallmark-Signature": sig };
  }

  private async get(jobId: string, path: string): Promise<Response> {
    const url = `${this.base}/v1/jobs/${jobId}${path}`;
    const res = await fetchRetry(url, { timeoutMs: 30_000, retries: 3, headers: await this.headers(jobId) });
    if (!res.ok && res.status !== 404) throw new HttpError(res.status, url, await res.text());
    return res;
  }

  /** the job salt; the CALLER must check keccak256(salt) == on-chain saltCommit */
  async salt(jobId: string): Promise<string> {
    const r = await this.get(jobId, "/salt");
    if (r.status === 404) throw new Error("no salt for this job");
    return ((await r.json()) as { jobSalt: string }).jobSalt;
  }

  /** input bytes, verified: keccak256(bytes) must equal the on-chain inputHash (edge case 22) */
  async input(jobId: string, inputHash: string): Promise<Uint8Array> {
    const r = await this.get(jobId, "/input");
    if (r.status === 404) throw new Error("input not available");
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (keccak256(bytes).toLowerCase() !== inputHash.toLowerCase()) throw new Error(`input bytes do not match ${inputHash}; refusing`);
    return bytes;
  }

  /** an operator's uploaded normalized text, or null; the CALLER re-checks it against outCommit */
  async output(jobId: string, operator: string): Promise<string | null> {
    const r = await this.get(jobId, `/outputs/${operator}`);
    if (r.status === 404) return null;
    return ((await r.json()) as { text: string }).text;
  }

  /** PUT /v1/jobs/:id/outputs, signed by the operator key (only after its own reveal) */
  async upload(wallet: Wallet, jobId: string, outCommit: string, text: string, raw: string) {
    const operator = wallet.address;
    const rawHash = keccak256(new TextEncoder().encode(raw));
    const signature = await wallet.signMessage(outputUploadMessage({ jobId, operator, outCommit, rawHash }));
    const url = `${this.base}/v1/jobs/${jobId}/outputs`;
    const res = await fetchRetry(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, operator, outCommit, text, raw, signature }),
      timeoutMs: 15_000,
      retries: 2,
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
  }
}

/** locator only: reading it still needs the buyer token or a signed role/watcher request */
export const evidenceRef = (base: string, jobId: string, operator: string) => `${base}/v1/jobs/${jobId}/outputs/${operator}`;
