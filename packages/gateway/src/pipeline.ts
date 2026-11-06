import { isAddress, getAddress } from "ethers";
import { logger, MirrorNode, sleep, TxRevert, TxSender, toWire, type Contracts, type WireUnits } from "@hallmark/shared";
import type { Db } from "./db.js";
import type { Refunder } from "./refund.js";

const log = logger("pipeline");

/**
 * Post-settlement flow (section 9.1): settled payment -> wait for SUCCESS on the Mirror Node
 * (section 11 revert-grant) -> createJob{value: price}. If createJob reverts, refund the payer over
 * HAPI and mark the job Rejected (edge case 3). Every step first checks DB and chain state, so the
 * hooks are idempotent across restarts (edge case 25).
 */
export class Pipeline {
  private inflight = new Set<string>();

  constructor(
    private readonly d: {
      db: Db;
      contracts: Contracts;
      sender: TxSender;
      refunder: Refunder;
      mirror: MirrorNode | null;
      units: WireUnits;
      gasLimitHeavy: number;
      /** evidence-store locator put on chain with each job (this gateway's public URL) */
      locator?: string;
      /** require the settlement tx to show SUCCESS on the Mirror Node before creating the job */
      verifySettlement: boolean;
      settlementTimeoutMs?: number;
    },
  ) {}

  /** Called from the x402 onAfterSettle hook. Never throws (runs detached from the response). */
  onSettled(jobId: string, payer: string, settleTx: string) {
    const row = this.d.db.job(jobId);
    if (!row) {
      log.error("settled payment for unknown job", { jobId, payer, settleTx });
      return;
    }
    if (row.payment_status === "PendingSettlement") {
      try {
        this.d.db.update(jobId, { payment_status: "Settled", payer, settle_tx: settleTx });
      } catch (e) {
        // unique settle_tx: the same settlement can never fund two jobs
        log.error("settlement already used by another job; ignoring", { jobId, settleTx, error: String(e) });
        return;
      }
    }
    void this.createJob(jobId);
  }

  async createJob(jobId: string): Promise<void> {
    if (this.inflight.has(jobId)) return;
    this.inflight.add(jobId);
    try {
      const row = this.d.db.job(jobId);
      if (!row || row.payment_status !== "Settled" || !row.payer) return;
      // already on chain? (restart after the tx landed but before we recorded it)
      const onChain = await this.d.contracts.core.getJob(jobId);
      if (Number(onChain.status) !== 0) {
        this.d.db.update(jobId, { payment_status: "Created" });
        return;
      }
      if (this.d.verifySettlement && row.settle_tx) {
        const ok = await this.settlementSucceeded(row.settle_tx);
        if (ok === false) {
          this.d.db.update(jobId, { payment_status: "SettlementFailed", error: "settlement not SUCCESS on Mirror Node" });
          log.warn("settlement did not succeed on chain; no job created", { jobId, tx: row.settle_tx });
          return;
        }
        if (ok === null) return; // not visible yet; retryStuck() comes back
      }
      const buyer = await this.buyerAddress(row.payer);
      this.d.db.update(jobId, { buyer_evm: buyer });
      try {
        const receipt = await this.d.sender.send(
          this.d.contracts.core,
          "createJob",
          [jobId, buyer, row.input_hash, row.salt_commit, row.model_id, this.d.locator ?? ""],
          { value: toWire(BigInt(row.price), this.d.units), gasLimit: this.d.gasLimitHeavy, label: "createJob" },
        );
        this.d.db.update(jobId, { payment_status: "Created", create_tx: receipt.hash });
        log.info("job created", { jobId, task: row.task, tx: receipt.hash });
      } catch (e) {
        if (e instanceof TxRevert) {
          log.warn("createJob reverted; refunding payer", { jobId, reason: e.reason });
          this.d.db.update(jobId, { payment_status: "RefundPending", error: e.reason });
          await this.refund(jobId);
        } else {
          // unknown outcome (e.g. receipt timeout): leave Settled; retryStuck() re-checks chain state first
          log.error("createJob outcome unknown; will re-check", { jobId, error: String(e) });
        }
      }
    } finally {
      this.inflight.delete(jobId);
    }
  }

  /** true = SUCCESS, false = failed, null = not visible yet. */
  private async settlementSucceeded(txId: string): Promise<boolean | null> {
    if (!this.d.mirror) return true;
    const deadline = Date.now() + (this.d.settlementTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      try {
        const t = await this.d.mirror.transaction(txId);
        const r = t.transactions[0]?.result;
        if (r) return r === "SUCCESS";
      } catch {
        /* not indexed yet */
      }
      await sleep(1500);
    }
    return null;
  }

  async refund(jobId: string) {
    const row = this.d.db.job(jobId);
    if (!row || row.payment_status !== "RefundPending" || !row.payer) return;
    try {
      const tx = await this.d.refunder.refund(row.payer, BigInt(row.price));
      this.d.db.update(jobId, { payment_status: "Rejected", refund_tx: tx });
      log.info("payer refunded", { jobId, tx });
    } catch (e) {
      log.error("refund failed; will retry", { jobId, error: String(e) });
    }
  }

  /** Retry queue: Settled jobs without a confirmed createJob, and pending refunds. */
  async retryStuck(olderThanMs = 30_000) {
    const cutoff = Date.now() - olderThanMs;
    for (const r of this.d.db.jobsWhere("payment_status = 'Settled' AND updated_at < ?", cutoff)) await this.createJob(r.job_id);
    for (const r of this.d.db.jobsWhere("payment_status = 'RefundPending' AND updated_at < ?", cutoff)) await this.refund(r.job_id);
  }

  private async buyerAddress(payer: string): Promise<string> {
    if (isAddress(payer)) return getAddress(payer);
    if (!this.d.mirror) throw new Error(`cannot map payer ${payer} to an EVM address without a Mirror Node`);
    return this.d.mirror.evmAddressFor(payer);
  }
}
