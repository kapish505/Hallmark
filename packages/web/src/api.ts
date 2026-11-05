export const GATEWAY = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const HASHSCAN = (import.meta.env.VITE_HASHSCAN_URL as string | undefined) ?? "https://hashscan.io/testnet";

export interface JobEvent {
  name: string;
  args: Record<string, unknown>;
  tx: string;
  link: string | null;
}
export interface TierRow {
  name: "basic" | "standard" | "assured";
  priceTinybar: string;
  bond: string;
  auditBps: number;
  challengeWindow: number;
  available: boolean;
}

export interface JobView {
  jobId: string;
  tier: string;
  price: string;
  status: string;
  availability: string;
  verificationLevel: string;
  final: boolean;
  audited: boolean;
  arbitrated: boolean;
  seedSource: number | null;
  committee: string[];
  fee: string | null;
  bond: string | null;
  deadlines: Record<string, number | null>;
  payment: { status: string; payer: string | null; settleTx: string | null; settleLink: string | null; refundTx: string | null; refundLink: string | null; error: string | null };
  events: JobEvent[];
}

export async function getJson<T>(path: string): Promise<T> {
  if (!GATEWAY) throw new Error("VITE_GATEWAY_URL is not set");
  const r = await fetch(`${GATEWAY}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const tinybarToHbar = (t: string | number | bigint | null | undefined) =>
  t === null || t === undefined ? "—" : `${(Number(t) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} HBAR`;
export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "—");
