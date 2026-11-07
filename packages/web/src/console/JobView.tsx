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
  Voided: "Voided: input missing",
};


type Ev = Job["events"][number];
const last = (evs: Ev[], name: string) => [...evs].reverse().find((e) => e.name === name);

/** The audit, stated only as far as it has actually happened on chain. */
function rerunState(j: Job, evs: Ev[]): { v: string; tone: "ok" | "wait" | "bad" | "dim"; reproduced: boolean } {
  const resolved = last(evs, "Resolved");
  const compared = last(evs, "Compared");
  const drawn = last(evs, "AuditDrawn");
  if (resolved) {
    const o = Number(resolved.args.outcome);
    if (o === 3) return { v: "The re-run disagreed and the committee confirmed the executor was wrong", tone: "bad", reproduced: false };
    if (o === 2) return { v: "The re-run disagreed, but the committee sided with the executor", tone: "ok", reproduced: true };
    if (o === 4) return { v: "The committee found both answers consistent with the pinned model", tone: "ok", reproduced: true };
    return { v: "The committee could not decide; you were refunded and nobody was slashed for being wrong", tone: "dim", reproduced: false };
  }
  if (compared) {
    if (String(compared.args.agree) === "true") return { v: "An independent operator re-ran it blind and got the same answer", tone: "ok", reproduced: true };
    return { v: "The re-run disagreed; a committee is re-running it now", tone: "wait", reproduced: false };
  }
  if (j.auditSkipped) return { v: "Drawn for a re-run, but no verifier showed up (penalized). Not checked", tone: "dim", reproduced: false };
  if (evs.some((e) => e.name === "VerifierAssigned")) return { v: "Drawn for a re-run: a second operator is re-running it blind (not compared yet)", tone: "wait", reproduced: false };
  if (drawn)
    return String(drawn.args.audited) === "true"
      ? { v: "Drawn for a re-run; waiting for a verifier", tone: "wait", reproduced: false }
      : { v: "Not drawn for a re-run this time. Open to challenge until it settles", tone: "dim", reproduced: false };
  return { v: "The random re-run draw happens after the executor commits", tone: "wait", reproduced: false };
}

/** What this receipt proves, in plain words. Every line follows on-chain events that already happened. */
function Guarantee({ j }: { j: Job }) {
  const evs = j.events;
  const ev = new Set(evs.map((e) => e.name));
  const slashedWrong = evs.some((e) => e.name === "Slashed" && String(e.args.reason) === "4" && String(e.args.who).toLowerCase() === (j.executor ?? "").toLowerCase());
  const refunded = j.status === "Refunded" || j.status === "Voided";
  const bond = j.bond ? tinybarToHbar(j.bond) : "—";
  const rr = rerunState(j, evs);
  const rows: Array<{ k: string; v: string; tone: "ok" | "wait" | "bad" | "dim" }> = [
    { k: "Paid", v: j.payment.settleTx ? "Settled on Hedera" : "Waiting for settlement", tone: j.payment.settleTx ? "ok" : "wait" },
    {
      k: "Committed",
      v: ev.has("Committed") ? "The executor sealed its answer from the pinned model" : "The executor has not committed yet",
      tone: ev.has("Committed") ? "ok" : "wait",
    },
    { k: "Re-run", v: rr.v, tone: rr.tone },
    {
      k: "At stake",
      v: slashedWrong ? "The executor's bond was slashed" : `${bond} operator bond, lost if the answer is proven wrong`,
      tone: slashedWrong ? "bad" : ev.has("JobCreated") ? "ok" : "wait",
    },
    {
      k: "Recourse",
      v: refunded ? "You were refunded" : j.final ? "Settled: no dispute succeeded" : "Full refund if the answer is proven wrong",
      tone: refunded || j.final ? "ok" : "wait",
    },
  ];
  const headline = refunded
    ? "This answer did not hold up. You got your money back."
    : rr.reproduced && j.final
      ? "Reproduced by an independent operator."
      : rr.reproduced
        ? "Reproduced by an independent operator; settling."
        : j.final
          ? j.auditSkipped
            ? "Bond-backed. The re-run did not happen."
            : "Bond-backed and unchallenged. Not re-run."
          : "Being checked.";
  return (
    <div className="guarantee">
      <div className="g-head">
        <span className="eyebrow-sm">What this receipt proves</span>
        <strong>{headline}</strong>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.k} className={`g-${r.tone}`}>
            <i />
            <span className="g-k">{r.k}</span>
            <span className="g-v">{r.v}</span>
          </li>
        ))}
      </ul>
      <p className="g-foot dim">Verified means honest operators ran the pinned model. It does not make the model right on inputs it cannot read.</p>
    </div>
  );
}

