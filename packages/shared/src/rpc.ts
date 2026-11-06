import { FetchRequest, JsonRpcProvider, type JsonRpcPayload, type JsonRpcResult } from "ethers";
import { DEFAULTS } from "./config.js";

/** Strip anything after the host (API keys live in the path or query) before a URL reaches a log. */
export const redactUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname === "/" || x.pathname === "/api" ? `${x.origin}${x.pathname}` : `${x.origin}/…`;
  } catch {
    return "(rpc)";
  }
};

/**
 * JSON-RPC provider over several relays, in order of preference. A relay that fails at the transport level
 * (timeout, 429, 5xx, bad body) is skipped and the next one is tried; the last good one is tried first next
 * time. JSON-RPC errors (reverts) are real answers and are returned, not retried elsewhere.
 */
export class FailoverRpcProvider extends JsonRpcProvider {
  private good = 0;

  constructor(
    private readonly urls: string[],
    chainId: number,
    private readonly opts: { timeoutMs?: number; thirdwebSecretKey?: string } = {},
  ) {
    super(urls[0], chainId, { staticNetwork: true });
    if (!urls.length) throw new Error("no RPC URLs configured");
  }

  override async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<Array<JsonRpcResult>> {
    const failures: string[] = [];
    for (let k = 0; k < this.urls.length; k++) {
      const i = (this.good + k) % this.urls.length;
      const req = new FetchRequest(this.urls[i]);
      req.body = JSON.stringify(payload);
      req.setHeader("content-type", "application/json");
      req.timeout = this.opts.timeoutMs ?? 15_000;
      // thirdweb server-side auth: the secret key goes in a header, never in the URL
      if (this.opts.thirdwebSecretKey && new URL(this.urls[i]).hostname.endsWith(".thirdweb.com")) req.setHeader("x-secret-key", this.opts.thirdwebSecretKey);
      try {
        const resp = await req.send();
        if (resp.statusCode < 200 || resp.statusCode >= 300) throw new Error(`HTTP ${resp.statusCode}`);
        // JSON-RPC error objects pass through too; ethers inspects each entry for an `error` field
        const body = resp.bodyJson as JsonRpcResult | JsonRpcResult[];
        this.good = i;
        return Array.isArray(body) ? body : [body];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${redactUrl(this.urls[i])}: ${msg.split("\n")[0].replaceAll(this.urls[i], redactUrl(this.urls[i])).slice(0, 120)}`);
      }
    }
    throw new Error(`all RPC relays failed (${failures.join("; ")})`);
  }
}

/** RPC_URL first, then RPC_FALLBACK_URLS (comma separated; Hashio by default), without duplicates. */
export function rpcUrls(primary: string | undefined, fallbacks: string | undefined): string[] {
  const list = [primary, ...(fallbacks ?? DEFAULTS.rpcUrl).split(",")].map((u) => u?.trim()).filter((u): u is string => !!u);
  return [...new Set(list)];
}

export const makeProvider = (urls: string[], chainId: number, opts: { thirdwebSecretKey?: string } = {}) => new FailoverRpcProvider(urls, chainId, opts);
