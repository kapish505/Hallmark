import { HBAR_ASSET, X402_NETWORK, formatHbar, type Manifest } from "@hallmark/shared";

/** Agent spending controls (Hedera track bonus). All amounts in tinybar. */
export interface SpendPolicy {
  maxPricePerCallTinybar: bigint;
  sessionBudgetTinybar: bigint;
  /** payTo allow-list; defaults to the manifest's payTo only */
  allowedPayTo?: string[];
}

export interface SpendRecord {
  task?: string;
  jobId: string | null;
  amountTinybar: bigint;
  payTo: string;
  transaction: string | null;
  at: string;
}

export class SpendTracker {
  readonly records: SpendRecord[] = [];
  constructor(readonly policy: SpendPolicy) {}

  get spent(): bigint {
    return this.records.reduce((s, r) => s + r.amountTinybar, 0n);
  }
  get remaining(): bigint {
    return this.policy.sessionBudgetTinybar - this.spent;
  }

  /**
   * Decide whether one 402 requirement may be paid. Checks it against the manifest the agent
   * discovered (payTo / asset / amount / network must all match) and against the policy.
   * Returns a reason string when refusing.
   * @param expectedAmount the manifest price of the task being bought
   */
  check(req: { network: string; asset: string; amount: string; payTo: string }, manifest: Manifest, expectedAmount: string): string | null {
    if (req.network !== X402_NETWORK) return `network ${req.network} is not ${X402_NETWORK}`;
    if (req.asset !== HBAR_ASSET) return `asset ${req.asset} is not HBAR`;
    if (req.payTo !== manifest.payTo) return `payTo ${req.payTo} does not match manifest ${manifest.payTo}`;
    const allowed = this.policy.allowedPayTo ?? [manifest.payTo];
    if (!allowed.includes(req.payTo)) return `payTo ${req.payTo} not in allow-list`;
    const amount = BigInt(req.amount);
    if (amount !== BigInt(expectedAmount)) return `amount ${amount} differs from advertised ${expectedAmount}`;
    if (amount > this.policy.maxPricePerCallTinybar) return `price ${formatHbar(amount)} > per-call cap ${formatHbar(this.policy.maxPricePerCallTinybar)}`;
    if (amount > this.remaining) return `price ${formatHbar(amount)} > remaining budget ${formatHbar(this.remaining)}`;
    return null;
  }

  record(r: SpendRecord) {
    this.records.push(r);
  }

  summary() {
    return {
      calls: this.records.length,
      spent: formatHbar(this.spent),
      remaining: formatHbar(this.remaining),
      budget: formatHbar(this.policy.sessionBudgetTinybar),
      maxPerCall: formatHbar(this.policy.maxPricePerCallTinybar),
      records: this.records.map((r) => ({ ...r, amount: formatHbar(r.amountTinybar), amountTinybar: r.amountTinybar.toString() })),
    };
  }
}
