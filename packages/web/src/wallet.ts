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

async function getConnector(): Promise<DAppConnector> {
  if (!WC_PROJECT_ID) throw new Error("VITE_WALLETCONNECT_PROJECT_ID is not set (free project id from cloud.reown.com)");
  if (!connector) {
    connector = new DAppConnector(
      { name: "Hallmark", description: "Verified AI inference, paid per request", url: location.origin, icons: [`${location.origin}/favicon.svg`] },
      LedgerId.TESTNET,
      WC_PROJECT_ID,
      Object.values(HederaJsonRpcMethod),
      [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
      [HederaChainId.Testnet],
    );
    await connector.init({ logger: "error" });
  }
  return connector;
}

export interface WalletOption {
  id: string;
  name: string;
  kind: "hedera-extension" | "hedera-qr" | "evm";
  icon?: string;
}

/** Hedera extensions announce themselves shortly after init; EVM wallets inject window.ethereum. */
export async function walletOptions(): Promise<WalletOption[]> {
  const out: WalletOption[] = [];
  try {
    const c = await getConnector();
    await new Promise((r) => setTimeout(r, 700));
    for (const e of c.extensions.filter((x) => x.available)) out.push({ id: e.id, name: e.name ?? "Hedera wallet", kind: "hedera-extension", icon: e.icon });
    out.push({ id: "qr", name: "Other Hedera wallet (QR code)", kind: "hedera-qr" });
  } catch {
    /* no project id: only the EVM option */
  }
  const eth = (window as unknown as { ethereum?: { isMetaMask?: boolean } }).ethereum;
  if (eth) out.push({ id: "evm", name: eth.isMetaMask ? "MetaMask" : "Browser EVM wallet", kind: "evm" });
  return out;
}

export async function connectHedera(opt: WalletOption): Promise<{ signer: DAppSigner; accountId: string }> {
  const c = await getConnector();
  if (!c.signers.length) {
    if (opt.kind === "hedera-extension") await c.connectExtension(opt.id); // opens the extension's popup
    else await c.openModal();
  }
  const signer = c.signers[0];
  if (!signer) throw new Error("wallet did not connect");
  return { signer, accountId: signer.getAccountId().toString() };
}

export async function disconnectWallet() {
  await connector?.disconnectAll().catch(() => undefined);
}

/* ------------------------------------------------------------------ EVM wallets (MetaMask) */
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;
export const HEDERA_TESTNET = {
  chainId: "0x128",
  chainName: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: ["https://testnet.hashio.io/api"],
  blockExplorerUrls: ["https://hashscan.io/testnet"],
};

/** Connect, then switch to Hedera Testnet, adding the network to the wallet first if it is missing. */
export async function connectEvm(): Promise<string> {
  const w = eth();
  if (!w) throw new Error("no EVM wallet found in this browser");
  const accounts = (await w.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("wallet returned no account");
  await ensureHederaTestnet();
  return accounts[0];
}

export async function ensureHederaTestnet() {
  const w = eth()!;
  if (((await w.request({ method: "eth_chainId" })) as string).toLowerCase() === HEDERA_TESTNET.chainId) return;
  try {
    await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEDERA_TESTNET.chainId }] });
  } catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
    if (code !== 4902) throw e;
    await w.request({ method: "wallet_addEthereumChain", params: [HEDERA_TESTNET] });
  }
}

/**
 * Direct-transfer payment for EVM wallets: send the price in HBAR to the gateway's EVM address, wait for
 * the receipt, then submit the job with the transaction hash. The gateway checks it on the Mirror Node.
 */
export async function payDirect(from: string, payToEvm: string, priceTinybar: string, endpoint: string, form: FormData): Promise<{ status: number; body: Record<string, unknown>; tx: string }> {
  await ensureHederaTestnet();
  const w = eth()!;
  const value = "0x" + (BigInt(priceTinybar) * 10_000_000_000n).toString(16); // tinybar -> weibar on the wire
  const tx = (await w.request({ method: "eth_sendTransaction", params: [{ from, to: payToEvm, value }] })) as string;
  for (let i = 0; i < 60; i++) {
    const r = (await w.request({ method: "eth_getTransactionReceipt", params: [tx] })) as { status?: string } | null;
    if (r?.status === "0x1") break;
    if (r?.status === "0x0") throw new Error("the HBAR transfer failed");
    await new Promise((res) => setTimeout(res, 1500));
  }
  const res = await fetch(endpoint, { method: "POST", body: form, headers: { "X-Payment-Tx": tx, "ngrok-skip-browser-warning": "1" } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown>, tx };
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
  const tunnelFetch: typeof fetch = (input, init) => {
    const req = new Request(input as RequestInfo, init);
    req.headers.set("ngrok-skip-browser-warning", "1");
    return fetch(req);
  };
  const paid = wrapFetchWithPayment(tunnelFetch, client) as typeof fetch;
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
