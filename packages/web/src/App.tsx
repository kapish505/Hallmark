import { useEffect, useState } from "react";
import { GATEWAY } from "./api";
import { JobPage } from "./pages/Job";
import { TryPage } from "./pages/Try";
import { NetworkPage } from "./pages/Network";
import { EconomicsPage } from "./pages/Economics";
import { AttackPage } from "./pages/Attack";
import { VerifyPage } from "./pages/Verify";

const TABS = ["Try it", "Job", "Network", "Economics", "Attack lab", "Verify"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Try it");
  const [jobId, setJobId] = useState(() => new URLSearchParams(location.search).get("job") ?? "");
  useEffect(() => {
    if (jobId) history.replaceState(null, "", `?job=${jobId}`);
  }, [jobId]);
  const openJob = (id: string) => {
    setJobId(id);
    setTab("Job");
  };
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◆</span> Hallmark
          <span className="sub">pay-per-request AI inference, wrong answers refunded</span>
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
            <JobPage jobId={jobId} />
          </>
        )}
        {tab === "Network" && <NetworkPage />}
        {tab === "Economics" && <EconomicsPage />}
        {tab === "Attack lab" && <AttackPage onJob={openJob} />}
        {tab === "Verify" && <VerifyPage jobId={jobId} />}
      </main>
      <footer className="small muted">
        Testnet only · Hedera x402 payments · 0G attested re-runs for disputes · not trustless: see trust assumptions in the README
      </footer>
    </div>
  );
}
