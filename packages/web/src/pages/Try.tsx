import { useState } from "react";
import { GATEWAY } from "../api";

export function TryPage({ onJob }: { onJob: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [tier, setTier] = useState<"basic" | "standard" | "assured">("standard");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setMsg("Paying over x402 from the demo account and waiting for miners…");
    try {
      const f = new FormData();
      f.append("audio", file);
      f.append("tier", tier);
      const r = await fetch(`${GATEWAY}/demo/try`, { method: "POST", body: f });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      onJob(body.result.jobId);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack narrow">
      <h2>Try it</h2>
      <p>
        Upload a short English clip (WAV or FLAC, up to 15 s). A <strong>testnet demo account</strong> pays for it over x402 on Hedera, so you
        don’t need a wallet. Two bonded miners transcribe it; you can watch the job settle on chain.
      </p>
      <label className="row wrap">
        Assurance tier:
        {(["basic", "standard", "assured"] as const).map((t) => (
          <button key={t} className={t === tier ? "active" : "ghost"} onClick={() => setTier(t)}>
            {t}
          </button>
        ))}
      </label>
      <p className="small muted">
        basic: cheapest, 10% audits, bigger miner bonds · standard: 30% audits · assured: every job re-run on 0G before you get it.
      </p>
      <input type="file" accept=".wav,.flac,audio/wav,audio/flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button disabled={!file || busy} onClick={run}>
        {busy ? "Running…" : "Transcribe (demo-sponsored)"}
      </button>
      {msg && <p className="muted">{msg}</p>}
      <p className="small muted">Testnet only. Payments use test HBAR from a demo account run by the Hallmark team.</p>
    </div>
  );
}
