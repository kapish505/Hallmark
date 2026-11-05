import { useQuery } from "@tanstack/react-query";
import { getJson, short, tinybarToHbar } from "../api";

interface Net {
  miners: Array<{ address: string; free: string; locked: string; jobs: number; slashes: number }>;
  params: Record<string, string>;
  paramsVersion: number;
  pools: Record<string, string>;
  arbiters: string[];
  threshold: number;
}

export function NetworkPage() {
  const q = useQuery({ queryKey: ["network"], queryFn: () => getJson<Net>("/v1/network"), refetchInterval: 5000 });
  if (q.error) return <p className="bad">{String(q.error)}</p>;
  if (!q.data) return <p className="muted">Loading…</p>;
  const n = q.data;
  return (
    <div className="stack">
      <h2>Network</h2>
      <section className="card">
        <h3>Miners</h3>
        <table>
          <thead>
            <tr>
              <th>Miner</th>
              <th>Free stake</th>
              <th>Locked (bonds)</th>
              <th>Jobs</th>
              <th>Slashes</th>
            </tr>
          </thead>
          <tbody>
            {n.miners.map((m) => (
              <tr key={m.address}>
                <td className="mono">{short(m.address)}</td>
                <td>{tinybarToHbar(m.free)}</td>
                <td>{tinybarToHbar(m.locked)}</td>
                <td>{m.jobs}</td>
                <td className={m.slashes ? "bad" : ""}>{m.slashes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="grid2">
        <div className="card">
          <h3>Pools</h3>
          <dl>
            {Object.entries(n.pools).map(([k, v]) => (
              <span key={k}>
                <dt>{k}</dt>
                <dd>{tinybarToHbar(v)}</dd>
              </span>
            ))}
          </dl>
          <p className="small muted">slashPool is the burn equivalent: it never returns to any miner.</p>
        </div>
        <div className="card">
          <h3>Arbiters ({n.threshold}-of-{n.arbiters.length})</h3>
          <ul className="mono">
            {n.arbiters.map((a) => (
              <li key={a}>{short(a)}</li>
            ))}
          </ul>
          <p className="small muted">Run by the team during the hackathon (trust assumption T3).</p>
        </div>
      </section>
      <section className="card">
        <h3>Parameters (version {n.paramsVersion})</h3>
        <dl className="cols">
          {Object.entries(n.params).map(([k, v]) => (
            <span key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </span>
          ))}
        </dl>
      </section>
    </div>
  );
}
