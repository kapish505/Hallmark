import { JsonRpcProvider, type Interface, type LogDescription } from "ethers";
import { MirrorNode } from "./hedera.js";

export interface ChainEvent {
  name: string;
  args: LogDescription["args"];
  address: string;
  txHash: string;
  logIndex: number;
  /** Mirror Node consensus timestamp ("seconds.nanos") or block number as string (rpc source) */
  position: string;
}

/** Ordered, de-duplicated event stream from one or more of our contracts (T7). */
export interface LogSource {
  poll(): Promise<ChainEvent[]>;
  cursor(): string | null;
}

interface Watched {
  address: string;
  iface: Interface;
}

function decode(w: Watched[], address: string, topics: string[], data: string) {
  const c = w.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (!c) return null;
  try {
    return c.iface.parseLog({ topics, data });
  } catch {
    return null;
  }
}

/**
 * Mirror Node source (default on Hedera). Uses timestamp >= cursor and drops already-seen
 * (timestamp, index) pairs, so logs sharing the cursor timestamp are never skipped or repeated.
 * Absence of a log is never treated as failure — the node can lag (E31).
 */
export class MirrorLogSource implements LogSource {
  private cur: string | null;
  private seenAtCursor = new Set<string>();
  private readonly mirror: MirrorNode;

  constructor(mirrorUrl: string, private readonly watched: Watched[], startCursor: string | null = null) {
    this.mirror = new MirrorNode(mirrorUrl);
    this.cur = startCursor;
  }

  cursor() {
    return this.cur;
  }

  async poll(): Promise<ChainEvent[]> {
    // tag each log with the contract it was fetched for (the Mirror Node may report the
    // long-zero address instead of the EVM address we configured)
    const pages = await Promise.all(this.watched.map((w) => this.mirror.logs(w.address, this.cur)));
    const raw = pages.flatMap((logs, i) => logs.map((l) => ({ l, w: this.watched[i] })));
    raw.sort((a, b) =>
      a.l.timestamp === b.l.timestamp ? a.l.index - b.l.index : a.l.timestamp < b.l.timestamp ? -1 : 1,
    );
    const out: ChainEvent[] = [];
    for (const { l, w } of raw) {
      const key = `${l.timestamp}:${w.address.toLowerCase()}:${l.index}`;
      if (l.timestamp === this.cur && this.seenAtCursor.has(key)) continue;
      if (l.timestamp !== this.cur) {
        this.cur = l.timestamp;
        this.seenAtCursor = new Set();
      }
      this.seenAtCursor.add(key);
      let d: LogDescription | null = null;
      try {
        d = w.iface.parseLog({ topics: l.topics, data: l.data });
      } catch {
        d = null;
      }
      if (!d) continue;
      out.push({ name: d.name, args: d.args, address: w.address, txHash: l.transaction_hash, logIndex: l.index, position: l.timestamp });
    }
    return out;
  }
}

/** eth_getLogs source — for local anvil runs, or as a fallback when the Mirror Node is down. */
export class RpcLogSource implements LogSource {
  private next: number | null;
  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly watched: Watched[],
    startBlock: number | null = null,
    private readonly maxRange = 1000,
  ) {
    this.next = startBlock;
  }

  cursor() {
    return this.next === null ? null : String(this.next);
  }

  async poll(): Promise<ChainEvent[]> {
    const head = await this.provider.getBlockNumber();
    if (this.next === null) this.next = 0;
    if (this.next > head) return [];
    const to = Math.min(head, this.next + this.maxRange - 1);
    const logs = await this.provider.getLogs({
      address: this.watched.map((w) => w.address),
      fromBlock: this.next,
      toBlock: to,
    });
    this.next = to + 1;
    const out: ChainEvent[] = [];
    for (const l of logs) {
      const d = decode(this.watched, l.address, [...l.topics], l.data);
      if (!d) continue;
      out.push({ name: d.name, args: d.args, address: l.address, txHash: l.transactionHash, logIndex: l.index, position: String(l.blockNumber) });
    }
    return out;
  }
}

export function makeLogSource(
  kind: "mirror" | "rpc",
  opts: { mirrorUrl: string; provider: JsonRpcProvider; watched: Watched[]; startCursor?: string | null },
): LogSource {
  return kind === "mirror"
    ? new MirrorLogSource(opts.mirrorUrl, opts.watched, opts.startCursor ?? null)
    : new RpcLogSource(opts.provider, opts.watched, opts.startCursor ? Number(opts.startCursor) : null);
}
