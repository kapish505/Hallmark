import { useEffect, useState } from "react";
import { GATEWAY } from "./api";
import { WalletButton, WalletProvider } from "./WalletContext";
import { Composer } from "./console/Composer";
import { JobView } from "./console/JobView";
import { NetworkPanel } from "./console/NetworkPanel";
import { DemoDrawer } from "./console/DemoDrawer";
import { useStream } from "./console/live";

const tokens = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem("hm-tokens") ?? "{}");
  } catch {
    return {};
  }
};

export function App() {
  const live = useStream();
  const params = new URLSearchParams(location.search);
  const [jobId, setJobId] = useState(params.get("job") ?? "");
  const [token, setToken] = useState(params.get("token") ?? tokens()[(params.get("job") ?? "").toLowerCase()] ?? "");
  useEffect(() => {
    history.replaceState(null, "", jobId ? `/console?job=${jobId}${token ? `&token=${token}` : ""}` : "/console");
  }, [jobId, token]);
  const open = (id: string, tok?: string) => {
    setJobId(id);
    const known = tokens();
    if (tok) {
      known[id.toLowerCase()] = tok;
      try {
        localStorage.setItem("hm-tokens", JSON.stringify(known));
      } catch {
        /* private mode */
      }
    }
    setToken(tok ?? known[id.toLowerCase()] ?? "");
  };

  return (
    <WalletProvider>
      <div className="console">
        <header className="topbar">
          <a className="brand" href="/">
            <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true" style={{ color: "var(--brass)" }}>
              <path d="M9 8v16M23 8v16M9 16h14" stroke="currentColor" strokeWidth="2.4" />
              <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            Hallmark
          </a>
          <span className={`net ${GATEWAY ? "" : "bad"}`}>
            <i className={live ? "on" : ""} />
            Hedera testnet {live ? "· live" : "· polling"}
          </span>
          <div className="push" />
          <WalletButton />
        </header>
        {!GATEWAY && <p className="bad banner">VITE_GATEWAY_URL is not set.</p>}
        <main className="grid-console">
          <div className="col-left">
            <Composer onJob={open} />
            <DemoDrawer selected={jobId} />
          </div>
          <JobView id={jobId} token={token} />
          <NetworkPanel selected={jobId} onSelect={(id) => open(id)} />
        </main>
        <footer className="console-foot">
          {[
            ["Hallmark", "0x4Ae8e841fD17c70F9E1628e4a0121944288c46CE"],
            ["HallmarkVerdict", "0x16E332bC16DB931e65cF14e28E57E80f18897be2"],
            ["ModelRegistry", "0x5902c6e3020297B6Bf47bFf050357Df9108a234f"],
          ].map(([n, a]) => (
            <a key={n} href={`https://hashscan.io/testnet/contract/${a}`} target="_blank" rel="noreferrer">
              <span>{n}</span>
              <span className="mono">{a.slice(0, 8)}…{a.slice(-6)}</span>
            </a>
          ))}
          <a href="https://github.com/kapish505/Hallmark" target="_blank" rel="noreferrer">
            <span>Source</span>
            <span className="mono">github.com/kapish505/Hallmark</span>
          </a>
          <a href="/docs">
            <span>Docs</span>
            <span className="mono">integrate in ten lines</span>
          </a>
        </footer>
      </div>
    </WalletProvider>
  );
}
