import { useState } from "react";
import { FlowDiagram, type FEdge, type FNode, type FStep } from "./FlowDiagram";
import { Arrow, CORE, hashscan, Shell } from "../site/Shell";

/* ------------------------------------------------------------------ hero: one job, end to end */
const jobNodes: FNode[] = [
  { id: "buyer", x: 92, y: 90, label: "You", sub: "agent or service" },
  { id: "core", x: 320, y: 250, label: "Hallmark", sub: "escrow · bonds · verdict", kind: "core", w: 170 },
  { id: "exec", x: 560, y: 90, label: "Executor", sub: "bonded, runs it" },
  { id: "ver", x: 560, y: 250, label: "Verifier", sub: "re-runs blind" },
  { id: "com", x: 560, y: 410, label: "Committee", sub: "only on mismatch" },
  { id: "ev", x: 92, y: 410, label: "Evidence store", sub: "input, by hash", kind: "ghost" },
];
const jobEdges: FEdge[] = [
  { id: "b-c", from: "buyer", to: "core", via: [[92, 250]] },
  { id: "c-e", from: "core", to: "exec", via: [[440, 250], [440, 90]] },
  { id: "c-v", from: "core", to: "ver" },
  { id: "c-m", from: "core", to: "com", via: [[440, 250], [440, 410]] },
  { id: "ev-c", from: "ev", to: "core", via: [[92, 330], [320, 330]], dashed: true },
];
const jobSteps: FStep[] = [
  { edge: "b-c", caption: "You pay into escrow and create the job. The input sits in the evidence store, pinned by its hash." },
  { edge: "c-e", caption: "The contract draws a bonded executor and locks its bond." },
  { edge: "c-e", reverse: true, caption: "The executor runs the pinned model and commits a sealed answer.", lands: { node: "exec", tone: "brass" } },
  { edge: "c-v", caption: "A random draw sends a sample of jobs (30% today) to a second operator." },
  { edge: "c-v", reverse: true, caption: "The verifier re-runs it blind and commits. The two sealed answers are compared.", lands: { node: "ver", tone: "brass" } },
  { edge: "c-m", caption: "If they differ, a committee re-runs and the majority decides." },
  { edge: "b-c", reverse: true, tone: "ok", caption: "Match: you get the answer. Wrong: the executor is slashed and you get your money back.", lands: { node: "buyer", tone: "ok" } },
];

/* ------------------------------------------------------------------ architecture */
const archNodes: FNode[] = [
  { id: "agent", x: 110, y: 70, label: "AI agent", sub: "pays over x402" },
  { id: "gw", x: 330, y: 70, label: "x402 gateway", sub: "a client, optional" },
  { id: "svc", x: 110, y: 230, label: "Service", sub: "@hallmark/sdk" },
  { id: "dapp", x: 110, y: 390, label: "Smart contract", sub: "reads the verdict" },
  { id: "core", x: 520, y: 230, label: "Hallmark core", sub: "contracts on Hedera", kind: "core", w: 190 },
  { id: "man", x: 520, y: 70, label: "Model manifests", sub: "measured, then enabled", kind: "ghost" },
  { id: "ev", x: 520, y: 390, label: "Evidence store", sub: "inputs, salts, outputs", kind: "ghost" },
  { id: "ops", x: 840, y: 230, label: "Bonded operators", sub: "executor · verifier · committee" },
  { id: "box", x: 840, y: 390, label: "Model containers", sub: "pinned by digest" },
];
const archEdges: FEdge[] = [
  { id: "a-g", from: "agent", to: "gw" },
  { id: "g-c", from: "gw", to: "core", via: [[330, 180], [520, 180]] },
  { id: "s-c", from: "svc", to: "core" },
  { id: "s-ev", from: "svc", to: "ev", via: [[250, 230], [250, 330], [520, 330]] },
  { id: "d-c", from: "dapp", to: "core", via: [[300, 390], [300, 280], [520, 280]] },
  { id: "m-c", from: "man", to: "core", dashed: true },
  { id: "c-o", from: "core", to: "ops" },
  { id: "o-ev", from: "ops", to: "ev", via: [[700, 230], [700, 390]] },
  { id: "o-b", from: "ops", to: "box" },
];
const archSteps: FStep[] = [
  { edge: "a-g", caption: "An agent that speaks x402 pays the gateway. The gateway is just one client." },
  { edge: "g-c", caption: "After settlement, the gateway calls createJob for the agent." },
  { edge: "s-ev", caption: "A service skips the gateway: it puts its input and a salt in the evidence store." },
  { edge: "s-c", caption: "Then it calls createJob itself and pays the contract directly." },
  { edge: "m-c", caption: "Each model is a manifest. The registry enables it only if the bond math holds." },
  { edge: "c-o", caption: "The core draws bonded operators for each seat and locks their bonds." },
  { edge: "o-ev", caption: "Operators fetch the input and check it against the on-chain hash." },
  { edge: "o-b", caption: "They run the pinned container, commit, and reveal when the contract asks." },
  { edge: "d-c", reverse: true, tone: "ok", caption: "Any contract reads the final verdict through IHallmarkVerdict.", lands: { node: "dapp", tone: "ok" } },
];

