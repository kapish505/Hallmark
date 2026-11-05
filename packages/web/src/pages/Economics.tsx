import { useEffect, useMemo, useState } from "react";
import { ILLUSTRATIVE, ILLUSTRATIVE_TIERS, summarize, tierTable, type Inputs } from "@hallmark/simulator";

const MEASUREMENTS_URL = import.meta.env.VITE_MEASUREMENTS_URL as string | undefined;

function Slider(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label className="slider">
      <span>
        {p.label}: <strong>{p.value}</strong>
        {p.unit ?? ""} <em className="tag">assumed</em>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

export function EconomicsPage() {
  const [fee, setFee] = useState(ILLUSTRATIVE.fee.value);
  const [costPct, setCostPct] = useState(30);
  const [audit, setAudit] = useState(ILLUSTRATIVE.auditRate.value * 100);
  const [bondMult, setBondMult] = useState(ILLUSTRATIVE.bondMultiple.value);
  const [challenge, setChallenge] = useState(0);
  const [cMax, setCMax] = useState(ILLUSTRATIVE_TIERS.cMax.value);
  const [measured, setMeasured] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!MEASUREMENTS_URL) return;
    fetch(MEASUREMENTS_URL).then((r) => r.json()).then(setMeasured).catch(() => setMeasured(null));
  }, []);

  const inputs: Inputs = useMemo(() => {
    const share = (fee * (1 - 0.15)) / 2;
    return {
      ...ILLUSTRATIVE,
      fee: { value: fee, source: "assumed" },
      computeCost: { value: (share * costPct) / 100, source: "assumed" },
      auditRate: { value: audit / 100, source: "assumed" },
      bondMultiple: { value: bondMult, source: "assumed" },
    };
  }, [fee, costPct, audit, bondMult]);
  const s = summarize(inputs, challenge / 100);
  const f = (x: number) => x.toFixed(4);

  return (
    <div className="stack">
      <h2>Economics</h2>
      <p className="muted">
        Calculator from build prompt §11. Every slider value is <em>assumed</em>. Measured figures (from real testnet runs) appear separately below
        and are never mixed into the calculator silently.
      </p>
      <div className="grid2">
        <section className="card">
          <Slider label="Fee per job" value={fee} min={0.01} max={2} step={0.01} unit=" HBAR" onChange={setFee} />
          <Slider label="Compute cost (% of one miner’s share)" value={costPct} min={0} max={100} step={1} unit="%" onChange={setCostPct} />
          <Slider label="Random audit rate" value={audit} min={0} max={100} step={1} unit="%" onChange={setAudit} />
          <Slider label="Bond multiple" value={bondMult} min={1} max={20} step={0.5} unit="× fee" onChange={setBondMult} />
          <Slider label="Challenge probability (collusion)" value={challenge} min={0} max={100} step={1} unit="%" onChange={setChallenge} />
        </section>
        <section className="card">
          <dl>
            <dt>Miner share per job</dt>
            <dd>{f(s.minerShareHbar)} HBAR</dd>
            <dt>Bond per seat</dt>
            <dd>{f(s.bondHbar)} HBAR</dd>
            <dt>Honest profit per job</dt>
            <dd>{f(s.honestProfitHbar)} HBAR</dd>
            <dt>Cheat vs honest (honest partner)</dt>
            <dd className={s.cheatAdvantageHbar.honestPartner < 0 ? "ok" : "bad"}>{f(s.cheatAdvantageHbar.honestPartner)} HBAR</dd>
            <dt>Cheat vs honest (colluding pair)</dt>
            <dd className={s.cheatAdvantageHbar.collusion < 0 ? "ok" : "bad"}>{f(s.cheatAdvantageHbar.collusion)} HBAR</dd>
            <dt>Detection (collusion)</dt>
            <dd>{(s.detection.collusion * 100).toFixed(1)}%</dd>
            <dt>Minimum safe bond (collusion)</dt>
            <dd>{Number.isFinite(s.minimumSafeBondHbar.collusion) ? `${f(s.minimumSafeBondHbar.collusion)} HBAR` : "∞ (no detection)"}</dd>
            <dt>Useful-compute share</dt>
            <dd>{(s.usefulComputeShare * 100).toFixed(1)}%</dd>
          </dl>
          <p className="small muted">Negative “cheat vs honest” means cheating loses money under these assumptions.</p>
        </section>
      </div>
      <section className="card">
        <h3>Assurance tiers: bond needed per tier</h3>
        <Slider label="cMax (honest compute cost upper bound)" value={cMax} min={0.01} max={0.099} step={0.001} unit=" HBAR" onChange={setCMax} />
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Audit</th>
              <th>Price</th>
              <th>Bond / seat</th>
              <th>Equalised?</th>
            </tr>
          </thead>
          <tbody>
            {tierTable({ ...ILLUSTRATIVE_TIERS, cMax: { value: cMax, source: "assumed" } }).map((r) => (
              <tr key={r.tier}>
                <td>{r.tier}</td>
                <td>{r.auditBps / 100}%</td>
                <td>{r.price.toFixed(4)} HBAR</td>
                <td>{r.available ? `${r.bond.toFixed(4)} HBAR` : "disabled (bond > max)"}</td>
                <td className={r.holds ? "ok" : "bad"}>{r.holds ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          A lower audit rate needs a larger bond, so every tier faces the same cheating inequality. Base miner fee 0.2 HBAR (assumed) caps cMax below
          0.1 HBAR: honest miners must profit.
        </p>
      </section>
      <section className="card">
        <h3>
          Measured <em className="tag ok">measured</em>
        </h3>
        {measured ? <pre className="small">{JSON.stringify(measured, null, 2)}</pre> : <p className="muted">No measurements loaded yet (set VITE_MEASUREMENTS_URL after running scripts/measure.ts).</p>}
      </section>
    </div>
  );
}
