import { useQuery } from "@tanstack/react-query";
import { getJson, short, SLASH_REASON, tinybarToHbar, type NetworkView } from "../api";

export function NetworkPage() {
  const q = useQuery({ queryKey: ["network"], queryFn: () => getJson<NetworkView>("/v1/network"), refetchInterval: 10_000 });
  if (q.isLoading) return <p className="muted">Loading...</p>;
  if (q.error || !q.data) return <p className="bad">{String(q.error)}</p>;
  const n = q.data;
  return (
    <div className="stack">
      <h2>Network</h2>
      <div className="grid2">
        <div className="card">
          <h3>Tasks</h3>
          <table className="small">
            <thead><tr><th>Task</th><th>Price</th><th>Bond</th><th>Class</th><th /></tr></thead>
            <tbody>
              {n.tasks.map((t) => (
                <tr key={t.task}>
                  <td>{t.task} <span className="muted">{t.modelKey}</span></td>
                  <td>{tinybarToHbar(t.priceTinybar)}</td>
                  <td>{tinybarToHbar(t.bondTinybar)}</td>
                  <td>{t.cls === 1 ? `TOLERANCE (tau ${t.tauBps} bps)` : "EXACT"}</td>
                  <td>{t.available ? <span className="ok">available</span> : <span className="bad">no capacity</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Pools</h3>
          <dl>
            {Object.entries(n.pools).map(([k, v]) => (
              <span key={k}><dt>{k}</dt><dd>{tinybarToHbar(v)}</dd></span>
            ))}
            <span><dt>audit rate</dt><dd>{Number(n.params.auditBps) / 100}%</dd></span>
            <span><dt>committee size</dt><dd>{n.params.committeeSize}{Number(n.params.committeeSize) === 1 ? <span className="warn"> (single tie-breaker: not Byzantine-safe)</span> : ""}</dd></span>
          </dl>
        </div>
      </div>
      <div className="card">
        <h3>Operators ({n.operators.length})</h3>
        <table className="small">
          <thead><tr><th>Address</th><th>Free stake</th><th>Locked in bonds</th></tr></thead>
          <tbody>
            {n.operators.map((o) => (
              <tr key={o.address}><td className="mono">{o.address}</td><td>{tinybarToHbar(o.free)}</td><td>{tinybarToHbar(o.locked)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Recent slashes and penalties</h3>
        {n.slashes.length === 0 ? <p className="muted">None.</p> : (
          <table className="small">
            <tbody>
              {n.slashes.map((s, i) => (
                <tr key={i}><td className="mono">{short(s.who)}</td><td>{SLASH_REASON[s.reason] ?? s.reason}</td><td>{tinybarToHbar(s.amount)}</td><td>{s.link ? <a href={s.link} target="_blank" rel="noreferrer">tx</a> : ""}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