/* ------------------------------------------------------------------ the gap */
type Tone = "ok" | "bad" | "dim";
type Row = [string, string, Tone];
const CHEATS: Array<{ id: string; label: string; plain: Row[]; hm: Row[] }> = [
  {
    id: "small",
    label: "Serves a cheaper model",
    plain: [["Payment", "Settled", "ok"], ["What ran", "A smaller model. You can't tell", "bad"], ["Proof", "None", "dim"], ["Your money", "Gone", "bad"]],
    hm: [["Payment", "Held in escrow", "ok"], ["What ran", "Sealed answer from the cheap model", "dim"], ["Check", "The re-run differs where the cheap model errs", "ok"], ["Your money", "Bond slashed, full refund", "ok"]],
  },
  {
    id: "trunc",
    label: "Does half the work",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Half the input", "bad"], ["Proof", "None", "dim"], ["Your money", "Gone", "bad"]],
    hm: [["Payment", "Held in escrow", "ok"], ["What ran", "Sealed, shortened answer", "dim"], ["Check", "The re-run's sealed answer does not match", "ok"], ["Your money", "Bond slashed, full refund", "ok"]],
  },
  {
    id: "replay",
    label: "Replays an old answer",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Nothing", "bad"], ["Proof", "None", "dim"], ["Your money", "Gone", "bad"]],
    hm: [["Payment", "Held in escrow", "ok"], ["What ran", "An answer tied to the wrong input", "dim"], ["Check", "The re-run on the real input does not match", "ok"], ["Your money", "Bond slashed, full refund", "ok"]],
  },
  {
    id: "vanish",
    label: "Takes the money and stalls",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Nothing", "bad"], ["Proof", "None", "dim"], ["Your money", "You wait", "bad"]],
    hm: [["Payment", "Held in escrow", "ok"], ["What ran", "Nothing committed in time", "dim"], ["Check", "Every step has an on-chain deadline", "ok"], ["Your money", "Penalized, refunded automatically", "ok"]],
  },
  {
    id: "honest",
    label: "Does the job honestly",
    plain: [["Payment", "Settled", "ok"], ["What ran", "Unknown", "dim"], ["Proof", "None", "dim"], ["Your money", "Spent, on trust", "dim"]],
    hm: [["Payment", "Held in escrow, then paid out", "ok"], ["What ran", "Pinned model, answer sealed on chain", "ok"], ["Check", "Sampled re-run agrees", "ok"], ["Your money", "Paid for work you can verify", "ok"]],
  },
];

