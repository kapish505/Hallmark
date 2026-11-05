# Deploying Hallmark with Remix (Hedera testnet)

Nothing has been deployed yet. Values marked ⚠ are unconfirmed until gate G2 checks them on testnet.
Everything here is testnet only.

## 1. Chain

| Field | Value |
|---|---|
| Network | **Hedera Testnet** |
| Chain ID | **296** (hex `0x128`) |
| JSON-RPC (Hashio, dev/test only) | `https://testnet.hashio.io/api` |
| Currency symbol | `HBAR` |
| Explorer | `https://hashscan.io/testnet` |
| Mirror Node REST | `https://testnet.mirrornode.hedera.com/api/v1` |

Use an **ECDSA (secp256k1)** account from the Hedera Portal in MetaMask (ED25519 accounts have no EVM address). In Remix pick
**Injected Provider - MetaMask** and check it shows chain 296.

**Units:** contracts count **tinybar** (1 HBAR = 100,000,000 tinybar). MetaMask and the relay use 18-decimal weibar, so in
Remix's VALUE box **1 Ether = 1 HBAR** ⚠ (G2 step 1 confirms it). Never send value to a constructor: on Hedera a payable
constructor sees `msg.value == 0`.

## 2. Sources and compiler settings

Use the **flattened single files** in `contracts/flat/` (`forge flatten` output). They inline OpenZeppelin **v5.1.0**, so Remix
cannot silently resolve a newer OpenZeppelin release. Regenerate them after any contract change:

```bash
cd contracts && for c in Hallmark ModelRegistry HallmarkJudge Probe; do forge flatten src/$c.sol -o flat/$c.flat.sol; done
```

Compiler settings (Remix "Advanced configurations" → use a JSON config or the checkboxes):

```json
{ "language": "Solidity", "settings": { "optimizer": { "enabled": true, "runs": 50 }, "evmVersion": "paris", "viaIR": true } }
```

- Solidity **0.8.24**. **viaIR must be on**: without it Hallmark is 26.6 KB, over the 24,576-byte limit (decision V3).
- Runtime sizes (measured, `forge build --sizes`): Hallmark **23,530 B**, ModelRegistry 4,256 B, HallmarkJudge 2,324 B, Probe 1,227 B.
- ⚠ Hallmark's initcode is 24.4 KB. Confirm at G2 that the Hashio relay accepts a deploy transaction this large.

## 3. Gas limits (set by hand)

Remix and MetaMask gas estimates are unreliable on the relay. Hedera charges for at least 80% of the limit, so don't overshoot
too far. Local-EVM deployment gas (measured: `forge test --mt test_deployGas -vv`); the Hedera numbers come from G2:

| Contract | Local deploy gas | Suggested limit |
|---|---|---|
| HallmarkJudge | 587,758 | 900,000 |
| ModelRegistry | 1,035,406 | 1,400,000 |
| Hallmark | 5,321,060 | 6,800,000 |
| Probe (G2) | small | 600,000 |

Calls: `setHallmark` 100,000; `setModel` 300,000; `setParams` 300,000; `registerOperator` 300,000.

## 4. Order

1. **G2 first:** deploy `Probe` and `ProbeWrapper` (both in `Probe.flat.sol`), then run `pnpm probe:hedera`
   (env `PROBE_ADDRESS`, `PROBE_WRAPPER_ADDRESS`, `PROBE_PRIVATE_KEY`). Record the results in `docs/gates/G2.md`.
2. `HallmarkJudge` (no constructor args).
3. `ModelRegistry(owner)`, where owner is your deployer address.
4. `Hallmark(owner, registry, judge, gateway)`, where gateway is the **gateway account's EVM address** (the only caller of `createJob`).
5. On the registry: `setHallmark(<Hallmark address>)` (one time only).
6. Optional: `setParams` with your values. The defaults are [DEMO]/[ASSUMED]: auditBps 3000, committeeSize 3, windows
   60/30/45/60/120 s, protocolFee 0.01 HBAR, arbCostEst 0.1 HBAR, minBond 0.1 HBAR, minStake 1 HBAR.
7. **Only after G3:** `setModel(id, model)` for each task with measured values. `id = keccak256("ASR_V1")` and
   `keccak256("OCR_V1")` (the gateway's `ASR_MODEL_KEY` / `OCR_MODEL_KEY`). Use the **worst cheat's** `cTinybar` and `piBps`
   from `docs/gates/G3.<task>.json`, and set `expectedErrorBps` / `errorSampleSize` from the accuracy section of the same file.
   `setModel` reverts with `WindowEmpty(bond, ceiling)` if the measured numbers give an empty bond window. **Do not work around
   that:** it means the task is not coverable at this audit rate.
   `normSpec`: 1 = ASR, 2 = OCR. `class`: 0 = EXACT, 1 = TOLERANCE (with `tauBps`).
8. Optional: `fundAuditPool()` with some HBAR, so the first verifiers and committee members are paid.

Alternatively, deploy everything with Foundry (same settings come from `foundry.toml`), which also prints both bond limits:

```bash
cd contracts && PRIVATE_KEY=0x... GATEWAY_ADDRESS=0x... ASR_ENABLE=true ASR_CLASS=0 ASR_FEE=... ASR_C=... ASR_MARGIN=... ASR_PI_BPS=... ASR_FP_BPS=0 \
  forge script script/Deploy.s.sol --rpc-url https://testnet.hashio.io/api --broadcast --slow
```

## 5. After deploying

- Fill `env/common.env` from `env/common.env.example`: `HALLMARK_ADDRESS`, `JUDGE_ADDRESS`, `REGISTRY_ADDRESS`.
- Verify each contract on Sourcify (HashScan "Verify contract") with the same compiler settings, including viaIR.
- Operators register with `registerOperator()` and a VALUE of at least minStake (the operator process does it from
  `STAKE_TINYBAR` on first start). The gateway answers 503 until at least `2 + committeeSize` operators can cover a bond.
- Then follow `docs/gates/G1.md` to `G5.md`.
