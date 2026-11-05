import { useEffect, useState } from "react";
import { GATEWAY } from "./api";
import { JobPage } from "./pages/Job";
import { TryPage } from "./pages/Try";
import { NetworkPage } from "./pages/Network";
import { CoreModelPage } from "./pages/CoreModel";
import { AttackPage } from "./pages/Attack";
import { VerifyPage } from "./pages/Verify";
import { WalletButton, WalletProvider } from "./WalletContext";

const TABS = ["Try it", "Job", "Network", "Core model", "Attack lab", "Verify"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash === "#verify" ? "Verify" : "Try it"));
  const [jobId, setJobId] = useState(() => new URLSearchParams(location.search).get("job") ?? "");
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get("token") ?? "");
  useEffect(() => {
    if (jobId) history.replaceState(null, "", `?job=${jobId}${token ? `&token=${token}` : ""}`);
  }, [jobId, token]);
  const openJob = (id: string, tok?: string) => {
    setJobId(id);
    setToken(tok ?? "");
    setTab("Job");
  };
  return (
    <WalletProvider>
    <div className="app">
      <header>
        <a className="brand" href="/">
          <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true" style={{ color: "var(--brass)" }}>
            <path d="M9 8v16M23 8v16M9 16h14" stroke="currentColor" strokeWidth="2.4" />
            <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          Hallmark <span className="sub">console</span>
        </a>
        <WalletButton />
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      {!GATEWAY && <p className="bad banner">Set VITE_GATEWAY_URL to your gateway (packages/web/.env).</p>}
      <main>
        {tab === "Try it" && <TryPage onJob={openJob} />}
        {tab === "Job" && (
          <>
            <input className="jobinput mono" placeholder="0x… job id" value={jobId} onChange={(e) => setJobId(e.target.value.trim())} />
            <JobPage jobId={jobId} token={token} />
          </>
        )}
        {tab === "Network" && <NetworkPage />}
        {tab === "Core model" && <CoreModelPage />}
        {tab === "Attack lab" && <AttackPage />}
        {tab === "Verify" && <VerifyPage jobId={jobId} />}
      </main>
      <footer className="small muted">
        Testnet only · x402 payments on Hedera · shows fidelity to a pinned model, not truth · trust assumptions T1-T6 in the README
      </footer>
    </div>
    </WalletProvider>
  );
}