/** consensus time of an event (Mirror Node position "seconds.nanos"), or null on other chains */
const tsOf = (e: Ev) => (/^\d+\.\d+$/.test(e.position ?? "") ? Number(e.position) : null);
const actorOf = (e: Ev): [string, string] | null => {
  const a = e.args as Record<string, unknown>;
  if (e.name === "JobCreated") return ["buyer", String(a.buyer)];
  if (e.name === "Paid") return ["to", String(a.to)];
  if (e.name === "VerifierAssigned") return ["verifier", String(a.verifier)];
  if (e.name === "Challenged") return ["challenger", String(a.challenger)];
  if (e.name === "InputMissing") return ["reporter", String(a.reporter)];
  if (e.name === "JobRefunded") return ["buyer", String(a.buyer)];
  if (a.who) return ["by", String(a.who)];
  return null;
};
const EVENT_COPY: Record<string, string> = {
  JobCreated: "Job created, executor drawn",
  Committed: "Answer sealed",
  AuditDrawn: "Re-run draw",
  VerifierAssigned: "Verifier drawn",
  Revealed: "Answer revealed",
  Compared: "Answers compared",
  TextPosted: "Text posted",
  CommitteeDrawn: "Committee drawn",
  Resolved: "Committee decided",
  Challenged: "Challenged",
  Slashed: "Slashed",
  Paid: "Paid",
  JobSettled: "Settled",
  JobRefunded: "Refunded",
  InputMissing: "Input reported missing",
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
          <h2>Paid is not the same as done</h2>
          <p className="dim">
            x402 proves money moved. Every job here also ends with a receipt: which model ran, whether an independent operator reproduced the
            answer, and what the operator loses if it was wrong.
          </p>
          <p className="dim">Pay for a job on the left, or pick one from the live feed.</p>
        </div>
      </section>
    );
  if (q.isLoading) return <section className="panel job empty-state"><p className="dim">Loading job…</p></section>;
  if (!q.data) return <section className="panel job empty-state"><p className="bad">Job not found.</p></section>;

  const j = q.data;
  const ev = new Set(j.events.map((e) => e.name));
  const times = j.events.map(tsOf).filter((x): x is number => x !== null);
  const t0 = times.length ? Math.min(...times) : null;
  const tEnd = times.length ? Math.max(...times) : null;
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
        <span className={`dot ${j.final ? (j.status === "Refunded" || j.status === "Voided" ? "bad" : "ok") : "live"}`} />
        <span>{statusText}</span>
        {left !== null && left > 0 && <span className="mono dim">· {left}s left in this stage</span>}
        {j.final && t0 !== null && tEnd !== null && <span className="mono dim">· final {Math.round(tEnd - t0)}s after creation</span>}
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

      <Guarantee j={j} />

      <div className="result">
        <div className="result-head">
          <span className="eyebrow-sm">Result{j.final ? "" : " (provisional)"}</span>
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
                  Validator {r.data.validator} (advisory): <b className={r.data.validated === "pass" ? "ok" : r.data.validated === "fail" ? "warn" : ""}>{r.data.validated}</b>
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="dim">
            {r.data?.error === "refunded"
              ? "This job was refunded, so no result is released. The full price went back to your wallet."
              : (r.data?.error ?? "Waiting for the executor's answer…")}
          </p>
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
          {j.events.filter((e) => e.name !== "StatusChanged").map((e, i) => {
            const ts = tsOf(e);
            const actor = actorOf(e);
            return (
              <li key={i}>
                <span className="ev-time mono dim">
                  {ts !== null ? new Date(ts * 1000).toLocaleTimeString([], { hour12: false }) : "—"}
                  {ts !== null && t0 !== null && <small> +{(ts - t0).toFixed(1)}s</small>}
                </span>
                <span className="ev-name">
                  {EVENT_COPY[e.name] ?? e.name}
                  {e.name === "AuditDrawn" && <em className="dim"> → {String(e.args.audited) === "true" ? "drawn for re-run" : "not drawn"}</em>}
                  {e.name === "Compared" && <em className={String(e.args.agree) === "true" ? "ok" : "bad"}> {String(e.args.agree) === "true" ? "agree" : "differ"}</em>}
                  {e.name === "Slashed" && <em className="bad"> {SLASH_REASON[String(e.args.reason)]} · {tinybarToHbar(String(e.args.amount))}</em>}
                  {e.name === "Paid" && <em className="dim"> {tinybarToHbar(String(e.args.amount))}</em>}
                </span>
                <span className="ev-actor mono dim">{actor ? `${actor[0]} ${short(actor[1])}` : ""}</span>
                {e.link ? <a href={e.link} target="_blank" rel="noreferrer">HashScan</a> : <span />}
              </li>
            );
          })}
          {j.payment.refundLink && <li><span>Refund</span><a href={j.payment.refundLink} target="_blank" rel="noreferrer">HashScan</a></li>}
        </ul>
      </div>

      <div className="verify-line">
        <span className="eyebrow-sm">Verify it yourself</span>
        <code className="mono">pnpm verify {j.jobId}</code>
        <p className="dim small">
          Re-derives the draw, the commitments, the comparison and the payout from public Hedera data alone: no token, no trust in this gateway.
          The buyer can add <code>--token</code> (the private result key from the payment) to also check the delivered text against the commitment.
        </p>
      </div>
    </section>
  );
}
