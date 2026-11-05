/**
 * Real user wallet payments (no sponsored buyer). The visitor connects a Hedera wallet (HashPack,
 * Kabila, Blade...) over Hedera WalletConnect; x402 payments are TransferTransactions that the
 * WALLET signs. The facilitator adds its fee-payer signature and submits. Nothing is mocked.
 */
import { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent, type DAppSigner } from "@hashgraph/hedera-wallet-connect";
import { AccountId, Client, Hbar, LedgerId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";

export const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";
const NETWORK = "hedera:testnet";
const HBAR = "0.0.0";

let connector: DAppConnector | null = null;

export async function connectWallet(): Promise<{ signer: DAppSigner; accountId: string }> {
  if (!WC_PROJECT_ID) throw new Error("VITE_WALLETCONNECT_PROJECT_ID is not set (free project id from cloud.reown.com)");
  if (!connector) {
    connector = new DAppConnector(
      { name: "Hallmark", description: "Pay-per-request OCR and speech-to-text, checked by sampled re-runs", url: location.origin, icons: [`${location.origin}/favicon.svg`] },
      LedgerId.TESTNET,
      WC_PROJECT_ID,
      Object.values(HederaJsonRpcMethod),
      [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
      [HederaChainId.Testnet],
    );
    await connector.init({ logger: "error" });
  }
  if (!connector.signers.length) await connector.openModal();
  const signer = connector.signers[0];
  if (!signer) throw new Error("wallet did not connect");
  return { signer, accountId: signer.getAccountId().toString() };
}

export async function disconnectWallet() {
  await connector?.disconnectAll().catch(() => undefined);
}

const toBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** x402 "exact" client scheme for Hedera whose transfer is signed by the user's wallet. */
function walletScheme(signer: DAppSigner) {
  const payer = signer.getAccountId();
  return {
    scheme: "exact",
    async createPaymentPayload(x402Version: number, req: { scheme: string; network: string; amount: string; asset: string; payTo: string; extra?: Record<string, unknown> }) {
      if (req.scheme !== "exact" || req.network !== NETWORK || req.asset !== HBAR) throw new Error("unsupported payment requirement");
      const feePayer = req.extra?.feePayer;
      if (typeof feePayer !== "string") throw new Error("facilitator feePayer missing");
      const amount = BigInt(req.amount);
      const tx = new TransferTransaction()
        .addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()))
        .addHbarTransfer(AccountId.fromString(req.payTo), Hbar.fromTinybars(amount.toString()))
        .setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)))
        .setTransactionMemo("hallmark x402");
      const client = Client.forTestnet();
      tx.freezeWith(client);
      const signed = await signer.signTransaction(tx);
      client.close();
      return { x402Version, payload: { transaction: toBase64(signed.toBytes()) } };
    },
  };
}

export interface PaidResponse {
  status: number;
  body: Record<string, unknown>;
  settlement: { success: boolean; transaction: string } | null;
}

/**
 * Pay for one request. Before the wallet is asked to sign, the 402 terms are checked against the
 * manifest (network, asset, payTo, exact amount) and the user's own per-call cap.
 */
export async function payAndPost(
  signer: DAppSigner,
  url: string,
  form: FormData,
  expect: { payTo: string; amountTinybar: string; maxTinybar: bigint },
): Promise<PaidResponse> {
  let refusal: string | null = null;
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: walletScheme(signer) as never }],
    policies: [
      (_v: number, reqs: Array<{ network: string; asset: string; amount: string; payTo: string }>) =>
        reqs.filter((r) => {
          const why =
            r.network !== NETWORK ? "wrong network" : r.asset !== HBAR ? "not HBAR" : r.payTo !== expect.payTo ? `payTo ${r.payTo} is not the manifest's ${expect.payTo}` : r.amount !== expect.amountTinybar ? `amount ${r.amount} differs from the advertised ${expect.amountTinybar}` : BigInt(r.amount) > expect.maxTinybar ? "above your per-call cap" : null;
          if (why) refusal = why;
          return why === null;
        }),
    ] as never,
    spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: NETWORK, asset: HBAR, maxAmountPerPayment: expect.maxTinybar.toString() }] },
  } as never);
  const paid = wrapFetchWithPayment(fetch, client) as typeof fetch;
  let res: Response;
  try {
    res = await paid(url, { method: "POST", body: form });
  } catch (e) {
    throw new Error(refusal ? `refused: ${refusal}` : String(e instanceof Error ? e.message : e));
  }
  const h = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const s = h ? decodePaymentResponseHeader(h) : null;
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown>, settlement: s ? { success: s.success, transaction: s.transaction } : null };
}
