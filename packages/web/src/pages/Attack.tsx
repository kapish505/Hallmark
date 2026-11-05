import { useState } from "react";
import { GATEWAY } from "../api";

const BEHAVIORS = ["honest", "garbage", "replay-other-input", "lazy-small-model", "lazy-engine", "truncate", "silent", "no-reveal", "collude"];
const ROLES = [
  { v: 0, label: "every role" },
  { v: 1, label: "as executor" },
  { v: 2, label: "as verifier" },
  { v: 3, label: "as committee member" },
];

export function AttackPage({ onJob }: { onJob: (id: string) => void }) {
  const [token, setToken] = useState("");
  const [operator, setOperator] = useState("all");
  const [behavior, setBehavior] = useState("garbage");
  const [role, setRole] = useState(1);
  const [task, setTask] = useState<"asr" | "ocr">("asr");
  const [file, setFile] = useState<File | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [s, ...l].slice(0, 20));
  const auth = { Authorization: `Bearer ${token}` };

  const apply = async (reset = false) => {
    const r = await fetch(`${GATEWAY}/demo/behavior`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(reset ? { operator: "all", reset: true } : { operator, behavior, role }) });
    add(`${reset ? "reset all to honest" : `${operator}: ${behavior} ${ROLES.find((x) => x.v === role)!.label}`} -> HTTP ${r.status}`);
  };
  const run = async () => {
    if (!file) return;
    const f = new FormData();
    f.append("task", task);
    f.append("file", file);
    add(`paying for a ${task} job (demo buyer)...`);
    const r = await fetch(`${GATEWAY}/demo/try`, { method: "POST", headers: auth, body: f });
    const j = await r.json();
    add(r.ok ? `job ${j.jobId}: ${j.status}, ${j.badge}` : `error: ${j.error}`);
    if (j.jobId) onJob(j.jobId);
  };

  return (
    <div className="stack narrow">
      <h2>Attack lab</h2>
      <p className="small muted">Flip an operator's behavior, then run a paid job and watch the protocol respond on chain. Testnet demo only; needs the gateway's demo token.</p>
      <input className="jobinput" type="password" placeholder="demo control token" value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="row wrap">
        <input className="jobinput mono" style={{ flex: 1 }} placeholder="operator address or all" value={operator} onChange={(e) => setOperator(e.target.value.trim())} />
        <select value={behavior} onChange={(e) => setBehavior(e.target.value)}>{BEHAVIORS.map((b) => <option key={b}>{b}</option>)}</select>
        <select value={role} onChange={(e) => setRole(Number(e.target.value))}>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</select>
        <button onClick={() => apply()}>Apply</button>
        <button className="ghost" onClick={() => apply(true)}>Reset</button>
      </div>
      <div className="row wrap">
        <select value={task} onChange={(e) => setTask(e.target.value as "asr" | "ocr")}><option value="asr">speech (WAV)</option><option value="ocr">OCR (PNG)</option></select>
        <input type="file" accept={task === "asr" ? ".wav" : ".png"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button disabled={!file} onClick={run}>Run job</button>
      </div>
      <p className="small muted">A colluding pair is caught only if the audit or a challenger draws an honest verifier. The audit rate may be raised for the demo [DEMO].</p>
      <pre className="small">{log.join("\n") || "no actions yet"}</pre>
    </div>
  );
}
