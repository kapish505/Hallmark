import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../Badge";
import { GATEWAY, getJson, short, SLASH_REASON, tinybarToHbar, type JobView } from "../api";

const STEPS: Array<{ key: string; label: string; done: (j: JobView, ev: Set<string>) => boolean }> = [
  { key: "paid", label: "Paid (x402)", done: (j) => !!j.payment.settleTx },
  { key: "created", label: "Executor drawn", done: (_j, e) => e.has("JobCreated") },
  { key: "commit", label: "Executor committed", done: (_j, e) => e.has("Committed") },
  { key: "draw", label: "Audit drawn", done: (_j, e) => e.has("AuditDrawn") },
  { key: "verify", label: "Verifier re-ran (blind)", done: (j, e) => !!j.verifier && e.has("VerifierAssigned") },
  { key: "reveal", label: "Revealed", done: (_j, e) => e.has("Revealed") },
  { key: "committee", label: "Committee", done: (_j, e) => e.has("CommitteeDrawn") },
  { key: "end", label: "Settled / refunded", done: (j) => j.final },
];

export function JobPage({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const valid = /^0x[0-9a-fA-F]{64}$/.test(jobId);
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => getJson<JobView>(`/v1/jobs/${jobId}`), enabled: valid, refetchInterval: 5000 });
  const result = useQuery({ queryKey: ["result", jobId], queryFn: () => getJson<{ text?: string; provisional?: boolean; error?: string }>(`/v1/jobs/${jobId}/result`), enabled: valid, refetchInterval: 5000 });
  useEffect(() => {
    if (!valid || !GATEWAY) return;
    const es = new EventSource(`${GATEWAY}/v1/jobs/${jobId}/events`);
    es.addEventListener("chain", () => {
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["result", jobId] });
    });
    return () => es.close();
  }, [jobId, valid, qc]);

  if (!valid) return <p className="muted">Enter a job id.</p>;
  if (job.isLoading) return <p className="muted">Loading...</p>;
  if (job.error || !job.data) return <p className="bad">{String(job.error ?? "unknown job")}</p>;
  const j = job.data;
  const ev = new Set(j.events.map((e) => e.name));
  const firstOpen = STEPS.findIndex((s) => !s.done(j, ev));
  return (
    <div className="stack">
      <div className="row between wrap">
        <h2>
          {j.task.toUpperCase()} job <span className="mono small">{short(j.jobId)}</span>
        </h2>
        <Badge badge={j.badge} />
      </div>
      <ul className="timeline">
        {STEPS.map((s, i) => (
          <li key={s.key} className={s.done(j, ev) ? "done" : i === firstOpen ? "now" : ""}>
            {s.label}
          </li>
        ))}
      </ul>
      <div className="card">
        <h3>Result</h3>
        {result.data?.text !== undefined ? (
          <>
            <p className="transcript">"{result.data.text}"</p>
            <p className="small muted">{result.data.provisional ? "Provisional: the challenge window or the audit is still open." : "Final."} Shows fidelity to the pinned model, not that the text is true.</p>
          </>
        ) : (
          <p className="muted">{result.data?.error ?? "Not available yet."}</p>
        )}
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Parties</h3>
          <dl>
            <span><dt>Executor</dt><dd className="mono">{short(j.executor)}</dd></span>
            <span><dt>Verifier</dt><dd className="mono">{j.verifier && !/^0x0+$/.test(j.verifier) ? short(j.verifier) : "not audited"}</dd></span>
            <span><dt>Committee</dt><dd className="mono">{j.committee.length ? j.committee.map(short).join(", ") : "-"}</dd></span>
            <span><dt>Bond (each)</dt><dd>{tinybarToHbar(j.bond)}</dd></span>
            <span><dt>Challenged</dt><dd>{j.challenged ? "yes" : "no"}</dd></span>
          </dl>
        </div>
        <div className="card">
          <h3>Payment</h3>
          <dl>
            <span><dt>Price</dt><dd>{tinybarToHbar(j.price)}</dd></span>
            <span><dt>Status</dt><dd>{j.payment.status}</dd></span>
            <span><dt>x402 settlement</dt><dd>{j.payment.settleLink ? <a href={j.payment.settleLink} target="_blank" rel="noreferrer">HashScan</a> : "-"}</dd></span>
            <span><dt>Refund</dt><dd>{j.payment.refundLink ? <a href={j.payment.refundLink} target="_blank" rel="noreferrer">HashScan</a> : "-"}</dd></span>
            <span><dt>Input hash</dt><dd className="mono small">{j.inputHash}</dd></span>
          </dl>
        </div>
      </div>
      <div className="card">
        <h3>On-chain events</h3>
        <table className="small">
          <tbody>
            {j.events.map((e, i) => (
              <tr key={i}>
                <td>{e.name}</td>
                <td className="mono">{e.name === "Slashed" ? `${short(String(e.args.who))} ${SLASH_REASON[String(e.args.reason)] ?? ""} ${tinybarToHbar(String(e.args.amount))}` : ""}</td>
                <td>{e.link ? <a href={e.link} target="_blank" rel="noreferrer">tx</a> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
