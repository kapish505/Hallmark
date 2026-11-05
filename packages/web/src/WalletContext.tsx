import { createContext, useContext, useState, type ReactNode } from "react";
import type { DAppSigner } from "@hashgraph/hedera-wallet-connect";
import { connectWallet, disconnectWallet } from "./wallet";

interface W {
  accountId: string | null;
  signer: DAppSigner | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  error: string | null;
}
const Ctx = createContext<W>({ accountId: null, signer: null, connect: async () => {}, disconnect: async () => {}, error: null });
export const useWallet = () => useContext(Ctx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<DAppSigner | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setError(null);
    try {
      const w = await connectWallet();
      setSigner(w.signer);
      setAccountId(w.accountId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const disconnect = async () => {
    await disconnectWallet();
    setSigner(null);
    setAccountId(null);
  };
  return <Ctx.Provider value={{ accountId, signer, connect, disconnect, error }}>{children}</Ctx.Provider>;
}

export function WalletButton() {
  const w = useWallet();
  return (
    <div className="row">
      {w.accountId ? (
        <>
          <span className="mono small">{w.accountId}</span>
          <button className="ghost" onClick={() => void w.disconnect()}>Disconnect</button>
        </>
      ) : (
        <button onClick={() => void w.connect()}>Connect Hedera wallet</button>
      )}
      {w.error && <span className="bad small">{w.error}</span>}
    </div>
  );
}
