# Core map (baseline, 2026-11-07)

What other services adopt (**core**), what uses the core (**clients**), and what is optional (**extras**).
Written before the core-first refactor; the last section lists every OCR/ASR constant found in code and where
it moves.

## Core

| Piece | Where | What it does |
|---|---|---|
| `Hallmark` | `contracts/src/Hallmark.sol` | Escrow, operator stakes, per-job bonds, executor draw, commit, audit draw, verifier, committee, slashing, refunds, timeouts |
| `ModelRegistry` | `contracts/src/ModelRegistry.sol` | One entry per pinned model; refuses to enable a model whose bond window is empty |
| `HallmarkJudge` | `contracts/src/HallmarkJudge.sol`, `libs/TextNorm.sol`, `libs/Overlap.sol` | On-chain normalization check and word overlap (tolerance class) |
| Bond math | `contracts/src/libs/BondMath.sol`, `packages/shared/src/bond.ts` | `B >= c/(p*pi) - F`, `B <= m/(p*fp)` |
| Normalization rules | `packages/shared/src/norm.ts` (mirrors `TextNorm.sol`) | Rule library keyed by `normSpec` id (1, 2); byte-for-byte parity tested |
| Commitments | `packages/shared/src/commit.ts` | `saltCommit`, `outCommit`, blinded `commitment` |
| Operator runtime | `packages/operator/src/{operator,wiring,store,worker,behaviors}.ts` | Executor / verifier / committee loop, persisted before every tx |
| Model containers | `packages/operator/worker/{asr,ocr}` | Pinned inference servers |
| Evidence store | gateway routes `/v1/jobs/:id/{salt,input,outputs}`, `packages/gateway/src/blobs.ts` | Private inputs, salts and outputs, readable by the buyer, role operators and listed watchers |

## Clients

| Client | Where |
|---|---|
| x402 gateway (pay, settle, `createJob`, refunds, keeper, indexer) | `packages/gateway` |
| Buyer agent (CLI + library, spend policy) | `packages/buyer-agent` |
| `hallmark-verify` (re-derive a verdict from public data) | `packages/verifier` |
| Web landing page and console | `packages/web` |

## Extras

| Extra | Where |
|---|---|
| Challenger (watcher) bot | `packages/operator/src/challenger.ts` |
| Canary jobs | `packages/gateway/src/canary.ts` |
| Advisory validators | `packages/shared/src/validators.ts` |
| Demo attack lab | `packages/gateway/src/demo.ts`, operator control port |
| Bond-window simulator | `packages/simulator` |
| Direct-transfer payment rail (MetaMask) | gateway `/v1/direct/:task` |

## Couplings that block "any service can use it"

1. `Hallmark.createJob` reverts unless `msg.sender == gateway` (`NotGateway`).
2. The evidence store only knows jobs the gateway created itself (rows are made on payment).
3. Operators pick a worker from `normSpec` (`taskOfSpec`: `2 -> ocr`, otherwise `asr`).
4. Model parameters exist only as deploy-time env vars (`ASR_*`, `OCR_*` in `Deploy.s.sol`) and on chain.
5. No verdict interface: a contract that wants to act on a result must decode `getJob` and know the status enum.

## Hard-coded OCR/ASR constants found

| File | Constant | Moves to |
|---|---|---|
| `contracts/script/Deploy.s.sol` | `_model(reg, h, "ASR", 1)`, `_model(reg, h, "OCR", 2)`, `ASR_*`/`OCR_*` env names, `minWords = 1`, `maxWords` default 96 | Manifest files read by the deploy/propose script |
| `packages/shared/src/types.ts` | `TASKS = ["asr","ocr"]`, `TASK_ENDPOINT` | Manifest `id` and `endpoint` |
| `packages/shared/src/config.ts` | `ASR_MODEL_KEY` / `OCR_MODEL_KEY` defaults `ASR_V1` / `OCR_V1` | Manifest `modelKey` |
| `packages/operator/src/operator.ts` | `taskOfSpec` (`normSpec 2 -> ocr`) | Manifest lookup by `modelId` |
| `packages/operator/src/worker.ts` | file name `input.wav` / `input.png` by task | Manifest `input.ext` |
| `packages/operator/src/behaviors.ts` | Cheat behaviors per task (small Whisper model, fast OCR engine, crop) | Manifest `cheats` (demo only) |
| `packages/gateway/src/app.ts` | `VALIDATORS` per task, `["asr","ocr"]` route loops, `WER`/`CER` metric, WAV/PNG checks and limits by task | Manifest `validators`, `metric`, `input` |
| `packages/gateway/src/service.ts` | `["asr","ocr"]` loop, `DESCRIPTION` text (Whisper large-v3, 16 kHz, 15 s) | Manifest `description` |
| `packages/gateway/src/canary.ts` | `.wav -> asr`, `.png -> ocr`, `spec 1/2`, WER/CER | Manifest `input.ext`, `normSpec`, `metric` |
| `packages/buyer-agent/src/agent.ts`, `cli.ts` | `transcribe`/`ocr` helpers, file names, `.png -> ocr` | Kept as convenience wrappers over a generic `run(modelKey)`; extension mapping from the manifest |
| `scripts/calibrate.ts` | `--task asr|ocr`, spec, extension, metric | Replaced by `hallmark-calibrate <manifest>` |
| On chain (live) | `ASR_V1`: EXACT, fee 10,000,000, c 4,488,000, m 4,000,000, pi 1250, fp 0, WER 6.59% (n=8). `OCR_V1`: EXACT, fee 6,000,000, c 1,151,500, m 2,500,000, pi 1250, fp 0, CER 0.87% (n=8) | `models/asr-whisper-large-v3.json`, `models/ocr-tesseract-5.json` |

Kept on purpose, not model constants:
- Normalization rule ids `1` and `2` in `TextNorm.sol` / `norm.ts`. They are a rule library; a manifest names the rule it uses.
- Media checkers (`checkCanonicalWav`, `checkPng`) in `shared/media.ts`. A manifest names the checker for its input kind.
- Model containers under `packages/operator/worker/`.

## Baseline

`docs/baseline-e2e.txt`: forge (47 tests), vitest (53 tests), local full-stack e2e, all run on commit `fb778f7`.
