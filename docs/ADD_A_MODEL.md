# Add a model

Adding a model means **measuring** it, not editing code. A model is a manifest file in `models/`; the
contracts, gateway, operator and SDK read everything model-specific from it
(`scripts/scan-model-constants.ts` fails the build if a model constant leaks into core code).

Hallmark can check a model only if honest runs of it agree, exactly or nearly. **A model whose repeated
runs differ too much will not get a valid bond window and cannot be enabled.** Sampling with temperature,
nondeterministic GPU kernels and unpinned weights are the usual causes.

## 1. Container with a pinned digest

Package the model as an HTTP container: `POST <path>` with a multipart field `input` returns
`{"text": "..."}`, and `GET /health` returns 200. Bake the weights into the image, pin every base image and
dependency, and turn off anything random (greedy decoding, fixed seeds, fixed thread count).
`packages/operator/worker/asr` and `worker/ocr` are the two existing examples.

Build it, record the image digest, and decide the hardware class the pool will run it on (one per pool).

## 2. Normalization rule

The on-chain judge compares normalized text. Pick a rule from the library (`normSpec` 1 or 2 in
`contracts/src/libs/TextNorm.sol`, mirrored byte for byte in `packages/shared/src/norm.ts`). A new rule
means adding it to both and to their parity tests; that is a contract change, so it needs a new
`HallmarkJudge` deployment.

## 3. Manifest

Copy a file in `models/` and fill in:

| Field | Meaning |
|---|---|
| `modelKey` | on-chain id is `keccak256(modelKey)` |
| `task`, `title`, `description`, `endpoint` | client-facing names and the x402 route |
| `runtime.image`, `runtime.runtimeDigest`, `runtime.hwClass` | the pinned container and the pool's hardware class |
| `normSpec`, `normName` | rule from step 2 |
| `input` | media checker (`wav-pcm16-mono-16k` or `png`), extension, size limits |
| `worker` | env var holding the container URL on an operator, POST path, port |
| `feeTinybar`, `marginTinybar` | what the executor earns, and its margin over honest cost |
| `checkClass`, `tauBps`, `piBps`, `fpBps`, `cTinybar` | **from calibration only** (step 4) |
| `accuracy` | measured error against human references (informational) |
| `cheats` | demo-only cheaper variants (worker options or dropped words) used by the attack lab and calibration |

`npx tsx packages/model-spec/src/models-cli.ts check models/<file>.json` validates it.

## 4. Calibrate

The tools come from npm (`hallmark-calibrate` and `hallmark-models`):

```bash
npm install -g @kapish505/hallmark-model-spec
```

```bash
hallmark-calibrate models/<file>.json <dataset-dir> \
  --workers http://machine-a:9000,http://machine-b:9000 --runs 20 --honest-cost-tinybar <your estimate>
```

`<dataset-dir>` holds at least 8 inputs (with the manifest's extension), ideally with `<name>.ref.txt`
human-checked references. Each `--workers` URL should be a different machine running the same digest.

It runs every input repeatedly on every machine, then the cheats (empty, garbage, replaying another
input's answer, and the manifest's own cheaper variants), and prints:

- the class: `EXACT` when every honest pair is bit-identical over enough pairs, else `TOLERANCE` with the
  highest overlap threshold `tau` whose honest false-alarm rate is at most 0.5% (1% at most), else
  `NOT_COVERABLE`;
- the false-alarm rate `fp`, each cheat's catch rate `pi`, and the compute it saves `c` (a time ratio
  times your cost estimate, labelled assumed);
- the bond window at the chosen audit rate: deterrence `B >= c/(p*pi) - F`, fairness `B <= m/(p*fp)`.

It writes `<file>.calibrated.json`. **If the class is `NOT_COVERABLE` or the window is empty it refuses:
the file is written with `enabled: false` and the command exits 1.** With one machine the calibration is
marked `prelim`.

## 5. Propose (anyone)

```bash
REGISTRY_ADDRESS=... HALLMARK_ADDRESS=... PRIVATE_KEY=<your testnet key> \
  hallmark-models propose models/<file>.calibrated.json
```

`ModelRegistry.proposeModel` stores the entry **disabled** and emits the manifest hash, so reviewers can
match the on-chain proposal to the file. Nothing changes for jobs.

## 6. Enable (registry owner)

```bash
PRIVATE_KEY=<owner key> hallmark-models enable models/<file>.calibrated.json
```

The owner reviews the manifest and its calibration, then enables it. The command refuses a manifest marked
`enabled: false` or with an empty window at the live audit rate, and pins the exact proposal by hash, so
a re-proposal slipped in by someone else makes it revert (`ProposalChanged`). The registry checks the
window again on chain and reverts if it is empty.

Enabling stays with the owner on purpose: a manifest is a claim about measurements, and a fake one could
set a catch rate high enough to make the bond trivially small.

## 7. Serve it

Ship the manifest to the pool. Operators add the container to their compose file and set the env var the
manifest names (`worker.urlEnv`); `hallmark-operator status` shows whether each model's worker is
reachable. The gateway offers the model on the manifest's `endpoint` once it is enabled and enough bonded
operators are eligible.
