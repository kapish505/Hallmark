import { useEffect, useState } from "react";
import { GATEWAY } from "./api";
import { JobPage } from "./pages/Job";
import { TryPage } from "./pages/Try";
import { NetworkPage } from "./pages/Network";
import { CoreModelPage } from "./pages/CoreModel";
import { AttackPage } from "./pages/Attack";
import { VerifyPage } from "./pages/Verify";

const TABS = ["Try it", "Job", "Network", "Core model", "Attack lab", "Verify"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Try it");
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
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◆</span> Hallmark
          <span className="sub">pay-per-request OCR and speech-to-text from bonded operators, checked by sampled re-runs</span>
        </div>
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
        {tab === "Attack lab" && <AttackPage onJob={openJob} />}
        {tab === "Verify" && <VerifyPage jobId={jobId} />}
      </main>
      <footer className="small muted">
        Testnet only · x402 payments on Hedera · shows fidelity to a pinned model, not truth · trust assumptions T1-T6 in the README
      </footer>
    </div>
  );
}
