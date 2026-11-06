import { useState } from "react";
import { Badge } from "../Badge";
import { short, SLASH_REASON, tinybarToHbar, type JobView as Job } from "../api";
import { useCountdown, useJob, useResult } from "./live";

const STEPS: Array<{ label: string; done: (j: Job, ev: Set<string>) => boolean }> = [
  { label: "Paid", done: (j) => !!j.payment.settleTx },
  { label: "Executor drawn", done: (_j, e) => e.has("JobCreated") },
  { label: "Committed", done: (_j, e) => e.has("Committed") },
  { label: "Audit drawn", done: (_j, e) => e.has("AuditDrawn") },
  { label: "Revealed", done: (_j, e) => e.has("Revealed") },
  { label: "Final", done: (j) => j.final },
];

const STATUS_COPY: Record<string, string> = {
  PendingSettlement: "Waiting for the payment to settle",
  Settled: "Payment confirmed, creating the job",
  Assigned: "Executor is running the model",
  Committed: "Drawing the audit",
  VerifierCommit: "Verifier is re-running blind",
  Reveal: "Waiting for reveals",
  Challenge: "Challenge window open",
  Text: "Comparing texts",
  CommitteeCommit: "Committee is re-running",
  CommitteeReveal: "Committee is revealing",
  Settled_final: "Settled",
  Refunded: "Refunded",
};

export function JobView({ id, token }: { id: string; token: string }) {
  const q = useJob(id);
  const r = useResult(id, token);
  const left = useCountdown(q.data?.final ? null : q.data?.deadline);
  const [copied, setCopied] = useState(false);

  if (!id)
    return (
      <section className="panel job empty-state">
        <div>
          <h2>No job selected</h2>
          <p className="dim">Pay for a job on the left, or pick one from the live feed to follow it step by step.</p>
        </div>
      </section>
    );
  if (q.isLoading) return <section className="panel job empty-state"><p className="dim">Loading job…</p></section>;
  if (!q.data) return <section className="panel job empty-state"><p className="bad">Job not found.</p></section>;

  const j = q.data;
  const ev = new Set(j.events.map((e) => e.name));
  const current = STEPS.findIndex((s) => !s.done(j, ev));
  const statusText = j.status === "Settled" ? "Settled" : (STATUS_COPY[j.status] ?? j.status);

  return (
    <section className="panel job">
      <header className="panel-head">
        <div className="job-title">
          <h2>{j.task === "asr" ? "Speech to text" : "Image to text"}</h2>
          <span className="mono dim">{short(j.jobId)}</span>
        </div>
        <Badge badge={j.badge} />
      </header>

      <div className="job-status">
        <span className={`dot ${j.final ? (j.status === "Refunded" ? "bad" : "ok") : "live"}`} />
        <span>{statusText}</span>
        {left !== null && left > 0 && <span className="mono dim">· {left}s left in this stage</span>}
        <span className="mono dim push">{tinybarToHbar(j.price)}</span>
      </div>

      <ol className="steps-track">
        {STEPS.map((s, i) => (
          <li key={s.label} className={s.done(j, ev) ? "done" : i === current ? "now" : ""}>
            <i />
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="result">
        <div className="result-head">
          <span className="eyebrow-sm">Result</span>
          {r.data?.text !== undefined && (
            <button
              className="link-btn"
              onClick={() => {
                void navigator.clipboard.writeText(r.data!.text!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        {!token ? (
          <p className="dim">The result is private to the buyer. Open this job from the payment that created it.</p>
        ) : r.data?.text !== undefined ? (
          <>
            <p className="result-text">{r.data.text}</p>
            <div className="result-meta">
              <span>{r.data.provisional ? "Provisional until the job settles" : "Final"}</span>
              {r.data.accuracy && <span>{r.data.accuracy.label}</span>}
              {r.data.validator && r.data.validator !== "none" && (
                <span>
                  Validator {r.data.validator}: <b className={r.data.validated === "pass" ? "ok" : r.data.validated === "fail" ? "warn" : ""}>{r.data.validated}</b>
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="dim">{r.data?.error ?? "Waiting for the executor's answer…"}</p>
        )}
      </div>

      <div className="parties">
        <div><span className="eyebrow-sm">Executor</span><span className="mono">{short(j.executor)}</span></div>
        <div><span className="eyebrow-sm">Verifier</span><span className="mono">{j.verifier && !/^0x0+$/.test(j.verifier) ? short(j.verifier) : "not audited"}</span></div>
        <div><span className="eyebrow-sm">Committee</span><span className="mono">{j.committee.length ? j.committee.map(short).join(" · ") : "none"}</span></div>
        <div><span className="eyebrow-sm">Bond each</span><span className="mono">{tinybarToHbar(j.bond)}</span></div>
      </div>

      <div className="events">
        <span className="eyebrow-sm">On-chain events</span>
        <ul>
          {j.payment.settleLink && (
            <li><span>Payment settled</span><a href={j.payment.settleLink} target="_blank" rel="noreferrer">HashScan</a></li>
          )}
          {j.events.filter((e) => e.name !== "StatusChanged").map((e, i) => (
            <li key={i}>
              <span>
                {e.name}
                {e.name === "Slashed" && <em className="bad"> {SLASH_REASON[String(e.args.reason)]} · {tinybarToHbar(String(e.args.amount))}</em>}
              </span>
              {e.link && <a href={e.link} target="_blank" rel="noreferrer">HashScan</a>}
            </li>
          ))}
          {j.payment.refundLink && <li><span>Refund</span><a href={j.payment.refundLink} target="_blank" rel="noreferrer">HashScan</a></li>}
        </ul>
      </div>

      <p className="verify-line mono dim">Verify independently: pnpm verify {short(j.jobId)}{token ? " --token …" : ""}</p>
    </section>
  );
}
