import { useState } from "react";
import { PulseDiagram, type DEdge, type DFlash, type DNode, type DStep } from "./PulseDiagram";
import "./landing.css";

const CORE = "0x4Ae8e841fD17c70F9E1628e4a0121944288c46CE";
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

/* ------------------------------------------------------------------ the gap: x402 alone vs with Hallmark */
type Tone = "ok" | "bad" | "dim";
type Row = [string, string, Tone];
const CHEATS: Array<{ id: string; label: string; plain: Row[]; hm: Row[] }> = [
  {
    id: "honest",
    label: "Honest provider",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Unknown", "dim"], ["Proof", "None", "dim"], ["If wrong", "No recourse", "dim"]],
    hm: [["Payment", "Settled, held in escrow", "ok"], ["What ran", "Pinned model, answer sealed on chain", "ok"], ["Proof", "30% re-run blind by a second operator", "ok"], ["Outcome", "Paid, with a public receipt", "ok"]],
  },
  {
    id: "small",
    label: "Serves a cheaper model",
    plain: [["Payment", "Settled", "ok"], ["What ran", "A smaller model. You can't tell", "bad"], ["Proof", "None", "dim"], ["If wrong", "Provider keeps the money", "bad"]],
    hm: [["Payment", "Settled, held in escrow", "ok"], ["What ran", "Sealed answer from the cheap model", "dim"], ["Proof", "On audit, the re-run differs wherever the cheap model errs", "ok"], ["Outcome", "Committee confirms, bond slashed, full refund", "ok"]],
  },
  {
    id: "trunc",
    label: "Cuts the work short",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Half the input", "bad"], ["Proof", "None", "dim"], ["If wrong", "Provider keeps the money", "bad"]],
    hm: [["Payment", "Settled, held in escrow", "ok"], ["What ran", "Sealed, shortened answer", "dim"], ["Proof", "Re-run commitment does not match", "ok"], ["Outcome", "Bond slashed, full refund", "ok"]],
  },
  {
    id: "replay",
    label: "Replays a cached answer",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Nothing. An old answer", "bad"], ["Proof", "None", "dim"], ["If wrong", "Provider keeps the money", "bad"]],
    hm: [["Payment", "Settled, held in escrow", "ok"], ["What ran", "Sealed answer bound to this job's salt", "dim"], ["Proof", "Re-run on the real input does not match", "ok"], ["Outcome", "Bond slashed, full refund", "ok"]],
  },
  {
    id: "vanish",
    label: "Takes the money and stalls",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Nothing", "bad"], ["Proof", "None", "dim"], ["If wrong", "You wait. No refund path", "bad"]],
    hm: [["Payment", "Settled, held in escrow", "ok"], ["What ran", "Nothing committed in the window", "dim"], ["Proof", "The deadline is on chain, on every job", "ok"], ["Outcome", "Bond penalized, refunded automatically", "ok"]],
  },
];

/* ------------------------------------------------------------------ why Hedera */
const HEDERA = [
  { k: "PRNG precompile", title: "An audit draw nobody can steer", line: "The re-run is drawn from Hedera's native randomness after the executor has sealed its answer, in a call contracts cannot make, so it cannot be re-rolled." },
  { k: "Seconds to finality", title: "Disputes in minutes, not days", line: "Commit, reveal and challenge windows of a few minutes are safe because every step is final within seconds." },
  { k: "Predictable fees", title: "Per-request guarantees are affordable", line: "Fees are fixed in USD, so a job's price can include its escrow, its bond lock and its share of audits." },
  { k: "x402 in HBAR", title: "Payment and proof on one ledger", line: "The x402 settlement, the job, the bonds and any slash or refund are all transactions on the same network, linked by job id." },
  { k: "Mirror Node", title: "Anyone can re-derive the verdict", line: "Every commit, draw and slash is public. hallmark-verify recomputes a job's outcome from Mirror Node data alone." },
];