function GapDemo() {
  const [i, setI] = useState(0);
  const c = CHEATS[i];
  const col = (title: string, sub: string, rows: Row[], us: boolean) => (
    <div className={`gap-col${us ? " us" : ""}`}>
      <div className="gap-col-head">
        <strong>{title}</strong>
        <span className="mono dim small">{sub}</span>
      </div>
      <ul key={c.id}>
        {rows.map(([k, v, t], n) => (
          <li key={k} className={`t-${t}`} style={{ animationDelay: `${n * 90}ms` }}>
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
        {col("Payment only", "x402 today", c.plain, false)}
        {col("Payment + Hallmark", "same request, checked", c.hm, true)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ economics */
function BondCalculator() {
  const [p, setP] = useState(30);
  const [pi, setPi] = useState(50);
  const fee = 0.2;
  const c = 0.15;
  const bond = Math.max(0.1, c / ((p / 100) * (pi / 100)) - fee);
  const gain = c - (p / 100) * (pi / 100) * (bond + fee);
  return (
    <div className="calc">
      <div className="calc-row">
        <label htmlFor="p">Share of jobs re-run</label>
        <input id="p" type="range" min={5} max={100} value={p} onChange={(e) => setP(Number(e.target.value))} />
        <output>{p}%</output>
      </div>
      <div className="calc-row">
        <label htmlFor="pi">Chance a re-run exposes the cheat</label>
        <input id="pi" type="range" min={5} max={100} value={pi} onChange={(e) => setPi(Number(e.target.value))} />
        <output>{pi}%</output>
      </div>
      <div className="calc-out">
        <div>
          <span className="k">Bond the operator must lock</span>
          <span className="v">{bond.toFixed(2)} HBAR</span>
        </div>
        <div className="gauge" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (bond / 4) * 100)}%` }} />
        </div>
        <div>
          <span className="k">Expected profit from cheating</span>
          <span className={`v ${gain <= 0.0001 ? "ok" : "bad"}`}>{gain <= 0.0001 ? "≤ 0 HBAR" : `${gain.toFixed(3)} HBAR`}</span>
        </div>
      </div>
      <p className="calc-note">Example job: fee 0.20 HBAR, compute saved by cheating 0.15 HBAR. The registry refuses a model whose bond would also punish honest operators.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ usage */
const USAGE: Array<{ id: string; who: string; title: string; lang: string; code: string; note: string }> = [
  {
    id: "service",
    who: "A service",
    title: "Create a job on the contract",
    lang: "js",
    code: `import { HallmarkClient } from "@hallmark/sdk";
import { hederaTestnet as c } from "@hallmark/contracts";

const hm = new HallmarkClient({
  signer, evidenceUrl,
  contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS },
});

// you pay the contract directly and are the buyer
const job = await hm.createJob({ modelKey: "OCR_V1", input: png });
// FinalAudited, FinalUnaudited, ExecutorSlashed, ...
const v = await hm.waitForVerdict(job.jobId);
// the text is checked against the executor's on-chain commitment
const { text, commitmentMatches } = await hm.result(job);`,
    note: "No gateway, no x402. Your account pays the contract and is the buyer, so refunds come back to it.",
  },
  {
    id: "agent",
    who: "An AI agent",
    title: "Pay per request over x402",
    lang: "bash",
    code: `# discovery: prices, models, payTo
curl $GATEWAY/.well-known/hallmark.json

# the buyer agent: pays, waits for the verdict, checks the commitment
pnpm agent page.png --gateway $GATEWAY --max-price 0.5 --budget 5`,
    note: "The gateway settles the HBAR payment, creates the job with the agent as buyer, and returns a job id and a result token.",
  },
  {
    id: "contract",
    who: "A smart contract",
    title: "Act only on a checked result",
    lang: "solidity",
    code: `IHallmarkVerdict v = IHallmarkVerdict(VERDICT);

require(v.finalizedAt(jobId) != 0, "not final");
if (v.status(jobId) == IHallmarkVerdict.Verdict.FinalAudited) {
    payProvider();     // a second operator re-ran it and agreed
} else {
    refundPayer();     // slashed, refunded, voided, or never re-run
}`,
    note: "Exactly what examples/ExampleConsumer.sol does: unaudited and audit-skipped results are never treated as checked.",
  },
  {
    id: "operator",
    who: "An operator",
    title: "Stake and serve",
    lang: "bash",
    code: `npx hallmark-operator init ./node     # .env, compose file, model manifests
docker compose up -d --build           # the pinned model containers
npx hallmark-operator run              # stakes, then serves every seat it is drawn for
npx hallmark-operator status           # stake, credits, worker health`,
    note: "Earn fees and audit rewards. Lose part of the bond for not showing up, all of it for a wrong answer.",
  },
];

function Usage() {
  const [i, setI] = useState(0);
  const u = USAGE[i];
  return (
    <div className="usage">
      <div className="usage-tabs" role="tablist" aria-label="Who is integrating">
        {USAGE.map((x, n) => (
          <button key={x.id} role="tab" aria-selected={n === i} className={n === i ? "is-on" : ""} onClick={() => setI(n)}>
            <small>{x.who}</small>
            {x.title}
          </button>
        ))}
      </div>
      <div className="frame usage-code" role="tabpanel">
        <div className="frame-bar">
          <span>{u.who.toLowerCase()}</span>
          <span className="mono dim">{u.lang}</span>
        </div>
        <pre key={u.id}>
          <code>{u.code}</code>
        </pre>
        <p className="usage-note">{u.note}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ verdicts and Hedera */
const VERDICTS: Array<{ v: string; tone: Tone; line: string }> = [
  { v: "FinalAudited", tone: "ok", line: "A second operator re-ran it blind and agreed." },
  { v: "FinalUnaudited", tone: "dim", line: "Not re-run. Backed by the executor's bond." },
  { v: "ExecutorSlashed", tone: "bad", line: "Found wrong. Bond slashed, you are refunded." },
  { v: "Refunded / Voided", tone: "dim", line: "Nobody delivered. You get your money back." },
];

const HEDERA = [
  { k: "PRNG precompile", title: "A draw nobody can rig", line: "The re-run is drawn from Hedera's native randomness after the answer is sealed, in a call contracts cannot make." },
  { k: "3–5 s finality", title: "Disputes end in minutes", line: "Commit, reveal and challenge windows of a few minutes are safe because every step is final in seconds." },
  { k: "Fixed USD fees", title: "Checks you can afford per request", line: "Escrow, bond locks and a share of audits fit inside a sub-cent request price." },
  { k: "One ledger", title: "Payment and proof together", line: "x402 settlement, the job, bonds, slashes and refunds are all Hedera transactions, linked by job id." },
];

export function Landing() {
  return (
    <Shell page="home">
      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <p className="eyebrow">Verified AI inference · live on Hedera testnet</p>
            <h1>
              x402 moves the money. <em>Hallmark proves the work.</em>
            </h1>
            <p className="lede">
              When an agent pays for inference, nothing proves the model actually ran. Hallmark puts a bond behind every answer, re-runs a random
              sample blind, and slashes the operator if it lied. You get the answer, or your money back.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary btn-xl" href="/console">
                Run a verified job <Arrow />
              </a>
              <a className="btn btn-ghost btn-xl" href="/docs">
                Integrate in ten lines
              </a>
            </div>
            <dl className="facts">
              <div>
                <dt>Every answer</dt>
                <dd>backed by a bond</dd>
              </div>
              <div>
                <dt>A random sample</dt>
                <dd>re-run blind</dd>
              </div>
              <div>
                <dt>Caught cheating</dt>
                <dd>slashed, you're refunded</dd>
              </div>
            </dl>
          </div>
          <div className="frame hero-visual">
            <div className="frame-bar">
              <span>one job, end to end</span>
              <span className="mono dim">live on testnet</span>
            </div>
            <FlowDiagram width={660} height={480} nodes={jobNodes} edges={jobEdges} steps={jobSteps} label="A job: you pay into escrow, a bonded executor commits, a sample is re-run blind by a verifier, a committee decides mismatches, and you get the answer or a refund." />
          </div>
        </div>
      </section>

      <section className="sec" id="problem">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">The problem</p>
            <h2>An API can take your money and skip the work.</h2>
            <p>
              x402 lets agents pay any API per request, and confirms the money moved. It can't tell you which model answered, or whether anything ran
              at all. Pick what the provider does:
            </p>
          </div>
          <GapDemo />
        </div>
      </section>

      <section className="sec" id="solution">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">The solution</p>
            <h2>Bond every answer. Re-run a sample. Slash the liars.</h2>
            <p>Three rules, enforced by contracts on Hedera. No trusted provider, no trusted hardware.</p>
          </div>
          <div className="pillars">
            <article>
              <span className="pillar-n">1</span>
              <h3>Skin in the game</h3>
              <p>Before it touches your job, the operator locks a bond. It commits to a sealed answer before anyone can see another.</p>
            </article>
            <article>
              <span className="pillar-n">2</span>
              <h3>Checked by surprise</h3>
              <p>After the answer is sealed, Hedera's randomness picks which jobs a second operator re-runs blind. The cheater can't know in advance.</p>
            </article>
            <article>
              <span className="pillar-n">3</span>
              <h3>Lying costs more than it saves</h3>
              <p>A wrong answer loses the whole bond, and you get the full price back. Bonds are sized so cheating loses money on average.</p>
            </article>
          </div>

          <div className="verdicts">
            <p className="mono dim small">What you get back: a verdict any contract can read</p>
            <div className="verdict-row">
              {VERDICTS.map((x) => (
                <div key={x.v} className={`verdict t-${x.tone}`}>
                  <code>{x.v}</code>
                  <span>{x.line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="split econ">
            <div>
              <h3 className="sub-h">Cheating has to lose money. Here's the math.</h3>
              <p className="dim">The bond must outweigh what a cheat saves, discounted by how rarely it gets caught. The registry checks both bounds before a model goes live.</p>
              <div className="formula">
                <span>bond ≥ saved ÷ (re-run share × catch rate) − fee</span>
                <span>bond ≤ margin ÷ (re-run share × false alarms)</span>
              </div>
            </div>
            <div className="frame">
              <div className="frame-bar">
                <span>bond calculator</span>
              </div>
              <BondCalculator />
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="architecture">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">The architecture</p>
            <h2>One core. Any way in.</h2>
            <p>The contracts, operators and model manifests are the protocol. The x402 gateway, the SDK and other contracts are just ways to reach it.</p>
          </div>
          <div className="frame">
            <FlowDiagram width={1000} height={460} nodes={archNodes} edges={archEdges} steps={archSteps} stepMs={2600} label="Clients (an x402 agent through the gateway, a service with the SDK, a smart contract reading verdicts) reach the Hallmark core; the core draws bonded operators who run pinned model containers and read inputs from the evidence store." />
          </div>
          <div className="layers">
            <div>
              <h3>Core</h3>
              <p>Hallmark, ModelRegistry, HallmarkJudge and HallmarkVerdict on Hedera. Escrow, bonds, random draws, committee, slashing, refunds.</p>
            </div>
            <div>
              <h3>Operators and models</h3>
              <p>Bonded nodes run each model in a container pinned by digest. A model is a manifest; adding one means measuring it, not changing code.</p>
            </div>
            <div>
              <h3>Clients</h3>
              <p>The x402 gateway for agents, @hallmark/sdk for services, IHallmarkVerdict for contracts, and the console you can try now.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="usage">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">Usage</p>
            <h2>Ten lines to a verified job.</h2>
            <p>
              Pick who you are. Full guide in the <a href="/docs">docs</a>.
            </p>
          </div>
          <Usage />
        </div>
      </section>

      <section className="sec" id="hedera">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">Why Hedera</p>
            <h2>Fair randomness, fast finality, cheap fees.</h2>
            <p>A sampled check only works if the draw can't be rigged, disputes end quickly, and the record is public.</p>
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

      <section className="sec" id="honest">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">What it doesn't claim</p>
            <h2>It proves the model ran. Not that the model is right.</h2>
          </div>
          <ul className="claims">
            <li>
              <strong>Fidelity, not truth.</strong> A verdict says the output matches the pinned model. Each model's measured error rate is published
              in its manifest.
            </li>
            <li>
              <strong>A sample, not every job.</strong> Only <code>FinalAudited</code> means a second operator re-ran it. The rest is backed by the
              bond.
            </li>
            <li>
              <strong>Not private.</strong> Operators read the input to do the work. Don't send what they must not see.
            </li>
          </ul>
        </div>
      </section>

      <section className="sec close">
        <div className="wrap close-in">
          <h2>Stop trusting. Start checking.</h2>
          <p>Pay for a real job from a Hedera testnet wallet and follow every step on HashScan.</p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-xl" href="/console">
              Run a verified job <Arrow />
            </a>
            <a className="btn btn-ghost btn-xl" href={hashscan(CORE)} target="_blank" rel="noreferrer">
              See the contract
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
