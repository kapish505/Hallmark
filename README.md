# Hallmark

**Pay-per-request OCR and speech-to-text from bonded, untrusted operators. A random sample of jobs is re-run by a second
operator. A failed check slashes the operator and refunds the buyer.** Payments are x402 on Hedera; the escrow, bonds and
record are Hedera smart contracts.

> **Status (2026-11-06): contracts deployed and verified on Hedera testnet; G2 passed; no model registered, no paid job yet.** There is no
> settled Hedera transaction id yet and no measured model numbers. Every protocol number below is tagged
> **assumed** until gates G2 and G3 replace it. See [Honest status](#honest-status).

Built for ETHGlobal Mumbai 2026, primary track: Hedera "AI Agents That Pay: x402 on Hedera".

## The problem

An agent paying per call for transcription or OCR has no way to know that the operator ran the model it advertised, instead
of a cheaper one, a truncated run, or random text. Re-running everything doubles the cost. Hallmark re-runs a random sample,
makes the operators post bonds, and sizes the bond so that cheating loses money in expectation.

## What a Hallmark result shows

| Claim | Status |
|---|---|
| The pinned model, settings and input were used | Yes, checked on a random sample (and on challenge) |
| The delivered output is the output the operator committed to | Yes (the buyer agent re-checks the salted commitment) |
| The output is correct | **Faithful to the pinned model, whose measured error rate is x%** (not measured yet: see [ACCURACY.md](docs/ACCURACY.md)). Machine-checked by a validator where the buyer supplied one. Never "correct" without that qualifier. |
| Inputs and outputs stay private from operators | **No on the standard route.** The private route (TEE) is **not shipped**: gate G6 has not run. |
| Third parties can test a guessed output against the chain | **No.** Outputs are committed with a per-job salt (add-on A1); only the hash of the salt is on chain. Tolerance-class disputes publish text and salt. |
| Different GPU or CPU models agree bit for bit | **No.** One hardware class per pool. |
| Replaces proof of work or proof of stake | **No.** |

A failed validator is not the operator's fault, so it never causes a slash or a refund. A TEE break (if a private route is
ever shipped) would leak silently, and no bond could cover it.

## How it works

```
 Buyer agent --x402 (HBAR)--> GATEWAY --createJob(saltCommit)+price--> HEDERA CONTRACTS
   (spend limits)            (Express)                                  Hallmark + ModelRegistry + HallmarkJudge
        ^                       | salt, input, outputs (buyer / role operators / watchers only)
        | result + badge        v
        +------------------ EVIDENCE STORE <---- OPERATORS (executor, verifier, committee; pinned containers)
```

Lifecycle (the order matters):

1. The agent reads `/.well-known/hallmark.json`, calls `POST /v1/transcribe` (16 kHz mono WAV) or `POST /v1/ocr` (PNG), gets a
   402, checks `payTo`, asset and amount against the manifest and its spend policy, and pays with no human approval.
2. The handler validates the input and returns **202** with the jobId and a private access token. After settlement shows
   SUCCESS on the Mirror Node, the gateway calls `createJob{value: price}` with the hash of a fresh job salt.
3. The contract draws the **executor** (stake-weighted, Hedera PRNG) and locks its bond. The executor checks the salt against
   the chain, runs the pinned model, normalizes, saves `{output, salts}` to disk, then **commits** (output hidden).
4. **After the commit**, anyone calls `drawAudit` (EOA only, so a wrapper contract cannot re-roll it).
5. Not audited: the executor reveals; a challenge window opens; then `settle`.
6. Audited: a **verifier** is drawn, locks a bond and **commits blind**. Both reveal. Equal commitments agree. In the tolerance
   class, differing outputs post their text and the contract computes word overlap against tau.
7. Mismatch: a **committee** re-runs blind and a majority decides who is slashed. Every stalled stage has an `expire` path that
   refunds the buyer and penalizes only the party that did not show up.

Badges: `provisional (unaudited, bond-backed)`, `audited (re-run agreed)`, `disputed`, `slashed`, `refunded`, `audit skipped`.

## Payment flow (x402 on Hedera)

`scheme exact`, `network hedera:testnet` (not `eip155:296`), asset `0.0.0` (HBAR), amount in tinybar, `maxTimeoutSeconds 30`,
`payTo` = the gateway account, facilitator Blocky402 with fallbacks Ax402 then x402.org. Verify, then the handler (a non-2xx
cancels settlement), then settle, then `onAfterSettle`, then a Mirror Node SUCCESS check, then `createJob`. If `createJob`
reverts, the payer is refunded over HAPI.

**Settled transaction id: none yet** (G1 has not run). It goes here with its HashScan link.

## Trust assumptions

