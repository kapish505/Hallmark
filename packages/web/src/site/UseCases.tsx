import { Arrow, Shell } from "./Shell";

const CASES: Array<{ tag: string; live: boolean; title: string; pain: string; fix: string; result: string }> = [
  {
    tag: "Agent marketplaces",
    live: true,
    title: "Agents can buy from providers they've never met",
    pain: "An agent paying per request has no way to tell a real answer from a cheap or replayed one, and no one to complain to.",
    fix: "Every paid answer has a bonded operator behind it and a random blind re-run. Wrong answers are slashed automatically.",
    result: "Agents spend without a person watching. Bad providers lose money instead of winning business.",
  },
  {
    tag: "Document pipelines",
    live: true,
    title: "Invoices and receipts read before money moves",
    pain: "An OCR step that quietly runs a cheaper engine misreads totals, and the error flows straight into payments and books.",
    fix: "Read each document through the pinned OCR model. Only auto-approve on FinalAudited; route everything else to review.",
    result: "A checkable record of what read every document, with a refund when the reading was faked.",
  },
  {
    tag: "Transcription records",
    live: true,
    title: "Transcripts you can show were produced by the stated model",
    pain: "Calls, interviews and voice notes get transcribed by whoever is cheapest. Later nobody can show which model produced the record.",
    fix: "Each transcript is committed on chain against the pinned Whisper model, with a public verdict and its measured error rate.",
    result: "An audit trail for every transcript, and a refund if the provider cut corners.",
  },
  {
    tag: "On-chain escrow and bounties",
    live: true,
    title: "Contracts that pay only for checked work",
    pain: "A smart contract can't see off-chain AI work, so bounties and escrows end up trusting whoever reports the result.",
    fix: "The contract reads IHallmarkVerdict: pay on FinalAudited, refund on everything else. ExampleConsumer.sol does exactly this.",
    result: "AI work becomes something a contract can settle on, without an oracle you have to trust.",
  },
  {
    tag: "Model providers",
    live: true,
    title: "Prove you serve the model you advertise",
    pain: "Honest providers can't prove they run the full model, so they compete on price with those who don't.",
    fix: "Run as a bonded operator. Every job you serve leaves a public commit, re-run and settlement on Hedera.",
    result: "A track record built from on-chain evidence, not marketing claims.",
  },
  {
    tag: "Data labeling",
    live: false,
    title: "Pay per item, checked on a sample",
    pain: "Large labeling and extraction jobs are paid by volume, which rewards speed over doing the work.",
    fix: "Each item is a job; a random share is re-run blind. Needs a manifest for the labeling model before it goes live.",
    result: "Volume pricing with a built-in quality check and automatic clawback.",
  },
];

const BENEFITS: Array<{ who: string; items: string[] }> = [
  { who: "Buyers and agents", items: ["Escrowed payment, released only after the check window", "Full refund when an answer is found wrong", "A verdict you can verify yourself from public chain data"] },
  { who: "Operators", items: ["Earn fees and audit rewards for honest work", "A public record that you run the pinned model", "Bonds sized so honest operators aren't punished by false alarms"] },
  { who: "Builders", items: ["Create a job from any account or contract, no gateway required", "One interface for verdicts: IHallmarkVerdict", "Add a model with a manifest and a measurement, not a code change"] },
  { who: "The ecosystem", items: ["x402 payments that come with a receipt for the work", "A neutral, public record of provider quality", "Every step is a Hedera transaction anyone can open"] },
];

const OPTIONS: Array<{ name: string; trust: string; recourse: string; cost: string; today: string; us?: boolean }> = [
  { name: "Trust the provider", trust: "The provider's word", recourse: "None", cost: "1×", today: "Yes" },
  { name: "Trusted hardware (TEE)", trust: "The chip vendor and the enclave setup", recourse: "Depends on who runs it", cost: "~1×, special hardware", today: "Limited" },
  { name: "Zero-knowledge proofs", trust: "Math", recourse: "Bad proofs are rejected", cost: "Very high for real models", today: "Small models only" },
  { name: "Hallmark", trust: "A bonded second operator, drawn at random", recourse: "Slash and refund, automatic", cost: "1 + re-run share (1.3× at 30%)", today: "Yes, on Hedera testnet", us: true },
];

