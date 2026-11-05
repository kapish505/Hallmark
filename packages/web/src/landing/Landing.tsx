import { useState } from "react";
import { PulseDiagram, type DEdge, type DFlash, type DNode, type DStep } from "./PulseDiagram";
import "./landing.css";

const CORE = "0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4";
const HASHSCAN = `https://hashscan.io/testnet/contract/${CORE}`;

/* ------------------------------------------------------------------ hero network */
const heroNodes: DNode[] = [
  { id: "agent", x: 96, y: 92, label: "Buyer agent", sub: "pays per request" },
  { id: "gateway", x: 96, y: 262, label: "Gateway", sub: "x402 merchant" },
  { id: "core", x: 326, y: 262, label: "Hallmark", sub: "Hedera contracts", kind: "core", w: 132 },
  { id: "exec", x: 548, y: 112, label: "Executor", sub: "bonded" },
  { id: "ver", x: 548, y: 262, label: "Verifier", sub: "re-runs blind" },
  { id: "com", x: 548, y: 412, label: "Committee", sub: "breaks ties" },
  { id: "store", x: 96, y: 412, label: "Evidence", sub: "by hash", kind: "ghost" },
];
const heroEdges: DEdge[] = [
  { id: "a-g", from: "agent", to: "gateway" },
  { id: "g-c", from: "gateway", to: "core" },
  { id: "c-e", from: "core", to: "exec", via: [[430, 262], [430, 112]] },
  { id: "c-v", from: "core", to: "ver" },
  { id: "c-m", from: "core", to: "com", via: [[430, 262], [430, 412]] },
  { id: "s-g", from: "store", to: "gateway", dashed: true },
];
const base: DStep[] = [
  { edge: "a-g", t0: 0.0, dur: 0.12, tag: "x402" },
  { edge: "g-c", t0: 0.12, dur: 0.12, tag: "createJob" },
  { edge: "c-e", t0: 0.25, dur: 0.12 },
  { edge: "c-e", t0: 0.38, dur: 0.12, reverse: true, tag: "commit" },
];
const heroPrograms: DStep[][] = [
  [...base, { edge: "c-e", t0: 0.55, dur: 0.12, reverse: true, tag: "reveal" }],
  [...base, { edge: "c-v", t0: 0.52, dur: 0.12, tag: "audit" }, { edge: "c-v", t0: 0.66, dur: 0.12, reverse: true, tag: "agree" }],
  [
    ...base,
    { edge: "c-v", t0: 0.52, dur: 0.1, tag: "audit" },
    { edge: "c-v", t0: 0.62, dur: 0.1, reverse: true, tone: "bad", tag: "mismatch" },
    { edge: "c-m", t0: 0.72, dur: 0.1 },
    { edge: "c-m", t0: 0.82, dur: 0.08, reverse: true, tag: "majority" },
    { edge: "g-c", t0: 0.9, dur: 0.08, reverse: true, tone: "ok", tag: "refund" },
  ],
];
const heroFlashes: DFlash[][] = [
  [{ node: "core", t0: 0.68, dur: 0.3, tone: "ok" }],
  [{ node: "core", t0: 0.8, dur: 0.2, tone: "ok" }, { node: "ver", t0: 0.66, dur: 0.14, tone: "ok" }],
  [{ node: "exec", t0: 0.86, dur: 0.14, tone: "bad" }],
];