| ID | Assumption | If it fails |
|---|---|---|
| T1 | The gateway holds the buyer's payment between x402 settlement and `createJob`, serves inputs, and holds job salts | It could delay or withhold funds, or leak salts. Hash binding protects integrity; refunds cover failed creation. |
| T2 | A majority of the committee (and the verifier) is honest | Colluding verifiers could fake a verdict. With attacker share s of stake, executor and verifier both being the attacker's is about s². |
| T3 | Hedera ordering and a JSON-RPC relay | Delays. Hashio is dev and test only. |
| T4 | The contract owner key | The owner could change parameters. Changes are bounded and emit events; running jobs keep a snapshot. |
| T5 | Mirror Node REST for reads | UI lag only. |
| T6 | Operators' output text is held by the evidence store and the gateway | Not private from the job's operators, the gateway or listed watchers. Stated plainly. |

More in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## The core model

```
Deterrence:  B >= c / (p * pi) - F     (worst cheat)        Fairness:  B <= m / (p * fp)
```

Our own derivation, not from a paper: [docs/CORE_MODEL.md](docs/CORE_MODEL.md). `ModelRegistry.setModel` and `createJob`
revert if the window is empty. With the **assumed** inputs in [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) at p = 30%
(assumed): ASR floor 0.8 HBAR, no ceiling (fp assumed 0); OCR floor 0.344 HBAR, ceiling 26.7 HBAR. These are illustrations,
not measurements. `pnpm simulate --sweep` prints the window for other audit rates.

| Number | Value | Tag |
|---|---|---|
| Hallmark runtime size | 23,530 B (cap 24,576) | measured (`forge build --sizes`, via-IR) |
| Overlap gas, 96 × 96 words | 707,636 | measured, local EVM only |
| Honest agreement s, fp, every pi and c' | not yet | G3 |
| Pinned-model WER / CER | not yet | G3 + A2 |
| Gas price on testnet | 126 tinybar per gas unit; confirmation about 7 s | measured (G2) |
| Fee per job, latency per job | not yet | testnet e2e |
| Audit rate 30%, fees, minBond | defaults | assumed / [DEMO] |

## Add-ons (privacy and accuracy)

