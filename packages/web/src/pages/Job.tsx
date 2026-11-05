import { useEffect, useState } from "react";
import { GATEWAY, getJson, short, tinybarToHbar, type JobView } from "../api";
import { Badge, Mark } from "../Badge";
import { useQuery } from "@tanstack/react-query";
import type { TierRow } from "../api";

const STEPS = ["Paid", "Assigned", "Revealing", "ChallengeWindow", "Arbitration", "Settled", "Refunded"];
const SEED = ["Hedera PRNG", "prevrandao", "weak fallback"];

export function JobPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setJob(null);
    setErr(null);
    const es = new EventSource(`${GATEWAY}/v1/jobs/${jobId}/events`);
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.job) setJob(d.job);
    };
    es.onerror = () => setErr("live stream interrupted; retrying…");
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    if (!job) return;
    fetch(`${GATEWAY}/v1/jobs/${jobId}/result`)
      .then(async (r) => setResult({ httpStatus: r.status, ...(await r.json()) }))
      .catch(() => undefined);
  }, [job?.status, jobId]);

  if (!jobId) return <p className="muted">Enter a job id, or run one from “Try it”.</p>;
  if (!job) return <p className="muted">{err ?? "Loading…"}</p>;
  const slashed = job.events.some((e) => e.name === "Slashed" && Number(e.args.reason) === 3);
  const reached = new Set(["Paid", ...job.events.map((e) => (e.name === "JobCreated" ? "Assigned" : e.name === "RevealOpened" ? "Revealing" : e.name === "Challenged" ? "Arbitration" : e.name === "JobSettled" ? "Settled" : e.name === "JobRefunded" ? "Refunded" : "")), job.status]);

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="mono">{short(job.jobId)}</h2>
        <div className="row">
          <span className="badge muted" title="assurance tier the buyer paid for">{job.tier}</span>
          <Badge level={job.verificationLevel} />
          <Mark status={job.status} slashed={slashed} />
        </div>
      </div>
      <ol className="timeline">
        {STEPS.filter((s) => s !== "Refunded" || reached.has("Refunded")).map((s) => (
          <li key={s} className={reached.has(s) ? "done" : job.status === s ? "now" : ""}>
            {s === "ChallengeWindow" ? "Challenge window" : s}
          </li>
        ))}
      </ol>
      <section className="card">
        <h3>Result</h3>
        {result?.transcript ? (
          <>
            <p className="transcript">“{String(result.transcript)}”</p>
            <p className="muted">{result.final ? "Final." : "Provisional — bond-backed, challenge window open."}</p>
          </>
        ) : (
          <p className="muted">{job.status === "Refunded" || job.payment.status === "Rejected" ? "No accepted transcript. The buyer was refunded." : "Not available yet."}</p>
        )}
      </section>
      <section className="grid2">
        <div className="card">
          <h3>Payment (x402 on Hedera)</h3>
          <dl>
            <dt>Status</dt>
            <dd>{job.payment.status}</dd>
            <dt>Payer</dt>
            <dd className="mono">{job.payment.payer ?? "—"}</dd>
            <dt>Settlement</dt>
            <dd>{job.payment.settleLink ? <a href={job.payment.settleLink} target="_blank" rel="noreferrer">{job.payment.settleTx}</a> : "—"}</dd>
            {job.payment.refundLink && (
              <>
                <dt>Refund</dt>
                <dd>
                  <a href={job.payment.refundLink} target="_blank" rel="noreferrer">{job.payment.refundTx}</a>
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="card">
          <h3>Job</h3>
          <dl>
            <dt>Fee / bond per seat</dt>
            <dd>
              {tinybarToHbar(job.fee)} / {tinybarToHbar(job.bond)}
            </dd>
            <dt>Committee</dt>
            <dd className="mono">{job.committee.map(short).join(", ") || "—"}</dd>
            <dt>Randomness</dt>
            <dd>{job.seedSource === null ? "—" : SEED[job.seedSource]}</dd>
            <dt>Input availability</dt>
            <dd>{job.availability === "gateway-hosted" ? "gateway-hosted (0G Storage not used)" : job.availability}</dd>
            <dt>Audited / arbitrated</dt>
            <dd>
              {job.audited ? "audited" : "—"} / {job.arbitrated ? "yes" : "no"}
            </dd>
          </dl>
        </div>
      </section>
      <Equalisation current={job.tier} />
      <section className="card">
        <h3>On-chain events</h3>
        <table>
          <tbody>
            {job.events.map((e, i) => (
              <tr key={i}>
                <td>{e.name}</td>
                <td className="mono small">{summarize(e)}</td>
                <td>{e.link ? <a href={e.link} target="_blank" rel="noreferrer">tx</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Security-equalisation table (Addendum A §1.7): cheaper tiers pay for weaker audits with bigger bonds. */
function Equalisation({ current }: { current: string }) {
  const q = useQuery({ queryKey: ["network"], queryFn: () => getJson<{ tiers: TierRow[]; params: Record<string, string> }>("/v1/network") });
  if (!q.data) return null;
  const cMax = Number(q.data.params.cMax ?? 0);
  const share = Number(q.data.params.baseMinerFee ?? 0) / 2;
  return (
    <section className="card">
      <h3>Security equalisation</h3>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Price</th>
            <th>Audit rate</th>
            <th>Bond / seat</th>
            <th>bond + share ≥ cMax / audit rate</th>
          </tr>
        </thead>
        <tbody>
          {q.data.tiers.map((t) => {
            const need = cMax / (t.auditBps / 10000);
            const holds = Number(t.bond) + share >= need - 1;
            return (
              <tr key={t.name} className={t.name === current ? "now" : ""}>
                <td>{t.name}</td>
                <td>{tinybarToHbar(t.priceTinybar)}</td>
                <td>{t.auditBps / 100}%</td>
                <td>{t.available ? tinybarToHbar(t.bond) : "disabled (bond > max)"}</td>
                <td className={holds ? "ok" : "bad"}>
                  {tinybarToHbar(Number(t.bond) + share)} ≥ {tinybarToHbar(Math.ceil(need))} {holds ? "✓" : "✗"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">Every tier faces the same cheating inequality against a colluding pair; cMax is {q.data.params.cMax ? tinybarToHbar(q.data.params.cMax) : "—"} (on-chain parameter).</p>
    </section>
  );
}

function summarize(e: { name: string; args: Record<string, unknown> }) {
  const a = e.args;
  switch (e.name) {
    case "Revealed":
      return `${short(String(a.miner))}: “${a.output}”`;
    case "SeatJudged":
      return `${short(String(a.miner))}: overlap ${a.overlapBps} bps → ${a.ok ? "paid" : "slashed"}`;
    case "Slashed":
      return `${short(String(a.miner))}: −${tinybarToHbar(String(a.amount))} (${["", "no commit", "no reveal", "wrong output"][Number(a.reason)]})`;
    case "BuyerRefunded":
      return `${tinybarToHbar(String(a.amount))} to buyer`;
    case "EvidenceAccepted":
      return `evidence ${short(String(a.evidenceRoot))}`;
    default:
      return "";
  }
}
