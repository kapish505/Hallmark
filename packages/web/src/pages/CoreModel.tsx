import { useMemo, useState } from "react";
import { analyse, fmtCeiling, parseMeasurements } from "@hallmark/simulator";
import { formatHbar } from "@hallmark/shared";
import md from "../../../simulator/src/measurements.json";

const SWEEP = [500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10_000];

export function CoreModelPage() {
  const m = useMemo(() => parseMeasurements(md as never), []);
  const [p, setP] = useState<number>(m.auditBps.value);
  const minBond = BigInt(Math.round(m.minBond.value));
  return (
    <div className="stack">
      <h2>Core model: the bond window</h2>
      <p className="narrow">
        Deterrence needs <span className="mono">B &ge; c / (p&middot;pi) &minus; F</span> for the worst cheat. Fairness needs <span className="mono">B &le; m / (p&middot;fp)</span>.
        A model is enabled only when the floor is below the ceiling. Inputs marked <i className="tag">assumed</i> are not measurements.
      </p>
      <div className="slider narrow">
        <label>audit rate p = {p / 100}% (compute about {(1 + p / 10_000).toFixed(2)}x plain inference)</label>
        <input type="range" min={100} max={10_000} step={100} value={p} onChange={(e) => setP(Number(e.target.value))} />
      </div>
      {m.tasks.map((t) => {
        const a = analyse(t, p, minBond);
        const rows = SWEEP.map((q) => ({ q, a: analyse(t, q, minBond) }));
        const max = Math.max(...rows.map((r) => Number(r.a.floor)), 1);
        return (
          <div className="card" key={t.task}>
            <div className="row between wrap">
              <h3>{t.task.toUpperCase()} ({t.class.value})</h3>
              <span className={a.allMeasured ? "tag ok" : "tag"}>{a.allMeasured ? "measured" : `inputs: ${a.sources.join(", ")}`}</span>
            </div>
            <dl>
              <span><dt>deterrence floor</dt><dd>{formatHbar(a.floor)} (worst cheat: {a.worst.name})</dd></span>
              <span><dt>fairness ceiling</dt><dd>{fmtCeiling(a.ceiling)}</dd></span>
              <span><dt>window</dt><dd className={a.empty ? "bad" : "ok"}>{a.empty ? "EMPTY: do not enable" : "non-empty"}</dd></span>
            </dl>
            <svg viewBox="0 0 400 140" width="100%" role="img" aria-label="deterrence floor by audit rate">
              {rows.map((r, i) => {
                const h = (Number(r.a.floor) / max) * 110;
                return (
                  <g key={r.q}>
                    <rect x={10 + i * 43} y={120 - h} width={30} height={h} fill={r.a.empty ? "var(--bad)" : "var(--accent)"} opacity={r.q === p ? 1 : 0.55} />
                    <text x={25 + i * 43} y={135} fontSize={10} textAnchor="middle" fill="var(--muted)">{r.q / 100}%</text>
                  </g>
                );
              })}
            </svg>
            <p className="small muted">Bars: deterrence floor at each audit rate (red = window empty). Cheats:</p>
            <table className="small">
              <tbody>
                {t.cheats.map((c) => (
                  <tr key={c.name}><td>{c.name}</td><td>pi {c.piBps.value} bps <i className={c.piBps.source === "measured" ? "tag ok" : "tag"}>{c.piBps.source}</i></td><td>c' {formatHbar(BigInt(Math.round(c.c.value)))} <i className={c.c.source === "measured" ? "tag ok" : "tag"}>{c.c.source}</i></td></tr>
                ))}
                <tr><td>honest false alarms</td><td>fp {t.fpBps.value} bps <i className={t.fpBps.source === "measured" ? "tag ok" : "tag"}>{t.fpBps.source}</i></td><td /></tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
