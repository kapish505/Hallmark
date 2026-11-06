import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GATEWAY, getJson, TUNNEL_HEADERS } from "../api";

interface Scenario { id: string; title: string; expect: string; audit: number }

const read = () => {
  try {
    return sessionStorage.getItem("hm-demo") ?? "";
  } catch {
    return "";
  }
};

/** Demo controls for the team's own operators (token-protected on the gateway). */
export function DemoDrawer({ selected }: { selected: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(read);
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["scenarios"], queryFn: () => getJson<{ scenarios: Scenario[]; canSetAudit: boolean; demoMode: boolean }>("/demo/scenarios"), enabled: open });
  const save = (v: string) => {
    setToken(v);
    try {
      sessionStorage.setItem("hm-demo", v);
    } catch {
      /* private mode */
    }
  };
  const post = async (path: string, body?: unknown) => {
    const r = await fetch(`${GATEWAY}${path}`, { method: "POST", headers: { ...TUNNEL_HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  const act = async (label: string, f: () => Promise<string>) => {
    setNote(`${label}…`);
    try {
      setNote(`${label}: ${await f()}`);
    } catch (e) {
      setNote(`${label}: ${String(e instanceof Error ? e.message : e)}`);
    }
  };

  return (
    <section className={`panel demo${open ? " is-open" : ""}`}>
      <button className="demo-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Demo scenarios</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="demo-body">
          <input type="password" placeholder="Demo control token" value={token} onChange={(e) => save(e.target.value)} />
          {q.data && !q.data.demoMode && <p className="dim small">Demo mode is off on this gateway.</p>}
          <div className="scen">
            {(q.data?.scenarios ?? []).map((s) => (
              <button key={s.id} disabled={!token} className={active === s.id ? "is-on" : ""} title={s.expect} onClick={() => void act(s.title, async () => { const r = await post("/demo/scenario", { id: s.id }); setActive(s.id); return `set, audit ${r.audit}`; })}>
                {s.title}
              </button>
            ))}
          </div>
          {active && <p className="dim small">{q.data?.scenarios.find((s) => s.id === active)?.expect} Now pay for a job.</p>}
          <div className="demo-actions">
            <button disabled={!token} onClick={() => void act("Reset", async () => (await post("/demo/behavior", { operator: "all", reset: true }), setActive(null), "all operators honest"))}>Reset operators</button>
            <button disabled={!token || !selected} onClick={() => void act("Challenge", async () => `filed ${(await post("/demo/challenge", { jobId: selected })).tx.slice(0, 12)}…`)}>Challenge selected job</button>
            <button disabled={!token} onClick={() => void act("Canary", async () => (await post("/demo/canary"), "started"))}>Run a canary</button>
          </div>
          {note && <p className="mono small dim">{note}</p>}
        </div>
      )}
    </section>
  );
}
