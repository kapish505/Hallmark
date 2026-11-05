import { Wallet } from "ethers";
import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@x402/hedera";
import { toWire, type WireUnits } from "@hallmark/shared";

/** Returns the refund transaction id. */
export interface Refunder {
  refund(payer: string, tinybar: bigint): Promise<string>;
}

/**
 * HAPI TransferTransaction from the gateway account (E4). Uses the Hiero SDK re-exported by
 * @x402/hedera so there is one SDK instance in the process (see that package's README).
 */
export class HederaRefunder implements Refunder {
  private readonly client: Client;
  constructor(private readonly accountId: string, privateKeyHex: string, network: "testnet" | "mainnet" = "testnet") {
    this.client = (network === "testnet" ? Client.forTestnet() : Client.forMainnet()).setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKeyHex),
    );
  }
  async refund(payer: string, tinybar: bigint): Promise<string> {
    const resp = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(this.accountId), Hbar.fromTinybars((-tinybar).toString()))
      .addHbarTransfer(AccountId.fromString(payer), Hbar.fromTinybars(tinybar.toString()))
      .setTransactionMemo("hallmark refund")
      .execute(this.client);
    const receipt = await resp.getReceipt(this.client);
    if (receipt.status.toString() !== "SUCCESS") throw new Error(`refund status ${receipt.status}`);
    return resp.transactionId.toString();
  }
}

/** Plain EVM value transfer (local anvil runs, where the payer is an EVM address). */
export class EvmRefunder implements Refunder {
  constructor(private readonly wallet: Wallet, private readonly units: WireUnits) {}
  async refund(payer: string, tinybar: bigint): Promise<string> {
    const tx = await this.wallet.sendTransaction({ to: payer, value: toWire(tinybar, this.units) });
    const r = await tx.wait();
    if (!r || r.status !== 1) throw new Error("refund transfer failed");
    return tx.hash;
  }
}