/* ------------------------------------------------------------------ lifecycle */
const STEPS = [
  {
    id: "pay",
    title: "Pays over x402",
    body: "The agent reads the price from the manifest, signs an HBAR transfer, and the facilitator settles it on Hedera. The input is stored by its hash.",
    call: "POST /v1/transcribe  402  PAYMENT-SIGNATURE",
    state: "settlement confirmed on the Mirror Node",
  },
  {
    id: "commit",
    title: "Executor commits",
    body: "A stake-weighted draw picks the executor and locks its bond. It runs the pinned model and commits to a salted hash of the output.",
    call: "createJob · commit(jobId, commitment)",
    state: "executor bond locked · output hidden",
  },
  {
    id: "draw",
    title: "Audit is drawn",
    body: "Only after the commit, the Hedera random seed decides whether this job is re-run. The call is open to anyone, but never to a contract.",
    call: "drawAudit(jobId)  tx.origin only",
    state: "seed from the Hedera PRNG precompile",
  },
  {
    id: "verify",
    title: "Verifier re-runs blind",
    body: "A second bonded operator runs the same model on the same input and commits before either output is revealed. Matching commitments settle.",
    call: "commit · reveal · compare",
    state: "verifier bond locked · both commitments sealed",
  },
  {
    id: "settle",
    title: "Settles or slashes",
    body: "On a mismatch a committee re-runs and the majority decides. A wrong executor loses its bond and the buyer gets the full price back.",
    call: "resolve · Slashed · JobRefunded",
    state: "executor paid or slashed · bonds released",
  },
];

/* ------------------------------------------------------------------ roles hub */
const hubNodes: DNode[] = [
  { id: "core", x: 550, y: 210, label: "Hallmark contracts", sub: "escrow · bonds · record", kind: "core", w: 190 },
  { id: "buyer", x: 130, y: 70, label: "Agents and people", sub: "wallet or key" },
  { id: "gw", x: 130, y: 210, label: "Gateway", sub: "x402 · keeper" },
  { id: "ev", x: 130, y: 350, label: "Evidence store", sub: "salted, by hash" },
  { id: "op", x: 970, y: 70, label: "Operators", sub: "stake, run, commit" },
  { id: "ch", x: 970, y: 210, label: "Challengers", sub: "force an audit" },
  { id: "vf", x: 970, y: 350, label: "Verifier CLI", sub: "re-derives verdicts" },
];
const hubEdges: DEdge[] = [
  { id: "h-buyer", from: "core", to: "buyer", via: [[330, 210], [330, 70]] },
  { id: "h-gw", from: "core", to: "gw" },
  { id: "h-ev", from: "core", to: "ev", via: [[330, 210], [330, 350]] },
  { id: "h-op", from: "core", to: "op", via: [[770, 210], [770, 70]] },
  { id: "h-ch", from: "core", to: "ch" },
  { id: "h-vf", from: "core", to: "vf", via: [[770, 210], [770, 350]] },
];
const hubProgram: DStep[] = ["buyer", "gw", "ev", "op", "ch", "vf"].map((id, i) => ({ edge: `h-${id}`, t0: i * 0.1, dur: 0.22 }));

/* ------------------------------------------------------------------ research */
const RESEARCH = [
  {
    title: "Bit-exact inference across hardware",
    body: "Two GPUs rarely produce identical floating point. A re-run can only be compared exactly inside one pinned hardware class, so pools are per class.",
    metric: "1,520 / 1,520",
    unit: "identical OCR runs on one host",
  },
  {
    title: "Cheap models agree on easy inputs",
    body: "Whisper tiny matched large-v3 word for word on a clean clip. A substitution is only detectable where the models differ, so catch rates must be measured per workload.",
    metric: "12.5%",
    unit: "catch rate, fast OCR engine, first test set",
  },
  {
    title: "Text comparison on chain",
    body: "Tolerant comparison needs word overlap computed by the contract. A hash table in memory replaced the nested loop and keeps a dispute within one block.",
    metric: "2.42M → 708k",
    unit: "gas for 96 × 96 words",
  },
  {
    title: "Collusion between two seats",
    body: "If one party holds a share s of the stake, it fills both the executor and verifier seat with probability near s². Challenges and committees are the backstop.",
    metric: "≈ s²",
    unit: "chance of a shared executor and verifier",
  },
  {
    title: "Verification cost",
    body: "Every audit is a second inference. The audit rate trades compute against deterrence, and the bond has to grow as the rate falls.",
    metric: "1 + p",
    unit: "compute per job at audit rate p",
  },
  {
    title: "Outputs that stay private",
    body: "Salted commitments stop guessing attacks on chain. Hiding inputs from operators needs attested enclaves that agree bit for bit, which is still open work.",
    metric: "salted",
    unit: "output commitments on chain",
  },
];

