import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GATEWAY, getJson, short } from "../api";

const BEHAVIORS = ["honest", "garbage", "replay", "lazy-tiny", "silent", "no-reveal", "collude"] as const;

export function AttackPage({ onJob }: { onJob: (id: string) => void }) {
  const qc = useQueryClient();
  const miners = useQuery({ queryKey: ["demo-miners"], queryFn: () => getJson<Record<string, { behavior: string } | null>>("/demo/miners"), refetchInterval: 4000 });
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function set(addr: string, behavior: string) {
    const r = await fetch(`${GATEWAY}/demo/miners/${addr}/behavior`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ behavior }) });
    if (!r.ok) setMsg(`could not set behavior: HTTP ${r.status}`);
    qc.invalidateQueries({ queryKey: ["demo-miners"] });
  }
  async function submit() {
    if (!file) return;
    setMsg("Submitting a paid job…");
    const f = new FormData();
    f.append("audio", file);
    const r = await fetch(`${GATEWAY}/demo/try`, { method: "POST", body: f });
    const body = await r.json();
    if (!r.ok) return setMsg(body.error ?? `HTTP ${r.status}`);
    onJob(body.result.jobId);
  }

  if (miners.error) return <p className="bad">Attack lab needs the gateway in DEMO_MODE: {String(miners.error)}</p>;
  return (
    <div className="stack">
      <h2>Attack lab</h2>
      <p className="muted">
        Flip a miner into a cheating behaviour, submit a job, and watch it get caught and slashed. Demo-only controls; production miners have no
        such switch.
      </p>
      <section className="card">
        <table>
          <tbody>
            {Object.entries(miners.data ?? {}).map(([addr, st]) => (
              <tr key={addr}>
                <td className="mono">{short(addr)}</td>
                <td>{st?.behavior ?? "offline"}</td>
                <td className="row wrap">
                  {BEHAVIORS.map((b) => (
                    <button key={b} className={st?.behavior === b ? "active" : "ghost"} onClick={() => set(addr, b)}>
                      {b}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card row wrap">
        <input type="file" accept=".wav,.flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button disabled={!file} onClick={submit}>
          Submit job
        </button>
        {msg && <span className="muted">{msg}</span>}
      </section>
      <p className="small muted">
        Collusion (both miners “collude”) passes the fast path; the challenger bot challenges it within the window. For the random-audit scene the
        owner raises auditBps to 100% — disclosed as a demo setting.
      </p>
    </div>
  );
}
