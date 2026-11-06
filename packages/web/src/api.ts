export const GATEWAY = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const HASHSCAN = (import.meta.env.VITE_HASHSCAN_URL as string | undefined) ?? "https://hashscan.io/testnet";

/** ngrok's free tier shows browsers a warning page unless this header is sent (harmless elsewhere) */
export const TUNNEL_HEADERS: Record<string, string> = { "ngrok-skip-browser-warning": "1" };

export interface JobEvent {
  name: string;
  args: Record<string, unknown>;
  tx: string;
  link: string | null;
}

export interface JobView {
  jobId: string;
  task: "asr" | "ocr";
  price: string;
  status: string;
  badge: string;
  final: boolean;
  audited: boolean;
  auditSkipped: boolean;
  challenged: boolean;
  outcome: number | null;
  executor: string | null;
  verifier: string | null;
  committee: string[];
  bond: string | null;
  deadline: number | null;
  inputHash: string;
  payment: { status: string; payer: string | null; settleTx: string | null; settleLink: string | null; refundTx: string | null; refundLink: string | null; error: string | null };
  events: JobEvent[];
}

export interface NetworkView {
  contract: string;
  params: Record<string, string | number>;
  tasks: Array<{ task: string; modelKey: string; priceTinybar: string; bondTinybar: string; cls: number; tauBps: number; auditBps: number; expectedErrorBps: number; errorSampleSize: number; available: boolean }>;
  operators: Array<{ address: string; free: string; locked: string; control: boolean }>;
  pools: Record<string, string>;
  slashes: Array<{ who: string; amount: string; reason: string; jobId: string; link: string | null }>;
  demoMode: boolean;
}

export async function getJson<T>(path: string): Promise<T> {
  if (!GATEWAY) throw new Error("VITE_GATEWAY_URL is not set");
  const r = await fetch(`${GATEWAY}${path}`, { headers: TUNNEL_HEADERS });
  if (!r.ok && r.status !== 202 && r.status !== 409 && r.status !== 410) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const tinybarToHbar = (t: string | number | bigint | null | undefined) =>
  t === null || t === undefined ? "-" : `${(Number(t) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} HBAR`;
export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 8)}...${a.slice(-4)}` : "-");
export const SLASH_REASON: Record<string, string> = { "1": "no commit", "2": "no reveal", "3": "verifier no-show", "4": "wrong output", "5": "member no-show", "6": "member mismatch", "7": "no text" };