function GapDemo() {
  const [i, setI] = useState(1);
  const c = CHEATS[i];
  const col = (title: string, sub: string, rows: Row[], us: boolean) => (
    <div className={`gap-col${us ? " us" : ""}`}>
      <div className="gap-col-head">
        <strong>{title}</strong>
        <span className="mono dim small">{sub}</span>
      </div>
      <ul key={c.id}>
        {rows.map(([k, v, t], n) => (
          <li key={k} className={`t-${t}`} style={{ animationDelay: `${n * 70}ms` }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="gap">
      <div className="gap-pick" role="tablist" aria-label="What the provider does">
        <span className="mono dim small">The provider…</span>
        {CHEATS.map((x, n) => (
          <button key={x.id} role="tab" aria-selected={n === i} className={n === i ? "is-on" : ""} onClick={() => setI(n)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="gap-cols">
        {col("x402 alone", "payment rail", c.plain, false)}
        {col("x402 + Hallmark", "payment + verification", c.hm, true)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ future scope */
const SPECTRUM = [
  { id: "exact", label: "Exact match", note: "same output, bit for bit" },
  { id: "tol", label: "Tolerance", note: "close enough, by a measured threshold" },
  { id: "stat", label: "Statistical", note: "distributions compared over many runs" },
  { id: "proof", label: "Proof", note: "cryptographic proof of execution" },
];
const FUTURE = [
  { kind: "Speech-to-text", method: "Pinned Whisper, normalized text, word-overlap tolerance", band: "exact", status: "Live" },
  { kind: "OCR", method: "Pinned engine, normalized text, exact on one hardware class", band: "exact", status: "Live" },
  { kind: "Embeddings", method: "Cosine distance between the executor's and the verifier's vectors", band: "tol", status: "Next" },
  { kind: "Classification and detection", method: "Same top label, boxes compared by overlap", band: "tol", status: "Next" },
  { kind: "LLM text generation", method: "Greedy decoding with token-by-token checks against a re-run", band: "stat", status: "Research" },
  { kind: "Image generation", method: "Seeded runs compared by perceptual distance", band: "stat", status: "Research" },
  { kind: "Agent tool calls", method: "Each step's input and output committed, the trace re-run in parts", band: "tol", status: "Research" },
  { kind: "Small models", method: "Zero-knowledge proofs where the prover cost is acceptable", band: "proof", status: "Research" },
];

/* ------------------------------------------------------------------ why it matters */
const WHY = [
  { who: "For agents", title: "Spend without a person watching", line: "A bond and a refund stand behind every paid answer, so an agent can buy inference from operators it has never met." },
  { who: "For developers", title: "Prove what you serve", line: "Sell a model with a public, on-chain record that the pinned model really ran, checked on a sample anyone can audit." },
  { who: "For the ecosystem", title: "A neutral record of quality", line: "Slashes, refunds and audit results are public, so a marketplace can rank providers on evidence instead of claims." },
];

/* ------------------------------------------------------------------ comparison */
const COMPARE: Array<{ name: string; check: string; penalty: string; cost: string; pay: string; us?: boolean }> = [
  { name: "Hallmark", check: "Random blind re-run, committee on mismatch", penalty: "Bond slashed, buyer refunded", cost: "1 + audit rate", pay: "Per request over x402, HBAR", us: true },
  { name: "Gensyn Verde", check: "Refereed delegation, disputes narrowed to one operation", penalty: "Stake at risk in a dispute", cost: "Low until a dispute", pay: "Network payments" },
  { name: "EigenAI", check: "Deterministic inference, optimistic re-execution", penalty: "Restaked security", cost: "Low until a challenge", pay: "Service payments" },
  { name: "Proof of Sampling", check: "Sampled checks as an incentive game", penalty: "Penalty on caught sampling", cost: "Set by the sampling rate", pay: "Protocol-specific" },
  { name: "TOPLOC", check: "Hashes of model activations compared on re-run", penalty: "Depends on the deployment", cost: "Small proof per output", pay: "Not a payment protocol" },
  { name: "zkML", check: "Zero-knowledge proof of the computation", penalty: "Invalid proofs rejected", cost: "High prover cost", pay: "Not a payment protocol" },
];

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
            <a href="#problem">The gap</a>
            <a href="#how">Protocol</a>
            <a href="#hedera">Hedera</a>
            <a href="#future">Future</a>
            <a href="#compare">Compare</a>
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
              <p className="eyebrow">Verified inference · live on Hedera testnet</p>
              <h1>
                x402 moves the money. <em>Hallmark proves the work.</em>
              </h1>
              <p className="lede">
                An agent paying for inference can't see the GPU. A provider can serve a cheaper model, cut the work short or replay an old answer, and
                the payment still settles. Hallmark puts an operator bond behind every paid answer and re-runs a random sample, so cheating costs more
                than it saves.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-xl" href="/console">
                  Run a verified job <Arrow />
                </a>
                <a className="btn btn-ghost btn-xl" href="#problem">
                  Try to cheat it
                </a>
              </div>
              <dl className="facts">
                <div>
                  <dt>Behind every answer</dt>
                  <dd>an operator bond</dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>30% re-run blind</dd>
                </div>
                <div>
                  <dt>If it was wrong</dt>
                  <dd>slashed, full refund</dd>
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

        <section className="sec" id="problem">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">01 · The gap</p>
              <h2>Paid is not the same as done</h2>
              <p>
                x402 gives agents a way to pay any API per request. It confirms the money moved. Nothing in it says which model answered, or whether
                any work happened at all. Pick what the provider does.
              </p>
            </div>
            <GapDemo />
          </div>
        </section>

        <section className="sec" id="how">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">02 · The protocol</p>
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
              <p className="chap">03 · The economics</p>
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
              <p className="chap">04 · The network</p>
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

        <section className="sec" id="hedera">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">05 · Why Hedera</p>
              <h2>Verification needs a ledger that is fast, cheap and fair to draw from</h2>
              <p>Sampled re-runs only deter cheating if the draw can't be gamed, disputes end quickly, and the whole record is public.</p>
            </div>
            <div className="hedera">
              {HEDERA.map((h) => (
                <article key={h.k} className="h-card">
                  <span className="mono small h-k">{h.k}</span>
                  <h3>{h.title}</h3>
                  <p>{h.line}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="future">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">06 · Beyond speech and OCR</p>
              <h2>The same check for every kind of inference</h2>
              <p>The protocol does not care what the model does. Each model type only needs a way to decide whether two runs agree.</p>
            </div>
            <div className="spectrum" aria-hidden="true">
              {SPECTRUM.map((b) => (
                <div key={b.id} className={`band band-${b.id}`}>
                  <span>{b.label}</span>
                  <small>{b.note}</small>
                </div>
              ))}
            </div>
            <div className="future">
              {FUTURE.map((f) => (
                <article key={f.kind} className={`fcard band-${f.band}`}>
                  <div className="fcard-top">
                    <h3>{f.kind}</h3>
                    <span className={`status s-${f.status.toLowerCase()}`}>{f.status}</span>
                  </div>
                  <p>{f.method}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="why">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">07 · Why it matters</p>
              <h2>Paid inference needs a receipt and a recourse</h2>
            </div>
            <div className="why">
              {WHY.map((w, i) => (
                <article key={w.who} className="why-card">
                  <div className="why-rule">
                    <i style={{ animationDelay: `${i * 0.4}s` }} />
                  </div>
                  <small>{w.who}</small>
                  <h3>{w.title}</h3>
                  <p>{w.line}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="compare">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">08 · The landscape</p>
              <h2>How Hallmark compares</h2>
              <p>Verifiable inference is an active field. Hallmark joins per-request payment to a sampled re-run and a bond.</p>
            </div>
            <div className="cmp-wrap frame">
              <table className="cmp">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>How results are checked</th>
                    <th>If a result is wrong</th>
                    <th>Compute overhead</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((c) => (
                    <tr key={c.name} className={c.us ? "us" : ""}>
                      <td>{c.name}</td>
                      <td>{c.check}</td>
                      <td>{c.penalty}</td>
                      <td>{c.cost}</td>
                      <td>{c.pay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cmp-note">Summaries of each project's public descriptions. They are complementary approaches, not rivals in every case.</p>
          </div>
        </section>

        <section className="sec" id="research">
          <div className="wrap">
            <div className="sec-head">
              <p className="chap">09 · The research</p>
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
            <h2>Run your first verified job</h2>
            <p>Connect a Hedera testnet wallet, send a short clip or an image, and follow every step of the check on HashScan.</p>
            <div className="hero-actions">
              <a className="btn btn-primary btn-xl" href="/console">
                Run a verified job <Arrow />
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
