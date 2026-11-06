import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson, tinybarToHbar } from "../api";
import { useWallet } from "../WalletContext";
import { payAndPost, payDirect } from "../wallet";

interface ManifestTask {
  task: "asr" | "ocr";
  endpoint: string;
  priceTinybar: string;
  bondTinybar: string;
  auditBps: number;
  available: boolean;
  validators: string[];
  accuracy: { expectedErrorBps: number; sampleSize: number; metric: string; measured: boolean };
}
interface Manifest {
  payTo: string;
  payToEvm?: string;
  tasks: ManifestTask[];
}

const TASKS = [
  { id: "asr" as const, name: "Speech to text", hint: "WAV · 16 kHz mono · up to 15 s", accept: ".wav,audio/wav" },
  { id: "ocr" as const, name: "Image to text", hint: "PNG · printed ASCII text", accept: ".png,image/png" },
];

type Phase = "idle" | "signing" | "submitting" | "done" | "error";

export function Composer({ onJob }: { onJob: (id: string, token: string) => void }) {
  const w = useWallet();
  const manifest = useQuery({ queryKey: ["manifest"], queryFn: () => getJson<Manifest>("/.well-known/hallmark.json"), refetchInterval: 20_000 });
  const [task, setTask] = useState<"asr" | "ocr">("asr");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [validator, setValidator] = useState("none");
  const [minWords, setMinWords] = useState(3);
  const [cap, setCap] = useState("1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const t = manifest.data?.tasks.find((x) => x.task === task);
  const meta = TASKS.find((x) => x.id === task)!;
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => {
    setFile(null);
    setValidator("none");
  }, [task]);

  const pick = (f: File | undefined | null) => f && setFile(f);
  const connected = !!(w.signer || w.evmAddress);
  const busy = phase === "signing" || phase === "submitting";

  const go = async () => {
    if (!file || !t || !manifest.data || !connected) return;
    try {
      // Re-read the price right before paying: it moves with the audit rate, and paying a stale price would be rejected.
      setMsg("Checking the current price…");
      const fresh = (await manifest.refetch()).data;
      const t = fresh?.tasks.find((x) => x.task === task);
      if (!fresh || !t || !t.available) throw new Error("This task is not available right now.");
      if (BigInt(t.priceTinybar) > BigInt(Math.round(Number(cap) * 1e8))) throw new Error("The price is above your per-call cap.");
      const f = new FormData();
      f.append("file", file);
      if (validator !== "none") f.append("validator", validator === "min_words" ? `min_words:${minWords}` : validator);
      setPhase("signing");
      setMsg(`Approve ${tinybarToHbar(t.priceTinybar)} in your wallet`);
      let body: Record<string, unknown>;
      let status: number;
      if (w.kind === "evm" && w.evmAddress) {
        if (!fresh.payToEvm) throw new Error("This gateway does not accept direct transfers.");
        const r = await payDirect(w.evmAddress, fresh.payToEvm, t.priceTinybar, t.endpoint.replace(/\/v1\/(transcribe|ocr)$/, `/v1/direct/${task}`), f);
        ({ body, status } = r);
      } else {
        const r = await payAndPost(w.signer!, t.endpoint, f, { payTo: fresh.payTo, amountTinybar: t.priceTinybar, maxTinybar: BigInt(Math.round(Number(cap) * 1e8)) });
        ({ body, status } = r);
      }
      setPhase("submitting");
      if (status !== 202) throw new Error(String(body.error ?? `Gateway answered ${status}`));
      setPhase("done");
      setMsg("Paid. Following the job live.");
      onJob(String(body.jobId), String(body.accessToken));
    } catch (e) {
      setPhase("error");
      setMsg(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <section className="panel composer">
      <header className="panel-head">
        <h2>New job</h2>
        <span className="mono dim">{t ? tinybarToHbar(t.priceTinybar) : "-"}</span>
      </header>

      <div className="seg" role="tablist" aria-label="Task">
        {TASKS.map((x) => {
          const mt = manifest.data?.tasks.find((m) => m.task === x.id);
          return (
            <button key={x.id} role="tab" aria-selected={task === x.id} className={task === x.id ? "is-on" : ""} onClick={() => setTask(x.id)}>
              <span>{x.name}</span>
              <small>{mt ? (mt.available ? tinybarToHbar(mt.priceTinybar) : "unavailable") : "…"}</small>
            </button>
          );
        })}
      </div>

      <div
        className={`drop${drag ? " is-drag" : ""}${file ? " has-file" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        role="button"
        tabIndex={0}
      >
        <input ref={input} type="file" accept={meta.accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
        {file && preview ? (
          <div className="drop-file" onClick={(e) => e.stopPropagation()}>
            {task === "ocr" ? <img src={preview} alt="" /> : <audio src={preview} controls />}
            <div className="drop-meta">
              <span className="mono">{file.name}</span>
              <small className="dim">{(file.size / 1024).toFixed(1)} KB</small>
              <button className="link-btn" onClick={() => setFile(null)}>Replace</button>
            </div>
          </div>
        ) : (
          <div className="drop-empty">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            <span>Drop a file or click to choose</span>
            <small className="dim">{meta.hint}</small>
          </div>
        )}
      </div>

      <div className="fields">
        <label>
          <span>Validator</span>
          <select value={validator} onChange={(e) => setValidator(e.target.value)}>
            {(t?.validators ?? ["none"]).map((v) => {
              const n = v.split(":")[0];
              return <option key={n} value={n}>{n === "none" ? "none" : n.replace("_", " ")}</option>;
            })}
          </select>
        </label>
        {validator === "min_words" && (
          <label>
            <span>Minimum words</span>
            <input type="number" min={0} max={1000} value={minWords} onChange={(e) => setMinWords(Number(e.target.value))} />
          </label>
        )}
        <label>
          <span>Per-call cap (HBAR)</span>
          <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
        </label>
      </div>

      {t && (
        <dl className="kv">
          <div><dt>Operator bond</dt><dd>{tinybarToHbar(t.bondTinybar)}</dd></div>
          <div><dt>Audit rate</dt><dd>{t.auditBps / 100}% re-run</dd></div>
          <div><dt>Pinned model error</dt><dd>{t.accuracy.measured ? `${(t.accuracy.expectedErrorBps / 100).toFixed(1)}% ${t.accuracy.metric}, n=${t.accuracy.sampleSize}` : "not measured"}</dd></div>
          <div><dt>Payment</dt><dd>{w.kind === "evm" ? "Direct HBAR transfer" : "x402 on Hedera"}</dd></div>
        </dl>
      )}

      <button className="btn-pay" disabled={!file || !t?.available || !connected || busy} onClick={go}>
        {!connected ? "Connect a wallet to pay" : busy ? (phase === "signing" ? "Waiting for your wallet…" : "Submitting…") : `Pay ${t ? tinybarToHbar(t.priceTinybar) : ""} and run`}
      </button>
      {t && (
        <p className="pay-note">
          Backed by a {tinybarToHbar(t.bondTinybar)} operator bond. A random {Math.round(t.auditBps / 100)}% of jobs are re-run by a second operator; a
          wrong answer is slashed and you are refunded in full.
        </p>
      )}
      {msg && <p className={`status-line ${phase === "error" ? "bad" : phase === "done" ? "ok" : "dim"}`}>{msg}</p>}
      {manifest.error && <p className="status-line bad">Gateway unreachable.</p>}
    </section>
  );
}
