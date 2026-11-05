import { useState } from "react";
import { GATEWAY } from "../api";

export function TryPage({ onJob }: { onJob: (id: string) => void }) {
  const [task, setTask] = useState<"asr" | "ocr">("asr");
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const go = async () => {
    if (!file) return;
    const f = new FormData();
    f.append("task", task);
    f.append("file", file);
    setMsg("paying over x402 with the demo buyer...");
    const r = await fetch(`${GATEWAY}/demo/try`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: f });
    const j = await r.json();
    setMsg(r.ok ? `${j.status}: ${j.badge}` : `error: ${j.error}`);
    if (j.jobId) onJob(j.jobId);
  };
  return (
    <div className="stack narrow">
      <h2>Try it</h2>
      <p>Pay per request for speech-to-text or OCR from bonded operators. A random sample of jobs is re-run by a second operator; a failed check slashes the operator and refunds you.</p>
      <div className="row wrap">
        <select value={task} onChange={(e) => setTask(e.target.value as "asr" | "ocr")}><option value="asr">speech: 16 kHz mono WAV, up to 15 s</option><option value="ocr">OCR: PNG with ASCII text</option></select>
        <input type="file" accept={task === "asr" ? ".wav" : ".png"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <input className="jobinput" type="password" placeholder="demo token (the demo buyer is sponsored)" value={token} onChange={(e) => setToken(e.target.value)} />
      <button disabled={!file} onClick={go}>Pay and run</button>
      <p className="small">{msg}</p>
      <p className="small muted">Or with your own testnet account, from a terminal:</p>
      <pre className="small">{`BUYER_ACCOUNT_ID=0.0.x BUYER_PRIVATE_KEY=0x... \\
pnpm agent clip.wav --gateway ${GATEWAY || "<gateway>"} --max-price 0.5 --budget 5`}</pre>
    </div>
  );
}
