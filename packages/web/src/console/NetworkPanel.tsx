import { useQuery } from "@tanstack/react-query";
import { getJson, short, SLASH_REASON, tinybarToHbar } from "../api";
import { useJobs, useNetwork } from "./live";

interface CanaryTask { runs: number; passRate: number | null; meanError: number | null }
interface CanaryStats { enabled: boolean; asr?: CanaryTask; ocr?: CanaryTask }
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(0)}%`);
const hb = (t: string | number) => Number(t) / 1e8;

export function NetworkPanel({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const n = useNetwork();
  const jobs = useJobs();
  const c = useQuery({ queryKey: ["canaries"], queryFn: () => getJson<CanaryStats>("/v1/canaries"), refetchInterval: 30_000 });
  const ops = n.data?.operators ?? [];
  const maxStake = Math.max(1, ...ops.map((o) => hb(o.free) + hb(o.locked)));
  const staked = ops.reduce((s, o) => s + hb(o.free) + hb(o.locked), 0);
  const locked = ops.reduce((s, o) => s + hb(o.locked), 0);

  return (
    <aside className="side">
      <section className="panel">
        <header className="panel-head"><h2>Network</h2><span className="mono dim">{ops.length} operators</span></header>
        <div className="stats">
          <div><span>{staked.toFixed(1)}</span><small>HBAR staked</small></div>
          <div><span>{locked.toFixed(2)}</span><small>locked in bonds</small></div>
          <div><span>{n.data ? hb(n.data.pools.auditPool).toFixed(2) : "-"}</span><small>audit pool</small></div>
          <div><span>{n.data ? hb(n.data.pools.slashPool).toFixed(2) : "-"}</span><small>slashed</small></div>
        </div>
        <ul className="ops">
          {ops.map((o) => {
            const f = hb(o.free);
            const l = hb(o.locked);
            return (
              <li key={o.address}>
                <span className="mono">{short(o.address)}</span>
                <div className="bar" title={`${f.toFixed(2)} free · ${l.toFixed(2)} locked`}>
                  <i className="free" style={{ width: `${(f / maxStake) * 100}%` }} />
                  <i className="locked" style={{ width: `${(l / maxStake) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {c.data?.enabled && (
          <div className="canary-row">
            <span className="eyebrow-sm">Canary accuracy</span>
            <span>Speech {pct(c.data.asr?.passRate)} <small className="dim">({c.data.asr?.runs ?? 0})</small></span>
            <span>OCR {pct(c.data.ocr?.passRate)} <small className="dim">({c.data.ocr?.runs ?? 0})</small></span>
          </div>
        )}
      </section>

      <section className="panel feed">
        <header className="panel-head"><h2>Live jobs</h2><span className="live-dot" /></header>
        <ul>
          {(jobs.data ?? []).map((j) => (
            <li key={j.jobId}>
              <button className={j.jobId === selected ? "is-on" : ""} onClick={() => onSelect(j.jobId)}>
                <span className={`st st-${j.final ? (j.status === "Refunded" ? "bad" : "ok") : "live"}`} />
                <span className="feed-task">{j.task === "asr" ? "Speech" : "OCR"}</span>
                <span className="mono dim">{short(j.jobId)}</span>
                <span className="feed-status">{j.status === "Challenge" ? "Challenge window" : j.status}</span>
              </button>
            </li>
          ))}
          {jobs.data?.length === 0 && <li className="dim small pad">No jobs yet.</li>}
        </ul>
      </section>

      {(n.data?.slashes.length ?? 0) > 0 && (
        <section className="panel">
          <header className="panel-head"><h2>Slashes</h2></header>
          <ul className="slashes">
            {n.data!.slashes.slice(0, 6).map((s, i) => (
              <li key={i}>
                <span className="mono">{short(s.who)}</span>
                <span className="dim">{SLASH_REASON[s.reason] ?? s.reason}</span>
                <span className="mono">{tinybarToHbar(s.amount)}</span>
                {s.link && <a href={s.link} target="_blank" rel="noreferrer">tx</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
