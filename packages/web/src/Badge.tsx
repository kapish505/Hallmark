const TONE: Record<string, { tone: string; help: string }> = {
  pending: { tone: "muted", help: "Waiting for operators." },
  "provisional (unaudited, bond-backed)": { tone: "warn", help: "Not re-run. The executor's bond backs it and anyone may challenge during the window." },
  "audited (re-run agreed)": { tone: "ok", help: "A randomly drawn verifier re-ran the job blind and agreed." },
  disputed: { tone: "warn", help: "Executor and verifier disagreed; a committee is re-running the job." },
  slashed: { tone: "bad", help: "The committee found the executor's output wrong: its bond was slashed and you were refunded." },
  refunded: { tone: "bad", help: "No accepted result (timeout or inconclusive); you were refunded in full." },
  "audit skipped": { tone: "warn", help: "The job was drawn for audit but no verifier showed up twice; it settled unaudited." },
};

export function Badge({ badge }: { badge: string }) {
  const b = TONE[badge] ?? { tone: "muted", help: "" };
  return (
    <span className={`badge ${b.tone}`} title={b.help}>
      {badge}
    </span>
  );
}
