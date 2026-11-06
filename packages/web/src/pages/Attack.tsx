import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GATEWAY, getJson, TUNNEL_HEADERS } from "../api";

interface Scenario {
  id: string;
  title: string;
  expect: string;
  audit: number;
}

const BEHAVIORS = ["honest", "garbage", "replay-other-input", "lazy-small-model", "lazy-engine", "truncate", "silent", "no-reveal", "collude"];
const ROLES = [
  { v: 0, label: "every role" },
  { v: 1, label: "as executor" },
  { v: 2, label: "as verifier" },
  { v: 3, label: "as committee member" },
];

export function AttackPage() {
  const q = useQuery({ queryKey: ["scenarios"], queryFn: () => getJson<{ scenarios: Scenario[]; canSetAudit: boolean; demoMode: boolean }>("/demo/scenarios") });
  const [token, setToken] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [operator, setOperator] = useState("all");
  const [behavior, setBehavior] = useState("garbage");
  const [role, setRole] = useState(1);
  const [jobId, setJobId] = useState("");
  const add = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 30));
  const post = async (path: string, body?: unknown) => {
    const r = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { ...TUNNEL_HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  const run = async (label: string, f: () => Promise<string>) => {
    try {
      add(`${label}: ${await f()}`);
    } catch (e) {
      add(`${label}: failed, ${String(e instanceof Error ? e.message : e)}`);
    }
  };

  return (
    <div className="stack">
      <div className="narrow">
        <h2>Attack lab</h2>
        <p className="small muted">
          Pick a scenario, then pay for a job on the <b>Try it</b> tab and watch the outcome on its job page. The scenarios change the team's own demo
          operators; the payment, the chain and the models stay real. Needs the gateway's demo token.
        </p>
        <input className="jobinput" type="password" placeholder="demo control token" value={token} onChange={(e) => setToken(e.target.value)} />
        {q.data && !q.data.canSetAudit && <p className="warn small">The gateway has no demo owner key, so scenarios set behaviors but not the audit rate.</p>}
      </div>
      <div className="scenarios">
        {(q.data?.scenarios ?? []).map((s) => (
          <button
            key={s.id}
            className={`scenario${active === s.id ? " is-on" : ""}`}
            disabled={!token}
            onClick={() =>
              void run(s.title, async () => {
                const r = await post("/demo/scenario", { id: s.id });
                setActive(s.id);
                return `applied (audit ${r.audit})`;
              })
            }
          >
            <span className="scenario-title">{s.title}</span>
            <span className="scenario-expect">{s.expect}</span>
            <span className="scenario-audit mono">audit {s.audit / 100}%</span>
          </button>
        ))}
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Manual controls</h3>
          <div className="row wrap">
            <input className="mono" style={{ flex: 1, minWidth: 220 }} placeholder="operator address or all" value={operator} onChange={(e) => setOperator(e.target.value.trim())} />
            <select value={behavior} onChange={(e) => setBehavior(e.target.value)}>{BEHAVIORS.map((b) => <option key={b}>{b}</option>)}</select>
            <select value={role} onChange={(e) => setRole(Number(e.target.value))}>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</select>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button disabled={!token} onClick={() => void run(`${operator}: ${behavior}`, async () => (await post("/demo/behavior", { operator, behavior, role }), "set"))}>Set behavior</button>
            <button disabled={!token} className="ghost" onClick={() => void run("reset", async () => (await post("/demo/behavior", { operator: "all", reset: true }), "all operators honest"))}>Reset all</button>
          </div>
        </div>
        <div className="card">
          <h3>Challenges and canaries</h3>
          <div className="row wrap">
            <input className="mono" style={{ flex: 1, minWidth: 220 }} placeholder="0x... job id in its challenge window" value={jobId} onChange={(e) => setJobId(e.target.value.trim())} />
            <button disabled={!token || !jobId} onClick={() => void run("challenge", async () => `filed ${(await post("/demo/challenge", { jobId })).tx}`)}>Challenge job</button>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button disabled={!token} onClick={() => void run("canary", async () => (await post("/demo/canary"), "a canary job was started; results appear on the Network tab"))}>Run a canary now</button>
          </div>
        </div>
      </div>
      <pre className="small">{log.join("\n") || "no actions yet"}</pre>
    </div>
  );
}
