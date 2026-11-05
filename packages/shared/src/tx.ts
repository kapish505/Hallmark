import { Wallet, type Contract, type TransactionReceipt, type TransactionResponse } from "ethers";
import { decodeError } from "./contracts.js";
import { sleep } from "./http.js";
import { logger } from "./log.js";

const log = logger("tx");

export class TxRevert extends Error {
  constructor(
    public readonly reason: string,
    public readonly receipt?: TransactionReceipt | null,
  ) {
    super(reason);
  }
}

const TRANSIENT = /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|429|Too Many Requests|502|503|504|network error|failed to detect network/i;

/**
 * One queue per key (§9.2 tx hygiene): serialized sends, locally tracked nonce, explicit gas
 * limits, retries only for failures that happened BEFORE broadcast. Once a tx hash exists we only
 * ever poll that hash — never resend something that may already have landed.
 */
export class TxSender {
  private chain: Promise<unknown> = Promise.resolve();
  private nonce: number | null = null;

  constructor(
    public readonly wallet: Wallet,
    private readonly opts: { defaultGasLimit: number; confirmTimeoutMs?: number },
  ) {}

  get address() {
    return this.wallet.address;
  }

  /** Simulate (to surface a decoded revert early), then send and wait for the receipt. */
  send(
    contract: Contract,
    method: string,
    args: unknown[],
    o: { value?: bigint; gasLimit?: number; label?: string } = {},
  ): Promise<TransactionReceipt> {
    const run = async () => {
      const fn = contract.getFunction(method);
      const overrides = { value: o.value ?? 0n, gasLimit: o.gasLimit ?? this.opts.defaultGasLimit };
      try {
        await fn.staticCall(...args, { ...overrides, from: this.wallet.address });
      } catch (e) {
        throw new TxRevert(decodeError(e));
      }
      const populated = await fn.populateTransaction(...args, overrides);
      let resp: TransactionResponse | null = null;
      for (let attempt = 0; attempt < 4 && !resp; attempt++) {
        try {
          if (this.nonce === null) this.nonce = await this.wallet.getNonce("pending");
          resp = await this.wallet.sendTransaction({ ...populated, nonce: this.nonce });
          this.nonce += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/nonce (too low|has already been used)|NONCE_EXPIRED|replacement/i.test(msg)) {
            this.nonce = null; // resync from the node and retry
            continue;
          }
          if (TRANSIENT.test(msg)) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new TxRevert(decodeError(e));
        }
      }
      if (!resp) throw new Error(`${o.label ?? method}: could not broadcast`);
      log.debug(`${o.label ?? method} sent`, { hash: resp.hash });
      const receipt = await this.waitFor(resp.hash);
      if (!receipt || receipt.status !== 1) throw new TxRevert(`${o.label ?? method} reverted on chain`, receipt);
      return receipt;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async waitFor(hash: string): Promise<TransactionReceipt | null> {
    const deadline = Date.now() + (this.opts.confirmTimeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      try {
        const r = await this.wallet.provider!.getTransactionReceipt(hash);
        if (r) return r;
      } catch (e) {
        if (!TRANSIENT.test(String(e))) throw e;
      }
      await sleep(1000);
    }
    throw new Error(`no receipt for ${hash} after timeout — check it before acting again`);
  }
}
