# Hallmark

**Verified AI inference that agents can pay for.** Agents pay per request over [x402](https://x402.org) on Hedera.
Bonded operators run pinned models, a second operator re-runs a random sample of jobs, and a wrong answer costs the
operator its bond and refunds the buyer.

Live models today: speech-to-text (Whisper large-v3) and OCR (Tesseract 5).

| | |
|---|---|
| Network | Hedera testnet (chain 296) |
| Hallmark | [`0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4`](https://hashscan.io/testnet/contract/0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4) |
| ModelRegistry | [`0x252A9478e703524aFe022C407e6C61ee27633282`](https://hashscan.io/testnet/contract/0x252A9478e703524aFe022C407e6C61ee27633282) |
| HallmarkJudge | [`0x883b674a9050bf8e1531116A3AA524b08983bd46`](https://hashscan.io/testnet/contract/0x883b674a9050bf8e1531116A3AA524b08983bd46) |

All three are verified on Sourcify.

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

### Bond sizing

```
Deterrence:  B ≥ c / (p · π) − F        (worst cheat on the measured workload)
Fairness:    B ≤ m / (p · fp)
```

`c` compute saved by cheating, `p` audit rate, `π` catch rate, `F` fee, `m` margin, `fp` false-alarm rate.
`ModelRegistry.setModel` and `createJob` revert if no bond satisfies both.

### Repository

```
contracts/               Foundry project
  src/                   Hallmark.sol, ModelRegistry.sol, HallmarkJudge.sol, libs/, Probe.sol
  test/                  unit, fuzz, invariant, reentrancy and TS↔Solidity parity tests
  script/Deploy.s.sol    deployment with the bond-window check
  flat/                  single-file sources (Remix, verification)
packages/
  shared/                units, normalization, overlap, bond math, commitments, validators, types
  gateway/               x402 routes, job salts, settlement check, createJob, refunds, indexer, keeper, evidence API
  operator/              executor/verifier/committee orchestrator, challenger bot, worker/asr, worker/ocr
  buyer-agent/           CLI and library with spend policy and commitment check
  verifier/              hallmark-verify: re-derives a job's verdict from public data
  simulator/             bond-window calculator
  web/                   landing page (/) and console (/console) with Hedera wallet payments
scripts/                 calibration, Hedera probes, testnet e2e, account setup, local harness
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
cd contracts && forge build && forge test && cd ..
pnpm gen:abi
pnpm test                            # Vitest (spawns anvil for integration tests)
pnpm e2e:local                       # full stack on a local chain
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
   npx tsx scripts/setup-accounts.ts --internal --fund
   ```
2. Register models with measured values (`scripts/calibrate.ts`, then `ModelRegistry.setModel`).
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
