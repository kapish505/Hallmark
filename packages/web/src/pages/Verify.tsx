export function VerifyPage({ jobId }: { jobId: string }) {
  const id = jobId || "<jobId>";
  return (
    <div className="stack narrow">
      <h2>Verify a job yourself</h2>
      <p>
        The verifier re-derives the outcome from public data only: it re-reads every event from its transaction receipt, downloads the audio and
        the evidence bundle, recomputes normalization and overlap, and re-checks the 0G TEE signature against the provider’s on-chain signer.
      </p>
      <pre>{`git clone <repo> && cd hallmark && pnpm install
export HALLMARK_ADDRESS=... ARBITRATION_ADDRESS=... JUDGE_ADDRESS=... REGISTRY_ADDRESS=...
export GATEWAY_URL=...
pnpm verify ${id}`}</pre>
      <p className="small muted">Each check prints PASS, FAIL or SKIP (not applicable, or not verifiable — e.g. an unattested result).</p>
    </div>
  );
}
