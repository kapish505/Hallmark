import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GATEWAY, getJson, tinybarToHbar } from "../api";
import { useWallet } from "../WalletContext";
import { payAndPost } from "../wallet";

interface ManifestTask {
  task: "asr" | "ocr";
  endpoint: string;
  priceTinybar: string;
  bondTinybar: string;
  class: string;
  auditBps: number;
  available: boolean;
  validators: string[];
  accuracy: { expectedErrorBps: number; sampleSize: number; metric: string; measured: boolean };
}
interface Manifest {
  payTo: string;
  network: string;
  tasks: ManifestTask[];
}

export function TryPage({ onJob }: { onJob: (id: string, token?: string) => void }) {
  const w = useWallet();
  const manifest = useQuery({ queryKey: ["manifest"], queryFn: () => getJson<Manifest>("/.well-known/hallmark.json"), refetchInterval: 30_000 });
  const [task, setTask] = useState<"asr" | "ocr">("asr");
  const [file, setFile] = useState<File | null>(null);
  const [validator, setValidator] = useState("none");
  const [minWords, setMinWords] = useState(3);
  const [cap, setCap] = useState("1");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const t = manifest.data?.tasks.find((x) => x.task === task);

  const go = async () => {
    if (!file || !t || !w.signer || !manifest.data) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append("file", file);
      if (validator !== "none") f.append("validator", validator === "min_words" ? `min_words:${minWords}` : validator);
      setMsg(`Approve the ${tinybarToHbar(t.priceTinybar)} transfer in your wallet...`);
      const r = await payAndPost(w.signer, t.endpoint, f, { payTo: manifest.data.payTo, amountTinybar: t.priceTinybar, maxTinybar: BigInt(Math.round(Number(cap) * 1e8)) });
      if (r.status !== 202) throw new Error(`gateway answered ${r.status}: ${String(r.body.error ?? "")}`);
      setMsg(r.settlement?.success ? `Paid. x402 settlement ${r.settlement.transaction}` : "Accepted.");
      onJob(String(r.body.jobId), String(r.body.accessToken));
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack narrow">
      <h2>Try it with your own wallet</h2>
      <p>
        Pay per request for speech-to-text or OCR from bonded operators, over x402 on Hedera testnet. A random sample of jobs is re-run by a second
        operator; a failed check slashes the operator and refunds you. Everything here is real: your wallet signs a real HBAR transfer.
      </p>
      <ol className="small muted">
        <li>Use a Hedera testnet account in HashPack, Kabila or Blade (free testnet HBAR from portal.hedera.com).</li>
        <li>Connect it (top right), pick a task and a file, and approve the transfer in your wallet.</li>
        <li>Keep the job page link: it carries your private access token for the result.</li>
      </ol>
      {manifest.error && <p className="bad">{String(manifest.error)}</p>}
      <div className="row wrap">
        <select value={task} onChange={(e) => { setTask(e.target.value as "asr" | "ocr"); setValidator("none"); }}>
          <option value="asr">Speech: 16 kHz mono WAV, up to 15 s</option>
          <option value="ocr">OCR: PNG with ASCII text</option>
        </select>
        <input type="file" accept={task === "asr" ? ".wav,audio/wav" : ".png,image/png"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {t ? (
        <div className="card small">
          <dl>
            <span><dt>Price</dt><dd>{tinybarToHbar(t.priceTinybar)}</dd></span>
            <span><dt>Operator bond</dt><dd>{tinybarToHbar(t.bondTinybar)}</dd></span>
            <span><dt>Audit rate</dt><dd>{t.auditBps / 100}% of jobs re-run</dd></span>
            <span><dt>Pinned model error</dt><dd>{t.accuracy.measured ? `${(t.accuracy.expectedErrorBps / 100).toFixed(1)}% ${t.accuracy.metric} on ${t.accuracy.sampleSize} samples` : "not measured yet"}</dd></span>
            <span><dt>Status</dt><dd>{t.available ? <span className="ok">available</span> : <span className="bad">no capacity right now</span>}</dd></span>
          </dl>
        </div>
      ) : (
        <p className="warn small">This task is not offered right now (no model registered or not enough bonded operators).</p>
      )}
      <div className="row wrap">
        <label className="small">Validator (advisory, no money effect)</label>
        <select value={validator} onChange={(e) => setValidator(e.target.value)}>
          {(t?.validators ?? ["none"]).map((v) => {
            const name = v.split(":")[0];
            return <option key={name} value={name}>{name}</option>;
          })}
        </select>
        {validator === "min_words" && <input type="number" min={0} max={1000} value={minWords} onChange={(e) => setMinWords(Number(e.target.value))} />}
      </div>
      <div className="row wrap">
        <label className="small">Your per-call cap (HBAR)</label>
        <input value={cap} onChange={(e) => setCap(e.target.value)} style={{ width: 80 }} />
      </div>
      <button disabled={!file || !t?.available || !w.signer || busy} onClick={go}>
        {w.signer ? `Pay ${t ? tinybarToHbar(t.priceTinybar) : ""} and run` : "Connect a wallet first"}
      </button>
      <p className="small">{msg}</p>
      <p className="small muted">Agents pay without a person: <span className="mono">pnpm agent clip.wav --gateway {GATEWAY || "<gateway>"} --max-price 0.5 --budget 5</span></p>
    </div>
  );
}
