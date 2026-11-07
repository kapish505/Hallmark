import { useEffect, useState, type ReactNode } from "react";
import { CORE, hashscan, JUDGE, REGISTRY, REPO, Shell, VERDICT } from "./Shell";

const SECTIONS: Array<[string, string]> = [
  ["overview", "Overview"],
  ["quickstart", "Quickstart"],
  ["addresses", "Contracts"],
  ["verdicts", "Verdicts"],
  ["direct", "Direct jobs"],
  ["x402", "x402 path"],
  ["contracts", "From a contract"],
  ["missing", "Missing inputs"],
  ["operator", "Run an operator"],
  ["model", "Add a model"],
  ["limits", "Limits"],
];

function Code({ lang, children }: { lang: string; children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="doc-code">
      <div className="doc-code-bar">
        <span>{lang}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(children).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Docs() {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-20% 0px -70% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <Shell page="docs">
      <div className="wrap docs">
        <aside className="doc-toc" aria-label="On this page">
          <p className="mono dim small">Integration guide</p>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? "is-on" : ""}>
              {label}
            </a>
          ))}
          <a className="doc-gh" href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">
            Full docs on GitHub ↗
          </a>
        </aside>

        <article className="doc-body">
          <p className="eyebrow">Docs · 0.x alpha · Hedera testnet</p>
          <h1 className="page-h1">Integrate Hallmark</h1>
          <p className="lede">Ask the bonded pool for work and get a verdict you can check. Two ways in, one result.</p>

          <Sec id="overview" title="Overview">
            <div className="doc-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Direct (core)</th>
                    <th>x402 gateway</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Who calls createJob</td>
                    <td>Your account</td>
                    <td>The gateway, after your payment settles</td>
                  </tr>
                  <tr>
                    <td>You pay</td>
                    <td>The contract, in HBAR</td>
                    <td>The gateway, over x402</td>
                  </tr>
                  <tr>
                    <td>You need</td>
                    <td>An EVM key with testnet HBAR, @kapish505/hallmark-sdk</td>
                    <td>An x402 client with a Hedera account</td>
                  </tr>
                  <tr>
                    <td>Best for</td>
                    <td>Services, backends, pipelines</td>
                    <td>AI agents that already speak x402</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Both paths create the same on-chain job: an executor runs the pinned model and commits a sealed answer, a random sample is re-run blind,
              and the verdict is final on Hedera. Models live today: <code>ASR_V1</code> (16 kHz mono WAV, up to 15 s) and <code>OCR_V1</code> (PNG,
              printed ASCII text).
            </p>
          </Sec>

          <Sec id="quickstart" title="Quickstart">
            <p>
              The packages are 0.x alpha on npm under <code>@kapish505</code> (the <code>@hallmark</code> scope belongs to someone else):
            </p>
            <Code lang="bash">{`npm install @kapish505/hallmark-sdk @kapish505/hallmark-contracts ethers`}</Code>
            <Code lang="js">{`import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { HallmarkClient } from "@kapish505/hallmark-sdk";
import { hederaTestnet as c } from "@kapish505/hallmark-contracts";

const signer = new Wallet(process.env.KEY, new JsonRpcProvider("https://testnet.hashio.io/api", 296));
const hm = new HallmarkClient({ signer, contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS }, evidenceUrl: process.env.EVIDENCE_URL });
const job = await hm.createJob({ modelKey: "OCR_V1", input: readFileSync("receipt.png") });
const v = await hm.waitForVerdict(job.jobId);
console.log(v.verdict, (await hm.result(job)).text);`}</Code>
            <p>
              <code>EVIDENCE_URL</code> is the evidence store of the pool, served by the Hallmark gateway. This exact example passed on testnet from a
              fresh install, with a <code>FinalAudited</code> verdict.
            </p>
          </Sec>

          <Sec id="addresses" title="Contracts on Hedera testnet (chain 296)">
            <div className="doc-table">
              <table>
                <tbody>
                  {[
                    ["Hallmark", CORE, "escrow, bonds, draws, audits, committee, slashing"],
                    ["HallmarkVerdict", VERDICT, "IHallmarkVerdict: what other contracts read"],
                    ["ModelRegistry", REGISTRY, "models: anyone proposes, the owner enables"],
                    ["HallmarkJudge", JUDGE, "on-chain normalization check and word overlap"],
                  ].map(([n, a, d]) => (
                    <tr key={n}>
                      <td>{n}</td>
                      <td>
                        <a className="mono" href={hashscan(a)} target="_blank" rel="noreferrer">
                          {a}
                        </a>
                      </td>
                      <td className="dim">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dim">All four are verified on Sourcify (exact match). RPC: https://testnet.hashio.io/api. Hedera reserves gas limit × gas price up front, so keep gas limits tight.</p>
          </Sec>

          <Sec id="verdicts" title="Verdicts">
            <div className="doc-table">
              <table>
                <thead>
                  <tr>
                    <th>Verdict</th>
                    <th>Meaning</th>
                    <th>Checked?</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["FinalAudited", "A second operator re-ran it blind and agreed, or a committee upheld it", "Yes"],
                    ["FinalUnaudited", "Settled without a re-run; backed by the executor's bond", "No"],
                    ["AuditSkipped", "A re-run was drawn but no verifier could be seated", "No"],
                    ["ExecutorSlashed", "Found wrong: bond slashed, buyer refunded in full", "Yes"],
                    ["Refunded", "No-show or an undecided committee: buyer refunded", "n/a"],
                    ["Voided", "Two executors reported the input missing: refunded minus the void fee", "n/a"],
                  ].map(([v, m, c]) => (
                    <tr key={v}>
                      <td>
                        <code>{v}</code>
                      </td>
                      <td>{m}</td>
                      <td className={c === "Yes" ? "ok-text" : "dim"}>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>A verdict is final once <code>finalizedAt(jobId) != 0</code>, and never changes after that.</p>
          </Sec>

          <Sec id="direct" title="Direct jobs: what createJob does">
            <ol className="doc-steps">
              <li>Quotes the price from the contract; refuses before paying if the pool can't take the job.</li>
              <li>Picks a random job id and job salt.</li>
              <li>
                Registers the input with the evidence store, signed by your key: <code>POST /v1/core/jobs</code>. The store checks the input against the
                model's media rules and returns a locator and a result token.
              </li>
              <li>
                Calls <code>Hallmark.createJob(jobId, you, inputHash, keccak(salt), modelId, locator)</code> from your account with the price.
              </li>
            </ol>
            <Code lang="http">{`POST {EVIDENCE_URL}/v1/core/jobs
{ "jobId": "0x…", "modelId": "0x…", "jobSalt": "0x…", "buyer": "0xYou",
  "input": "<base64>",
  "signature": sign("hallmark-register:<jobId>:<inputHash>:<keccak(salt)>:<modelId>:<buyer>") }

→ 201 { "locator": "https://…", "accessToken": "…", "inputHash": "0x…", "priceTinybar": "9500000" }

GET {EVIDENCE_URL}/v1/jobs/{jobId}/result      Authorization: Bearer <accessToken>
→ 200 { "text": "…", "outCommit": "0x…", "jobSalt": "0x…", "final": true, "badge": "…" }`}</Code>
            <p>
              <code>waitForVerdict</code> polls the verdict and, by default, advances the job when a step is due (<code>drawAudit</code>,{" "}
              <code>settle</code>, <code>expire</code>). Anyone may call those. <code>result()</code> recomputes the salted commitment and tells you if
              the text is what the executor committed to.
            </p>
          </Sec>

          <Sec id="x402" title="The x402 path">
            <Code lang="bash">{`curl $GATEWAY/.well-known/hallmark.json        # models, prices, payTo, endpoints
POST $GATEWAY/v1/ocr          (multipart: file)  # 402 → pay → 202 { jobId, accessToken }
POST $GATEWAY/v1/transcribe   (multipart: file)
GET  $GATEWAY/v1/jobs/{jobId}/result             # with the access token`}</Code>
            <Code lang="js">{`import { viaX402 } from "@kapish505/hallmark-sdk";
// fetchWithPayment = wrapFetchWithPayment(fetch, x402Client) from @x402/fetch, with a Hedera signer
const job = await viaX402({ gatewayUrl, endpoint: "/v1/ocr", input, filename: "page.png", fetchWithPayment });
const v = await hm.waitForVerdict(job.jobId);`}</Code>
            <p>The repo's buyer agent adds a spend policy and checks the on-chain input hash and commitment for you:</p>
            <Code lang="bash">{`pnpm agent page.png --gateway $GATEWAY --max-price 0.5 --budget 5`}</Code>
          </Sec>

          <Sec id="contracts" title="From a smart contract">
            <Code lang="solidity">{`import {IHallmarkVerdict} from "@kapish505/hallmark-contracts/src/IHallmarkVerdict.sol";

IHallmarkVerdict v = IHallmarkVerdict(${VERDICT});
if (v.finalizedAt(jobId) != 0 && v.status(jobId) == IHallmarkVerdict.Verdict.FinalAudited) {
    // checked by a second operator
}`}</Code>
            <p>
              <code>examples/ExampleConsumer.sol</code> is an escrow that pays a provider only on <code>FinalAudited</code> and refunds otherwise. A
              contract may call <code>createJob</code> itself (buyer = the contract), but input registration needs a signature from the buyer's key,
              and contract signatures (EIP-1271) aren't supported yet. Today an EOA or service creates the job and passes the id on.
            </p>
          </Sec>

          <Sec id="missing" title="If your input isn't there">
            <p>
              If the drawn executor can't fetch or verify the input or salt, it reports it once and the contract draws another executor. If that one
              finds it, the false claim is penalized. If it doesn't, the job is <code>Voided</code>: you get the price back minus the void fee (0.02 HBAR
              today), split between the two executors. Register before you create.
            </p>
          </Sec>

          <Sec id="operator" title="Run an operator">
            <Code lang="bash">{`npm install -g @kapish505/hallmark-operator
npx hallmark-operator init ./node      # writes .env, docker-compose.yml, models/
cd node && docker compose up -d --build
npx hallmark-operator run               # registers with STAKE_TINYBAR, then serves seats
npx hallmark-operator status`}</Code>
            <p>
              Fill <code>OPERATOR_PRIVATE_KEY</code> and <code>GATEWAY_URL</code> in <code>.env</code>. Run the same image digest and hardware class as the
              rest of the pool: an honest run on different hardware can disagree and be penalized. Fees and rewards accrue as credits; withdraw with{" "}
              <code>Hallmark.withdraw()</code>.
            </p>
          </Sec>

          <Sec id="model" title="Add a model">
            <p>A model is a JSON manifest. Adding one means measuring it, not changing code.</p>
            <Code lang="bash">{`hallmark-calibrate models/my-model.json ./dataset --workers http://a:9000,http://b:9000 --honest-cost-tinybar 4000000
hallmark-models propose models/my-model.calibrated.json      # anyone; stored disabled
hallmark-models enable  models/my-model.calibrated.json      # registry owner; pinned to the proposal hash`}</Code>
            <p>
              Calibration re-runs every input many times on several machines, measures how often cheats are caught, and computes the bond window. It
              refuses to emit an enabled manifest if honest runs disagree too much or no bond both deters cheats and spares honest operators.
            </p>
          </Sec>

          <Sec id="limits" title="Limits">
            <ul className="doc-list">
              <li>It checks fidelity to the pinned model, not whether the answer is true.</li>
              <li>Only a sample is re-run. Treat only FinalAudited as checked.</li>
              <li>Not private: operators read the input.</li>
              <li>One hardware class per pool. Calibration so far: 8 inputs on one machine.</li>
              <li>Testnet only. Contracts verified on Sourcify, not audited.</li>
            </ul>
          </Sec>
        </article>
      </div>
    </Shell>
  );
}