function Arrow() {
  return (
    <svg className="m-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function BondCalculator() {
  const [p, setP] = useState(30);
  const [pi, setPi] = useState(50);
  const fee = 0.2;
  const c = 0.15;
  const minBond = 0.1;
  const bond = Math.max(minBond, c / ((p / 100) * (pi / 100)) - fee);
  const gain = c - (p / 100) * (pi / 100) * (bond + fee);
  const width = Math.min(100, (bond / 4) * 100);
  return (
    <div className="calc">
      <div className="calc-row">
        <label htmlFor="p">Audit rate</label>
        <input id="p" type="range" min={5} max={100} value={p} onChange={(e) => setP(Number(e.target.value))} />
        <output>{p}%</output>
      </div>
      <div className="calc-row">
        <label htmlFor="pi">Catch rate of the cheat</label>
        <input id="pi" type="range" min={5} max={100} value={pi} onChange={(e) => setPi(Number(e.target.value))} />
        <output>{pi}%</output>
      </div>
      <div className="calc-out">
        <div>
          <span className="k">Bond per job</span>
          <span className="v">{bond.toFixed(2)} HBAR</span>
        </div>
        <div className="gauge" aria-hidden="true">
          <i style={{ width: `${width}%` }} />
        </div>
        <div>
          <span className="k">Expected gain from cheating</span>
          <span className={`v ${gain <= 0.0001 ? "ok" : "bad"}`}>{gain <= 0.0001 ? "≤ 0 HBAR" : `${gain.toFixed(3)} HBAR`}</span>
        </div>
      </div>
      <p className="calc-note">Fee 0.20 HBAR, compute saved by cheating 0.15 HBAR. The contract refuses a model whose bond would also punish honest operators.</p>
    </div>
  );
}

export function Landing() {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  return (
    <div className="lp">
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="/" aria-label="Hallmark home">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <path d="M9 8v16M23 8v16M9 16h14" stroke="currentColor" strokeWidth="2.4" />
              <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            Hallmark
          </a>
          <nav className="nav-links" aria-label="Sections">
            <a href="#how">Protocol</a>
            <a href="#bond">Bonds</a>
            <a href="#network">Network</a>
            <a href="#research">Research</a>
          </nav>
          <a className="btn btn-primary" href="/console">
            Open the console <Arrow />
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero-in">
            <div className="hero-copy">
              <p className="eyebrow">Live on Hedera testnet</p>
              <h1>
                Verified speech‑to‑text and OCR <em>for paying agents</em>
              </h1>
              <p className="lede">
                Agents pay per request over x402. Bonded operators run pinned models, a random sample of jobs is re-run by a second operator, and a
                failed check slashes the operator and refunds the buyer.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-xl" href="/console">
                  Pay for a transcript <Arrow />
                </a>
                <a className="btn btn-ghost btn-xl" href="#how">
                  See the job lifecycle
                </a>
              </div>
              <dl className="facts">
                <div>
                  <dt>Audit rate</dt>
                  <dd>30% of jobs re-run</dd>
                </div>
                <div>
                  <dt>Models</dt>
                  <dd>Whisper large-v3 · Tesseract 5</dd>
                </div>
                <div>
                  <dt>Settlement</dt>
                  <dd>HBAR over x402</dd>
                </div>
              </dl>
            </div>
            <div className="hero-visual frame">
              <div className="frame-bar">
                <span>job network</span>
                <span className="live">
                  <i /> one job per cycle
                </span>
              </div>
              <PulseDiagram
                width={660}
                height={500}
                nodes={heroNodes}
                edges={heroEdges}
                program={heroPrograms[0]}
                programs={heroPrograms}
                flashSets={heroFlashes}
                cycle={4}
                stillAt={0.72}
                label="A job flows from the buyer agent through the gateway to the Hallmark contracts, an executor commits, sometimes a verifier re-runs it, and on a mismatch a committee decides and the buyer is refunded."
              />
            </div>
          </div>
        </section>

        <section className="sec" id="how">
          <div className="wrap">
            <div className="sec-head">
              <h2>One request, checked on a sample</h2>
              <p>Five steps, each a Hedera transaction anyone can open. The output stays hidden until the audit is decided.</p>
            </div>
            <div className="how">
              <ol className="steps" role="tablist" aria-label="Job lifecycle">
                {STEPS.map((x, i) => (
                  <li key={x.id}>
                    <button role="tab" aria-selected={i === step} className={i === step ? "is-on" : ""} onClick={() => setStep(i)}>
                      <span className="n">{String(i + 1).padStart(2, "0")}</span>
                      {x.title}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="frame app" role="tabpanel">
                <div className="frame-bar">
                  <span>console / job</span>
                  <span className="mono dim">speech-to-text job</span>
                </div>
                <div className="app-body">
                  <div className="app-status">
                    {STEPS.map((x, i) => (
                      <span key={x.id} className={i < step ? "done" : i === step ? "now" : ""}>
                        {x.title}
                      </span>
                    ))}
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <code className="call">{s.call}</code>
                  <div className="badge-row">
                    <span className={`badge ${step >= 4 ? "ok" : "wait"}`}>{["paid", "committed", "drawing audit", "re-running", "audited (re-run agreed)"][step]}</span>
                    <span className="mono dim small">{s.state}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="bond">
          <div className="wrap split">
            <div className="sec-head">
              <h2>Bonds sized so cheating loses money</h2>
              <p>
                An operator saves compute by cheating, and is caught when the job is audited and the cheat shows. The bond covers the worst cheat on the
                measured workload.
              </p>
              <div className="formula">
                <span>B ≥ c / (p · π) − F</span>
                <span>B ≤ m / (p · fp)</span>
              </div>
            </div>
            <div className="frame">
              <div className="frame-bar">
                <span>bond calculator</span>
              </div>
              <BondCalculator />
            </div>
          </div>
        </section>

        <section className="sec" id="network">
          <div className="wrap">
            <div className="sec-head">
              <h2>Who does what</h2>
              <p>The contracts hold the escrow, the bonds and the record. Everyone else is replaceable and checked.</p>
            </div>
            <div className="frame">
              <PulseDiagram
                width={1100}
                height={420}
                nodes={hubNodes}
                edges={hubEdges}
                program={hubProgram}
                cycle={3.2}
                stillAt={0.4}
                label="The Hallmark contracts in the centre connect to agents and people, the gateway, the evidence store, operators, challengers and the verifier CLI."
              />
            </div>
          </div>
        </section>

        <section className="sec" id="research">
          <div className="wrap">
            <div className="sec-head">
              <h2>Open research problems</h2>
              <p>Verifying inference cheaply is not solved. These are the bottlenecks we measured while building Hallmark.</p>
            </div>
            <div className="grid">
              {RESEARCH.map((r) => (
                <article key={r.title} className="card">
                  <div className="metric">
                    <span>{r.metric}</span>
                    <small>{r.unit}</small>
                  </div>
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec close">
          <div className="wrap close-in">
            <h2>Pay for one verified transcript</h2>
            <p>Connect a Hedera testnet wallet, upload a short clip or an image, and follow every step on HashScan.</p>
            <div className="hero-actions">
              <a className="btn btn-primary btn-xl" href="/console">
                Pay for a transcript <Arrow />
              </a>
              <a className="btn btn-ghost btn-xl" href={HASHSCAN} target="_blank" rel="noreferrer">
                See the contract on HashScan
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <span className="brand small">Hallmark</span>
          <span className="mono dim small">Hedera testnet · {CORE.slice(0, 10)}…{CORE.slice(-6)}</span>
          <span className="dim small">Built with Hedera, x402, Whisper and Tesseract. Product names are trademarks of their owners.</span>
          <a className="dim small" href="/console#verify">
            Verify a job
          </a>
        </div>
      </footer>
    </div>
  );
}