const MODELS: Array<{ kind: string; how: string; status: "Live" | "Next" | "Research" }> = [
  { kind: "Speech to text", how: "Pinned Whisper large-v3, normalized text, exact match", status: "Live" },
  { kind: "OCR", how: "Pinned Tesseract 5, normalized text, exact match", status: "Live" },
  { kind: "Embeddings", how: "Vectors compared by distance against a measured threshold", status: "Next" },
  { kind: "Classification", how: "Same top label on re-run; boxes compared by overlap", status: "Next" },
  { kind: "LLM text", how: "Greedy decoding, token-level checks against a re-run", status: "Research" },
  { kind: "Image generation", how: "Seeded runs compared by perceptual distance", status: "Research" },
];

export function UseCases() {
  return (
    <Shell page="use-cases">
      <section className="page-hero">
        <div className="wrap">
          <p className="eyebrow">Use cases</p>
          <h1 className="page-h1">
            If someone pays for an AI answer, <em>it should be checkable.</em>
          </h1>
          <p className="lede">
            Hallmark is useful wherever AI work is paid for and someone else does it. Speech-to-text and OCR are live today; every other model type
            needs only a measured manifest.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="cases">
            {CASES.map((c) => (
              <article key={c.tag} className="case">
                <div className="case-top">
                  <span className="mono small h-k">{c.tag}</span>
                  <span className={`status ${c.live ? "s-live" : "s-next"}`}>{c.live ? "Live today" : "Needs a manifest"}</span>
                </div>
                <h3>{c.title}</h3>
                <dl>
                  <div>
                    <dt>Without it</dt>
                    <dd>{c.pain}</dd>
                  </div>
                  <div>
                    <dt>With Hallmark</dt>
                    <dd>{c.fix}</dd>
                  </div>
                  <div>
                    <dt>Result</dt>
                    <dd className="ok-text">{c.result}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">Benefits</p>
            <h2>Everyone in the loop gets something concrete.</h2>
          </div>
          <div className="benefits">
            {BENEFITS.map((b) => (
              <article key={b.who}>
                <h3>{b.who}</h3>
                <ul>
                  {b.items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">Compared</p>
            <h2>The only option with a refund built in.</h2>
            <p>Each approach puts trust somewhere. Hallmark puts it in money at stake, and pays you back when it's broken.</p>
          </div>
          <div className="cmp-wrap frame">
            <table className="cmp">
              <thead>
                <tr>
                  <th>Approach</th>
                  <th>You trust</th>
                  <th>If the answer is wrong</th>
                  <th>Compute cost</th>
                  <th>Usable today</th>
                </tr>
              </thead>
              <tbody>
                {OPTIONS.map((o) => (
                  <tr key={o.name} className={o.us ? "us" : ""}>
                    <td>{o.name}</td>
                    <td>{o.trust}</td>
                    <td>{o.recourse}</td>
                    <td>{o.cost}</td>
                    <td>{o.today}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cmp-note">General characteristics of each approach; they can also be combined.</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="sec-head">
            <p className="chap">Which models</p>
            <h2>Any model whose output can be reproduced.</h2>
            <p>The check needs two honest runs to agree, exactly or within a measured tolerance. That decides what can go live.</p>
          </div>
          <div className="models">
            {MODELS.map((m) => (
              <div key={m.kind} className="model-row">
                <strong>{m.kind}</strong>
                <span className="dim">{m.how}</span>
                <span className={`status s-${m.status.toLowerCase()}`}>{m.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec close">
        <div className="wrap close-in">
          <h2>Got a use case? It's ten lines away.</h2>
          <div className="hero-actions">
            <a className="btn btn-primary btn-xl" href="/docs">
              Read the docs <Arrow />
            </a>
            <a className="btn btn-ghost btn-xl" href="/console">
              Try it in the console
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
