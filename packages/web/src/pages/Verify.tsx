export function VerifyPage({ jobId }: { jobId: string }) {
  const id = jobId || "<jobId>";
  return (
    <div className="stack narrow">
      <h2>Verify a job yourself</h2>
      <p>
        The verifier re-derives the verdict from public data: it re-reads every event from its transaction receipt, re-hashes the input and every
        revealed output, re-checks normalization, recomputes the executor/verifier comparison and the committee majority, and checks that money moved
        accordingly and that the contract balance equals its liabilities.
      </p>
      <pre>{`git clone <repo> && cd hallmark && pnpm install
export HALLMARK_ADDRESS=... JUDGE_ADDRESS=... REGISTRY_ADDRESS=... GATEWAY_URL=...
pnpm verify ${id}`}</pre>
      <p className="small muted">The gateway is used only to learn transaction hashes and to fetch blobs by hash; every value is re-checked locally.</p>
    </div>
  );
}
