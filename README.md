# Hallmark

**Hallmark is a protocol, not an app.** Any service or contract can ask for work and get a verdict, and
bonded operators do the work. x402 on Hedera is one way to feed it. Today it is live for two model types:
speech-to-text (Whisper large-v3) and OCR (Tesseract 5).

**The claim:** verification for any model whose output we can reproduce; adding one means measuring it.
A verdict says the output matches the pinned model. It does not say the output is true.

## Try it (no wallet needed)

Open the [console](https://hallmark-two.vercel.app/console), pick speech or OCR, drop a file, and leave
**"Demo agent pays over x402"** selected: a funded testnet agent account pays the gateway over x402
(30 jobs a day), and the job runs on the real bonded pool. Or connect HashPack (x402) or MetaMask (direct
HBAR transfer) to pay yourself.

To watch the protocol catch a cheat, open **Attack lab**, pick a misbehavior (garbage, a smaller model,
truncation, a replayed answer, a no-show...), and run a job: the re-run share goes to 100% and the
receipt shows the slash and the refund. Scenarios reset to honest operators after 10 minutes. Every event
links to HashScan, and `pnpm verify <jobId>` re-derives the verdict from public chain data alone.

## The core

| Piece | What it is |
|---|---|
| Contracts | `Hallmark` (escrow, bonds, draws, audits, committee, slashing), `ModelRegistry`, `HallmarkJudge`, and `HallmarkVerdict`, which implements `IHallmarkVerdict` for other contracts to read |
| Operators | bonded nodes that run pinned model containers and serve executor, verifier and committee seats |
| Model manifests | `models/*.json`: one file per model, with every number set by calibration |
| Evidence store | holds inputs, salts and outputs for the parties of a job; checked against on-chain hashes |

Clients on top: the x402 gateway, the buyer agent, `hallmark-verify`, and the web console. Extras: the
challenger bot, canary jobs, advisory validators, and the demo attack lab.

## Ten lines: a service creates a job on the contract and reads the verdict

```js
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { HallmarkClient } from "@kapish505/hallmark-sdk";
import { hederaTestnet as c } from "@kapish505/hallmark-contracts";

const signer = new Wallet(process.env.KEY, new JsonRpcProvider("https://testnet.hashio.io/api", 296));
const hm = new HallmarkClient({ signer, contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS }, evidenceUrl: process.env.EVIDENCE_URL });
const job = await hm.createJob({ modelKey: "OCR_V1", input: readFileSync("receipt.png") }); // you pay the contract
const v = await hm.waitForVerdict(job.jobId);    // FinalAudited | FinalUnaudited | AuditSkipped | ExecutorSlashed | Refunded | Voided
console.log(v.verdict, (await hm.result(job)).text); // the text is checked against the executor's on-chain commitment
```

Only `FinalAudited` means a second operator re-ran the job; `FinalUnaudited` and `AuditSkipped` are backed
by the bond but not checked. The packages are 0.x alpha on npm: `@kapish505/hallmark-sdk`,
`-contracts`, `-operator`, `-model-spec` (built by `npx tsx scripts/pack-core.ts`; the `@hallmark` npm scope
belongs to someone else). `scripts/smoke-core.sh` installs only those packages in an empty directory and runs
this example on testnet.

Docs: [Integrate](docs/INTEGRATE.md) · [Run an operator](docs/RUN_AN_OPERATOR.md) ·
[Add a model](docs/ADD_A_MODEL.md) · [Core map](docs/CORE_MAP.md)

| | |
|---|---|
| Network | Hedera testnet (chain 296) |
| Hallmark | [`0x4Ae8e841fD17c70F9E1628e4a0121944288c46CE`](https://hashscan.io/testnet/contract/0x4Ae8e841fD17c70F9E1628e4a0121944288c46CE) |
| HallmarkVerdict | [`0x16E332bC16DB931e65cF14e28E57E80f18897be2`](https://hashscan.io/testnet/contract/0x16E332bC16DB931e65cF14e28E57E80f18897be2) |
| ModelRegistry | [`0x5902c6e3020297B6Bf47bFf050357Df9108a234f`](https://hashscan.io/testnet/contract/0x5902c6e3020297B6Bf47bFf050357Df9108a234f) |
| HallmarkJudge | [`0x7897772347d5C5F5De067FbF0129b387a9E7d069`](https://hashscan.io/testnet/contract/0x7897772347d5C5F5De067FbF0129b387a9E7d069) |

**Fresh-install smoke test on testnet (2026-11-07):** a non-gateway account created OCR job
[`0x9a0a…30f4`](https://hashscan.io/testnet/transaction/0x6f98832b4950512b88c8b35d4967a9a908b3ee56de8ea3418308df359a666918)
directly on the contract from the packed tarballs; a second operator re-ran it and the verdict is
`FinalAudited`, with the delivered text matching the executor's on-chain commitment.

All four are verified on Sourcify (exact match). The first deployment (`0xb719…d1c4`, gateway-only
`createJob`) is retired; the payment below was settled on it.

**First settled x402 payment on Hedera:** [`0.0.7162784@1793957837.218925989`](https://hashscan.io/testnet/transaction/0.0.7162784%401793957837.218925989)
(OCR job [`0xe741…b61b`](https://hashscan.io/testnet/transaction/0x67c112c5928da74ff4705fb45f67190c82e294609bd68c175ae39ebe952b717d):
created, committed, audit drawn, revealed, and [settled](https://hashscan.io/testnet/transaction/0x7849c3e2b3f210711e555d64af078fd64652d6e941362a22ecba66a344b96f2b)).

---

## Architecture

```
 Agent / wallet ──x402 (HBAR)──▶ Gateway ──createJob(saltCommit) + price──▶ Hallmark contracts (Hedera)
       ▲                           │                                         escrow · bonds · draws · slashing
       │ result + access token     │ salt, input, outputs                         │
       └───────────────────────────┤ (buyer, role operators, watchers only)       │
                                   ▼                                              ▼
                             Evidence store ◀──────────── Operators: executor · verifier · committee
                                                          (pinned Whisper / Tesseract containers)
```

### Job lifecycle

1. **Pay.** The agent reads `/.well-known/hallmark.json`, gets a 402 from `POST /v1/transcribe` or `POST /v1/ocr`,
   checks `payTo`, asset and amount against the manifest and its spend policy, and pays. The gateway waits for the
   settlement to show SUCCESS on the Mirror Node, then calls `createJob` with the hash of a fresh job salt.
2. **Commit.** The contract draws a stake-weighted **executor** with the Hedera PRNG and locks its bond. The executor
   checks the salt against the chain, runs the pinned model, and commits to a salted hash of the normalized output.
3. **Draw.** After the commit, anyone calls `drawAudit`. It is EOA-only, so a wrapper contract cannot re-roll it.
4. **Verify.** On an audit a **verifier** is drawn, locks a bond, and commits blind. Both reveal. Equal commitments
   agree. In the tolerance class the texts are posted and the contract computes word overlap against a threshold.
5. **Resolve.** On a mismatch a **committee** re-runs and the majority decides. A wrong executor is slashed and the
   buyer refunded in full. Every stalled stage has an `expire` path that refunds the buyer and penalizes only the
   missing party.

### Committee, canaries and demo scenarios

- **Committee of 3** (the contract default): the smallest committee with a real majority, so one faulty member cannot
  decide a dispute. A job therefore needs 5 eligible operators: executor, verifier and three members.
- **Canary jobs:** the gateway pays for a few jobs a day from a separate canary account, through the same public x402
  path, using inputs with known answers (`data/canaries/<id>.wav|png` plus `<id>.ref.txt`). Results are published only
  as aggregates (`GET /v1/canaries`). Canaries measure pool accuracy and never slash anyone.
- **Demo scenarios:** with `DEMO_MODE`, the console's attack lab applies one-click presets to the demo operators:
  honest, audited, garbage, smaller model, truncation, replay, silent executor, hidden answer, verifier no-show,
  committee no-show, collusion with a challenge, and a wrongful challenge.

### Bond sizing

```
Deterrence:  B ≥ c / (p · π) − F        (worst cheat on the measured workload)
Fairness:    B ≤ m / (p · fp)
```

`c` compute saved by cheating, `p` audit rate, `π` catch rate, `F` fee, `m` margin, `fp` false-alarm rate.
`ModelRegistry.setModel` and `createJob` revert if no bond satisfies both.

### Repository

```
models/                  one manifest per model (ASR_V1, OCR_V1)
contracts/               Foundry project
  src/                   Hallmark, ModelRegistry, HallmarkJudge, HallmarkVerdict, IHallmarkVerdict, libs/
  examples/              ExampleConsumer.sol (pays only on FinalAudited; example only)
  script/Deploy.s.sol    deploys and links the contracts (models are registered from manifests)
  flat/                  single-file sources (Remix, verification)
packages/
  contracts/             npm @kapish505/hallmark-contracts: ABIs, testnet addresses
  model-spec/            npm @kapish505/hallmark-model-spec: manifest schema, hallmark-calibrate, hallmark-models
  sdk/                   npm @kapish505/hallmark-sdk: createJob direct to the contract, verdicts, checked results
  operator/              npm @kapish505/hallmark-operator: init/run/status, challenger bot, model workers
  shared/                units, normalization, overlap, bond math, commitments, validators, types
  gateway/               x402 client + evidence store: routes, settlement, refunds, indexer, keeper
  buyer-agent/           x402 CLI and library with spend policy and commitment check
  verifier/              hallmark-verify: re-derives a job's verdict from public data
  simulator/             bond-window calculator
  web/                   landing page (/) and console (/console) with Hedera wallet payments
scripts/                 pack-core, smoke-core.sh, scan-model-constants, account setup, ABI generation
```

| Layer | Stack |
|---|---|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin 5.1.0, `paris`, via-IR |
| Services | Node 22, TypeScript, Express, SQLite, ethers 6 |
| Payments | `@x402/express`, `@x402/fetch`, `@x402/hedera` 2.28.0 |
| Workers | Python 3.11, faster-whisper, Tesseract 5, Docker |
| Web | Vite, React, Hedera WalletConnect |

---

## Running locally

**Requirements:** Node 22+, pnpm 9, Foundry, Docker.

```bash
pnpm install
pnpm setup:contracts                 # forge-std + OpenZeppelin
cd contracts && forge build && cd ..
pnpm gen:abi
pnpm typecheck
```

Inference workers:

```bash
docker compose build
docker compose up -d                 # ASR on :9000, OCR on :9001
curl localhost:9000/health
```

Web app:

```bash
echo "VITE_GATEWAY_URL=http://localhost:8787" > packages/web/.env
echo "VITE_WALLETCONNECT_PROJECT_ID=<your id>" >> packages/web/.env
pnpm web                             # http://localhost:5173
```

## Running on Hedera testnet

1. Copy `env/*.env.example` to `env/*.env` and fill in the contract addresses and testnet keys, or generate the
   service accounts with:
   ```bash
   npx tsx scripts/setup-accounts.ts --internal --fund --demo
   ```
   This creates the gateway, 5 operators, a challenger and a canary buyer, and funds them from the deployer.
2. Deploy (`forge script script/Deploy.s.sol`), then register each model from its manifest:
   `hallmark-calibrate`, `hallmark-models propose`, and `hallmark-models enable` from the owner
   (see [Add a model](docs/ADD_A_MODEL.md)).
3. Start the services:
   ```bash
   pnpm gateway
   pnpm operator      # one per operator env file
   pnpm challenger
   ```
   or the whole stack on one server:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
   ```
4. Pay for a job from the web console with a Hedera wallet, or from the CLI:
   ```bash
   pnpm agent clip.wav --gateway <url> --max-price 0.5 --budget 5
   ```
5. Check any job independently:
   ```bash
   pnpm verify <jobId> --token <access token>
   ```

---

## Notes

- Built with an AI coding assistant (Claude Code). Some helper modules were adapted from a prototype written before
  the official kickoff.
- Third-party code is used only as dependencies at pinned versions: OpenZeppelin Contracts, forge-std, the x402 SDK,
  ethers, faster-whisper, Tesseract.

MIT licensed.