| Add-on | Status |
|---|---|
| A1 Salted output commitment | **Shipped** (contracts, operators, gateway, agent, verifier, tests) |
| A2 Measured accuracy report | **Built**: `calibrate.ts` computes corpus WER/CER with a bootstrap 95% CI; registry fields `expectedErrorBps`, `errorSampleSize`. **Not measured** (needs G3). |
| A3 Buyer validators | **Shipped**: `none`, `min_words:<n>`, `date_iso`, `amount_present`, `invoice_total` (OCR uses NORM_OCR_V1B, which keeps `.`/`,` between digits). Advisory, no money effect. |
| A4 Canary jobs | **Not shipped** (cut first, per the add-on's cut order) |
| A5 Private route (TEE) | **Not shipped**: gate G6 needs a real TEE host and attestation verification, which were not available. No attestation is faked. |

## Repository

```
contracts/      Hallmark.sol, ModelRegistry.sol, HallmarkJudge.sol, libs/{TextNorm,Overlap,BondMath}.sol, Probe.sol
                test/ (unit, fuzz, invariant, reentrancy, wrapper re-roll, TS parity vectors)  script/Deploy.s.sol
                flat/ (single-file sources for Remix)   DEPLOY_REMIX.md
packages/
  shared/       units, normalization (ASR, OCR V1B), overlap, bond math, commitments, validators, types, x402 helpers
  gateway/      x402 routes, job salts, settlement check, createJob, refunds, indexer, keeper, evidence store, SSE
  operator/     orchestrator for executor/verifier/committee, challenger bot, worker/asr + worker/ocr (pinned containers)
  buyer-agent/  CLI + library with spend policy and commitment check
  verifier/     hallmark-verify <jobId> [--token]
  simulator/    bond window from MEASUREMENTS.md
  web/          Job, Network, Core model, Attack lab
scripts/        calibrate.ts (G3 + A2), probe-hedera.ts (G2), probe-facilitators.ts (G1), e2e-testnet.ts, measure.ts,
                gen-vectors.ts, gen-abi.ts, local/ (anvil harness, fakes, full local e2e)
docs/           ARCHITECTURE, CORE_MODEL, THREAT_MODEL, MEASUREMENTS, ACCURACY, DECISIONS, PRIOR_ART, gates/G0-G6
```

## How to run

```bash
pnpm install
pnpm setup:contracts          # forge-std 1.9.4 + OpenZeppelin 5.1.0
cd contracts && forge build && forge test && cd ..
pnpm gen:abi && pnpm test      # Vitest (spawns anvil for the integration tests)
pnpm e2e:local                 # full stack on anvil with a fake facilitator and fake workers (not testnet evidence)
pnpm simulate --sweep
```

Testnet (after kickoff, in this order): G0 accounts → deploy per [contracts/DEPLOY_REMIX.md](contracts/DEPLOY_REMIX.md) →
G1/G2 probes → build and pin the workers (`docker compose build`) → G3 `pnpm calibrate` → `setModel` with measured values →
start the gateway (`pnpm gateway`), at least 5 operators (`pnpm operator`) and the challenger (`pnpm challenger`) with
`env/*.env` from the examples → `tsx scripts/e2e-testnet.ts all --clip clip.wav --image page.png` → `pnpm measure`.

Agent: `pnpm agent clip.wav --gateway <url> --max-price 0.5 --budget 5 [--validator date_iso] [--require-final]`.

## Degraded modes

| Situation | Behavior | Shown as |
|---|---|---|
| PRNG precompile unavailable | Falls back to prevrandao + blockhash | `AuditDrawn(prng=false)`, "weaker" in the verifier |
| No verifier shows up twice | Settles unaudited | `audit skipped` badge |
| Committee cannot reach a majority | Refund, no slash for being wrong | `refunded` |
| Too few eligible operators | 503 before payment | manifest `available: false` |
| Facilitator down | Next facilitator; never a mock | gateway log |
| Model error rate not measured | Shown as "not measured yet" | result, manifest, UI |
| `committeeSize = 1` | Allowed for small demos; not Byzantine-safe | Network page warning |

## Honest status

- Tests (local only): Foundry, Vitest and the full local e2e. Counts and results are in [docs/e2e/local-e2e.json](docs/e2e/local-e2e.json)
  and the summary at the end of this file.
- **Done on testnet:** deployment, Sourcify verification, G2 probe.
- **Not done:** a paid x402 job, G1 payment, G3 to G6, real model determinism and catch rates, the accuracy numbers, the demo video, the S1 to S7 extras, canaries (A4), the private route (A5).
- `lazy-small-model` and `lazy-engine` catch rates depend on the workload. The testnet e2e reports misses as misses.

## Prior art

Not novel in mechanism. EigenAI, Gensyn Verde, Proof of Sampling, TOPLOC, DiFR, CommitLLM, VeriLLM, and Rerun (ETHGlobal
Lisbon) are close; see [docs/PRIOR_ART.md](docs/PRIOR_ART.md) (links to be re-checked). What Hallmark adds: x402 payment on
Hedera joined to bonded, sampled verification, with the bond sized from measured detection and false-alarm rates for OCR and
speech.

## Roadmap (future scope, no code)

Other model types (LLMs, image, video), canary jobs, a TEE private route, zk proofs for small models, HCS audit log (S1),
0G Storage evidence (S2).

## AI usage, third-party code, process

See [AI_USAGE.md](AI_USAGE.md) and [THIRD_PARTY.md](THIRD_PARTY.md). Parts of the code were carried over from a prototype
written before the official kickoff. They are listed in [docs/DECISIONS.md](docs/DECISIONS.md#process-note-disclosure).

## Contracts (Hedera testnet, chain 296)

| Contract | Address |
|---|---|
| Hallmark | [`0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4`](https://hashscan.io/testnet/contract/0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4) |
| ModelRegistry | [`0x252A9478e703524aFe022C407e6C61ee27633282`](https://hashscan.io/testnet/contract/0x252A9478e703524aFe022C407e6C61ee27633282) |
| HallmarkJudge | [`0x883b674a9050bf8e1531116A3AA524b08983bd46`](https://hashscan.io/testnet/contract/0x883b674a9050bf8e1531116A3AA524b08983bd46) |

Deployed 2026-11-06 and verified on Sourcify (exact match); details and transactions: [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).
No models are registered yet (waiting for G3).

## Name

"Hallmark" is also a greeting-card brand; a name collision check is still to do.

## Team

_to fill in_

## Local test summary (2026-11-06, local only: not testnet evidence, not measurements)

- **Foundry 47/47**: lifecycle and every revert path, salted commitments (dictionary test, wrong salt), wrapper-contract
  re-roll blocked, invariants (conservation, escrow = open jobs, locked = operators' locked, terminal is final), reentrancy,
  normalization and overlap fuzz, TS to Solidity parity vectors (96 normalization, 60 overlap, 60 bond cases).
- **Vitest 51/51**: normalization, bond math, units, validators (including adversarial input), spend policy, gateway x402 flow on
  anvil (replay x20, no-store, settle failure, createJob revert to refund, private evidence, validator whitelist, 503 before
  payment), operator crash recovery and wrong-salt refusal.
- **Local e2e 25/25** (`pnpm e2e:local`, anvil + fake facilitator + fake workers): honest ASR and OCR, validators (pass, and fail
  with no money effect), audited agree, garbage, replay-other-input, lazy-small-model, truncate, silent, no-reveal, tolerance
  honest variation, tolerance garbage, verifier no-show, inconclusive refund, collusion + challenge, false challenge, no capacity,
  payment replay x20, and the independent verifier on six jobs. Contract balance equals accounted liabilities.
  In the recorded run, the collusion scenario drew **both** colluders as executor and verifier, so the fake settled and the
  challenger lost its bond: the s² residual risk of T2, shown as it happened.
