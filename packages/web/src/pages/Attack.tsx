import { useState } from "react";
import { GATEWAY, TUNNEL_HEADERS } from "../api";

const BEHAVIORS = ["honest", "garbage", "replay-other-input", "lazy-small-model", "lazy-engine", "truncate", "silent", "no-reveal", "collude"];
const ROLES = [
  { v: 0, label: "every role" },
  { v: 1, label: "as executor" },
  { v: 2, label: "as verifier" },
  { v: 3, label: "as committee member" },
];

export function AttackPage() {
  const [token, setToken] = useState("");
  const [operator, setOperator] = useState("all");
  const [behavior, setBehavior] = useState("garbage");
  const [role, setRole] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [s, ...l].slice(0, 20));
  const auth = { Authorization: `Bearer ${token}` };

  const apply = async (reset = false) => {
    const r = await fetch(`${GATEWAY}/demo/behavior`, { method: "POST", headers: { ...TUNNEL_HEADERS, ...auth, "Content-Type": "application/json" }, body: JSON.stringify(reset ? { operator: "all", reset: true } : { operator, behavior, role }) });
    add(`${reset ? "reset all to honest" : `${operator}: ${behavior} ${ROLES.find((x) => x.v === role)!.label}`} -> HTTP ${r.status}`);
  };
  return (
    <div className="stack narrow">
      <h2>Attack lab</h2>
      <p className="small muted">For the team running the demo pool: flip an operator's behavior (needs the gateway's demo token). These are the team's own operators misbehaving on purpose; the payment, the chain and the models stay real.</p>
      <input className="jobinput" type="password" placeholder="demo control token" value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="row wrap">
        <input className="jobinput mono" style={{ flex: 1 }} placeholder="operator address or all" value={operator} onChange={(e) => setOperator(e.target.value.trim())} />
        <select value={behavior} onChange={(e) => setBehavior(e.target.value)}>{BEHAVIORS.map((b) => <option key={b}>{b}</option>)}</select>
        <select value={role} onChange={(e) => setRole(Number(e.target.value))}>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</select>
        <button onClick={() => apply()}>Apply</button>
        <button className="ghost" onClick={() => apply(true)}>Reset</button>
      </div>
      <p className="small">Then pay for a job on the <b>Try it</b> tab with your own wallet and watch the outcome on its job page.</p>
      <p className="small muted">A colluding pair is caught only if the audit or a challenger draws an honest verifier. The audit rate may be raised for the demo [DEMO].</p>
      <pre className="small">{log.join("\n") || "no actions yet"}</pre>
    </div>
  );
}
