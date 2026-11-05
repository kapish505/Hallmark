const LABELS: Record<string, { text: string; tone: string; help: string }> = {
  pending: { text: "Pending", tone: "muted", help: "Waiting for miners." },
  "L0-provisional": { text: "L0 · provisional", tone: "warn", help: "Two bonded miners agreed. Challenge window still open." },
  "L0-final": { text: "L0 · final", tone: "ok", help: "Two bonded miners agreed and nobody challenged." },
  disputed: { text: "Disputed", tone: "warn", help: "In arbitration: arbiters are re-running the audio on 0G." },
  "L1-audited": { text: "L1 · audited", tone: "ok", help: "Arbiter committee + off-chain verified 0G TEE signature." },
  unattested: { text: "Unattested", tone: "warn", help: "Arbitrated, but the 0G TEE signature could not be verified." },
  refunded: { text: "Refunded", tone: "bad", help: "No accepted result; the buyer got their money back." },
};

export function Badge({ level }: { level: string }) {
  const l = LABELS[level] ?? { text: level, tone: "muted", help: "" };
  return (
    <span className={`badge ${l.tone}`} title={l.help}>
      {l.text}
    </span>
  );
}

export function Mark({ status, slashed }: { status: string; slashed: boolean }) {
  if (status === "Settled" && !slashed) return <span className="mark ok">Hallmarked</span>;
  if (slashed) return <span className="mark bad">Rejected seat slashed</span>;
  return null;
}
