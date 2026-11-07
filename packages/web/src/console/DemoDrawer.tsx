import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GATEWAY, getJson, TUNNEL_HEADERS } from "../api";

interface Scenario { id: string; title: string; expect: string; audit: number }
interface ScenarioInfo {
  scenarios: Scenario[];
  canSetAudit: boolean;
  demoMode: boolean;
  public: boolean;
  active: { id: string; title: string; expiresAt: number } | null;
}
interface ManifestLite { tasks: Array<{ task: string; calibration?: { cheatsPiBps: Record<string, number>; inputs: number } }> }

/** which measured cheat each scenario's executor uses (keys in the manifest's calibration.cheatsPiBps) */
const CHEAT_OF: Record<string, string> = { garbage: "garbage", lazy: "lazy-small-model", truncate: "truncate", replay: "replay-other-input" };
const TASK_NAME: Record<string, string> = { asr: "speech", ocr: "OCR" };

const readToken = () => {
  try {
    return sessionStorage.getItem("hm-demo") ?? "";
  } catch {
    return "";
  }
};

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * The attack lab: make the demo operators misbehave and watch the protocol catch it. Open to anyone when
 * the gateway runs with DEMO_PUBLIC (rate-limited); a scenario resets to honest operators on its own.
 */
export function DemoDrawer({ selected }: { selected: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(readToken);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["scenarios"], queryFn: () => getJson<ScenarioInfo>("/demo/scenarios"), refetchInterval: open ? 10_000 : false, enabled: open });
  const m = useQuery({ queryKey: ["manifest"], queryFn: () => getJson<ManifestLite>("/.well-known/hallmark.json"), enabled: open });
  const info = q.data;
  const needsToken = !!info && !info.public;
  const can = !!info?.demoMode && (!needsToken || !!token);
  const now = useNow(!!info?.active);
  const left = info?.active ? Math.max(0, Math.round((info.active.expiresAt - now) / 1000)) : 0;

  const post = async (path: string, body?: unknown) => {
    const headers: Record<string, string> = { ...TUNNEL_HEADERS, "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${GATEWAY}${path}`, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
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
    void qc.invalidateQueries({ queryKey: ["scenarios"] });
    void qc.invalidateQueries({ queryKey: ["manifest"] });
  };
  /** measured catch rate per model for a scenario's cheat, only where it was measured */
  const caught = (id: string) => {
    const key = CHEAT_OF[id];
    if (!key || !m.data) return null;
    const parts = m.data.tasks
      .map((t) => {
        const v = t.calibration?.cheatsPiBps[key];
        return v === undefined ? null : `${TASK_NAME[t.task] ?? t.task} ${Math.round(v / 100)}%`;
      })
      .filter(Boolean);
    return parts.length ? `caught on ${parts.join(" · ")} of inputs` : null;
  };
  const n = m.data?.tasks.find((t) => t.calibration)?.calibration?.inputs;

  return (
    <section className={`panel demo${open ? " is-open" : ""}`}>
      <button className="demo-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Attack lab: make an operator cheat</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="demo-body">
          <p className="dim small">
            Pick a misbehavior for the demo operators, then run a job. Re-run share goes to 100% so you see the check every time. Scenarios reset to
            honest by themselves.
          </p>
          {info && !info.demoMode && <p className="dim small">Demo mode is off on this gateway.</p>}
          {info?.active && (
            <p className="demo-active">
              <b>{info.active.title}</b> is active · resets in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </p>
          )}
          {needsToken && (
            <label className="demo-token">
              <span>Demo token (this gateway is not in public mode)</span>
              <input
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  try {
                    sessionStorage.setItem("hm-demo", e.target.value);
                  } catch {
                    /* private mode */
                  }
                }}
              />
            </label>
          )}
          <div className="scen">
            {(info?.scenarios ?? []).map((s) => {
              const c = caught(s.id);
              return (
                <button
                  key={s.id}
                  disabled={!can}
                  className={info?.active?.id === s.id ? "is-on" : ""}
                  title={s.expect}
                  onClick={() => void act(s.title, async () => `${(await post("/demo/scenario", { id: s.id })).audit} re-run share. Now run a job.`)}
                >
                  <span>{s.title}</span>
                  {c && <small>{c}</small>}
                </button>
              );
            })}
          </div>
          {n && <p className="dim small">Catch rates are measured per input on the {n}-input calibration set; a cheat that matches the honest answer on an input can't be caught there.</p>}
          {info?.active && <p className="dim small">{info.scenarios.find((s) => s.id === info.active!.id)?.expect}</p>}
          <div className="demo-actions">
            <button disabled={!can} onClick={() => void act("Reset", async () => (await post("/demo/reset"), "honest operators, default re-run share"))}>Reset to honest</button>
            <button disabled={!can || !selected} onClick={() => void act("Challenge", async () => `filed ${(await post("/demo/challenge", { jobId: selected })).tx.slice(0, 12)}…`)}>Challenge selected job</button>
          </div>
          {note && <p className="mono small dim">{note}</p>}
        </div>
      )}
    </section>
  );
}
