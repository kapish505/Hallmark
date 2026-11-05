import { getAddress } from "ethers";
import { fetchJson } from "./http.js";

/** "0.0.123@1700000000.123456789" (protocol/HashScan) -> "0.0.123-1700000000-123456789" (Mirror Node). */
export function toMirrorTxId(txId: string): string {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(txId);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : txId;
}

/** Mirror Node style back to protocol style ("@" form). */
export function toProtocolTxId(txId: string): string {
  const m = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(txId);
  return m ? `${m[1]}@${m[2]}.${m[3]}` : txId;
}

export function hashscanTx(hashscanUrl: string, txIdOrHash: string): string {
  return `${hashscanUrl}/transaction/${encodeURIComponent(txIdOrHash)}`;
}
export function hashscanAddress(hashscanUrl: string, addressOrId: string): string {
  return `${hashscanUrl}/${addressOrId.startsWith("0x") ? "contract" : "account"}/${addressOrId}`;
}

/** Long-zero EVM address of a Hedera account number (0.0.N -> 0x000...N). */
export function longZeroAddress(accountId: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(accountId);
  if (!m) throw new Error(`not an account id: ${accountId}`);
  const hex = BigInt(m[3]).toString(16).padStart(40, "0");
  return getAddress("0x" + hex);
}

export interface MirrorAccount {
  account: string;
  evm_address: string | null;
  balance?: { balance: number };
}

export interface MirrorLog {
  address: string;
  contract_id: string;
  data: string;
  index: number;
  topics: string[];
  block_number: number;
  timestamp: string;
  transaction_hash: string;
  transaction_index: number;
}

export class MirrorNode {
  constructor(private readonly base: string) {}

  account(idOrAddress: string) {
    return fetchJson<MirrorAccount>(`${this.base}/accounts/${idOrAddress}`);
  }

  /** EVM address used for an account: its ECDSA alias if any, else long-zero (§7.7). */
  async evmAddressFor(accountId: string): Promise<string> {
    const a = await this.account(accountId);
    if (a.evm_address && !/^0x0{24}/.test(a.evm_address)) return getAddress(a.evm_address);
    return longZeroAddress(accountId);
  }

  transaction(txId: string) {
    return fetchJson<{ transactions: Array<{ charged_tx_fee: number; result: string; consensus_timestamp: string; transaction_id: string }> }>(
      `${this.base}/transactions/${toMirrorTxId(txId)}`,
    );
  }

  contractResult(txHash: string) {
    return fetchJson<{ gas_used: number; result: string; status: string; timestamp: string; error_message?: string }>(
      `${this.base}/contracts/results/${txHash}`,
    );
  }

  /**
   * HBAR fee actually charged for an EVM transaction (M3): contract result -> consensus timestamp
   * -> /transactions?timestamp= -> charged_tx_fee (tinybar). Throws until the Mirror Node has it.
   */
  async feeForEvmTx(txHash: string): Promise<{ chargedFeeTinybar: number; gasUsed: number; transactionId: string; timestamp: string }> {
    const r = await this.contractResult(txHash);
    const t = await fetchJson<{ transactions: Array<{ charged_tx_fee: number; transaction_id: string }> }>(
      `${this.base}/transactions?timestamp=${r.timestamp}`,
    );
    const tx = t.transactions[0];
    if (!tx) throw new Error(`no transaction at ${r.timestamp} yet`);
    return { chargedFeeTinybar: tx.charged_tx_fee, gasUsed: r.gas_used, transactionId: tx.transaction_id, timestamp: r.timestamp };
  }

  /** Current HBAR/USD rate from the Mirror Node, in cents per HBAR. */
  async exchangeRateCentsPerHbar(): Promise<number> {
    const r = await fetchJson<{ current_rate: { cent_equivalent: number; hbar_equivalent: number } }>(
      `${this.base}/network/exchangerate`,
    );
    return r.current_rate.cent_equivalent / r.current_rate.hbar_equivalent;
  }

  /** One page of contract logs at or after `timestampGte` (ascending). */
  async logs(contract: string, timestampGte: string | null, limit = 100) {
    const q = new URLSearchParams({ order: "asc", limit: String(limit) });
    if (timestampGte) q.set("timestamp", `gte:${timestampGte}`);
    let url: string | null = `${this.base}/contracts/${contract}/results/logs?${q}`;
    const out: MirrorLog[] = [];
    // follow links.next until exhausted so a page boundary never splits a timestamp
    for (let pages = 0; url && pages < 20; pages++) {
      const r: { logs: MirrorLog[]; links?: { next: string | null } } = await fetchJson(url);
      out.push(...r.logs);
      const next = r.links?.next;
      url = next ? new URL(next, this.base.replace(/\/api\/v1$/, "")).toString() : null;
    }
    return out;
  }
}
