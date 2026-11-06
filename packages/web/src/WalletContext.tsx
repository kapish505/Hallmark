import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DAppSigner } from "@hashgraph/hedera-wallet-connect";
import { connectEvm, connectHedera, disconnectWallet, walletOptions, type WalletOption } from "./wallet";

interface W {
  kind: "hedera" | "evm" | null;
  accountId: string | null;
  signer: DAppSigner | null;
  evmAddress: string | null;
  connect: (opt: WalletOption) => Promise<void>;
  disconnect: () => Promise<void>;
  error: string | null;
}
const Ctx = createContext<W>({ kind: null, accountId: null, signer: null, evmAddress: null, connect: async () => {}, disconnect: async () => {}, error: null });
export const useWallet = () => useContext(Ctx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<W["kind"]>(null);
  const [signer, setSigner] = useState<DAppSigner | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [evmAddress, setEvm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = async (opt: WalletOption) => {
    setError(null);
    try {
      if (opt.kind === "evm") {
        const a = await connectEvm();
        setKind("evm");
        setEvm(a);
        setAccountId(`${a.slice(0, 6)}…${a.slice(-4)}`);
      } else {
        const w = await connectHedera(opt);
        setKind("hedera");
        setSigner(w.signer);
        setAccountId(w.accountId);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const disconnect = async () => {
    if (kind === "hedera") await disconnectWallet();
    setKind(null);
    setSigner(null);
    setEvm(null);
    setAccountId(null);
  };
  return <Ctx.Provider value={{ kind, accountId, signer, evmAddress, connect, disconnect, error }}>{children}</Ctx.Provider>;
}

export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<WalletOption[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void walletOptions().then(setOpts);
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [open]);
  if (w.accountId)
    return (
      <div className="row">
        <span className="mono small">{w.accountId}</span>
        <span className="small muted">{w.kind === "evm" ? "EVM wallet" : "Hedera wallet"}</span>
        <button className="ghost" onClick={() => void w.disconnect()}>Disconnect</button>
      </div>
    );
  return (
    <div className="wallet-menu" ref={box}>
      <button onClick={() => setOpen((v) => !v)}>Connect wallet</button>
      {open && (
        <div className="wallet-pop">
          {opts === null && <p className="small muted">Looking for wallets…</p>}
          {opts?.length === 0 && <p className="small muted">No wallet found. Install HashPack, or use MetaMask.</p>}
          {opts?.map((o) => (
            <button key={o.id} className="wallet-opt" onClick={() => { setOpen(false); void w.connect(o); }}>
              {o.icon && <img src={o.icon} alt="" width={18} height={18} />}
              <span>{o.name}</span>
              <small>{o.kind === "evm" ? "adds Hedera Testnet if missing" : o.kind === "hedera-qr" ? "WalletConnect" : "extension"}</small>
            </button>
          ))}
        </div>
      )}
      {w.error && <span className="bad small">{w.error}</span>}
    </div>
  );
}
