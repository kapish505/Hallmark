# Deploying Hallmark contracts with Remix (Hedera testnet)

Nothing here has been deployed yet. Everything below is for you to run in Remix.
Values marked ⚠ are unconfirmed until gate G2 (the `Probe` contract) checks them on testnet.

## 1. Chain

| Field | Value |
|---|---|
| Network | **Hedera Testnet** |
| Chain ID | **296** (hex `0x128`) |
| JSON-RPC (Hashio, dev/test only) | `https://testnet.hashio.io/api` |
| Currency symbol | `HBAR` |
| Explorer | `https://hashscan.io/testnet` |
| Mirror Node REST | `https://testnet.mirrornode.hedera.com/api/v1` |

**Wallet:** add the network above to MetaMask and import the **ECDSA (secp256k1)** private key of
your *deployer* account from the Hedera Portal. ED25519 accounts have no EVM address and will not work.
In Remix, choose **Environment → "Injected Provider - MetaMask"** and check it shows chain 296.

**Units:** contracts work in **tinybar** (1 HBAR = 100,000,000 tinybar). The relay and MetaMask use
18-decimal **weibar** on the wire, so in Remix's VALUE box **1 `ether` = 1 HBAR** ⚠ (G2 step 1
confirms this). Example: a 10 HBAR stake is VALUE `10` with unit `Ether`, and the contract sees
`1_000_000_000`.

## 2. Remix compiler settings (all contracts)

- Compiler **0.8.24**
- Optimization **enabled, runs = 50**
- EVM version **paris** (avoids `PUSH0`; G2 tests whether `shanghai`/`cancun` work)
- viaIR **off**
- No external imports. Upload the whole `contracts/src` folder, keeping `libs/` as a subfolder.

Runtime sizes at these settings (limit 24,576 B): Hallmark 21,666 · HallmarkArbitration 11,293 ·
HallmarkJudge 3,618 · ModelRegistry 1,669 · Probe 3,989.

## 3. Gas limits

Remix/MetaMask estimates are unreliable on the Hedera relay. **Set the gas limit by hand.** Hedera
charges for at least 80% of the limit, so don't set it far too high. Local measurements (paris, runs 50):

| Deploy | Gas used (local EVM) | Suggested limit |
|---|---|---|
| Probe | 916k | 1,200,000 |
| ModelRegistry | 476k | 700,000 |
| HallmarkJudge | 867k | 1,100,000 |
| Hallmark | 5.01M | **6,500,000** |
| HallmarkArbitration | 2.55M | 3,200,000 |

Hedera gas costs differ from Ethereum's. Record the real `charged_tx_fee` from the Mirror Node in
`docs/gates/G2.md`. The deployer needs roughly 20 HBAR or more. Adjust once you've seen the first fee.

## 4. Deploy order

**Step 0 (gate G2): deploy `Probe` first**, with no value, then:
1. `payIn()` with VALUE 1 Ether → the `ValueSeen` event should show `msgValue = 100000000` (tinybar).
2. `ctorValue()` → expect 0 (never fund contracts in a constructor).
3. Send `seed()` twice → the `SeedResult` event should show `ok=true, retLen=32` and a different seed each time.
4. `chainInfo()` → chainId 296. Note whether `prevrandao` is non-zero.
5. `recover(...)` with a signature made off-chain → it should return your address.
6. `write`, `emit1k`, then `overlapMax` with gas limit 15,000,000 → record gas and fees from HashScan.

Write the results into `docs/gates/G2.md`. If `seed()` fails, Hallmark still works: it falls back
to `prevrandao` (and then a weak fallback), and every job emits `SeedDrawn(source)` so the UI can label it.

**Then the protocol (record every address):**

| # | Contract / call | Constructor args / inputs |
|---|---|---|
| 1 | `ModelRegistry` | `initialOwner` = deployer address |
| 2 | `HallmarkJudge` | none |
| 3 | `Hallmark` | `initialOwner` = deployer, `registry_` = #1, `judge_` = #2, `gateway_` = **gateway account's EVM address** |
| 4 | `HallmarkArbitration` | `initialOwner` = deployer, `core_` = #3, `judge_` = #2 |
| 5 | `Hallmark.setArbitration` | #4 |
| 6 | `HallmarkArbitration.setArbiters` | `["0xArbiter1","0xArbiter2","0xArbiter3"]`, `2` |
| 7 | `ModelRegistry.setModel` | see below |
| 8 | `Hallmark.registerMiner` (from **each** miner account) | VALUE ≥ 10 Ether (= `minStake` of 10 HBAR) |
| 9 | *(demo only)* `Hallmark.setTier(...)` | e.g. to show a tier's effect live; every change applies to new jobs only. Say so in the video |

Step 7, `setModel` inputs:

```
modelId: 0xb9767d60a0d8de8b5b09b767ae5c44fc149066124c9639cff36e270d23369284
m:       ["0x505bae7bdf3c3cddbdeb0df684c56982ce5363be1513fb67b41ee197c5c42fe1","0xcee5447de118b9924a3a4841fd9180ecf6c297397ee0745334911654c39eb39b","0x1b24f3f9a480b5aaa08c315c7c7712cf9a6dbc3d2ea3cf5dfc1614bfec8c8a0a",8500,3,96,true]
```

- `modelId` = keccak256("whisper-large-v3/faster-whisper/int8/NORM_V1")
- `normSpecHash` = keccak256("NORM_V1")
- `weightsHash` and `runtimeImageDigest` are **placeholders**. Call `setModel` again with real
  values once the miner Docker image is pinned (G5).
- `tauBps = 8500` is the spec default. **Replace it with the value G5 calibrates.**

Default parameters set in the constructor (tinybar). The economics are the **Addendum A
[ASSUMED] example**; replace them with measured values via `setParams` once G5/M-series exist:

| Parameter | Default |
|---|---|
| windows (commit / reveal / arbitration) | 60 / 45 / 300 s |
| `baseMinerFee` / `protocolFee` / `arbCostEst` | 0.2 / 0.01 / 0.1 HBAR |
| `cMax` (honest cost upper bound) | 0.08 HBAR (must stay < baseMinerFee / 2; enforced) |
| `minBond` / `maxBond` / `minStake` | 0.1 / 10 / 10 HBAR |
| penalties | no-reveal 50%, missed commit 10%; challenge bond = 2× price |

Assurance tiers (buyer-selected, snapshotted per job):

| Tier | auditBps | challenge window | price | bond / seat |
|---|---|---|---|---|
| basic | 1000 | 60 s | 0.22 HBAR | 0.70 HBAR |
| standard | 3000 | 60 s | 0.24 HBAR | 0.1666 HBAR |
| assured | 10000 | none (always arbitrated) | 0.31 HBAR | 0.10 HBAR (floor) |

`price = baseMinerFee + protocolFee + ceil(auditBps × arbCostEst / 10000)`,
`bond = max(minBond, ceil(cMax × 10000 / auditBps) − baseMinerFee/2)`. A cheaper tier needs a
bigger bond, so every tier faces the same cheating inequality. Owner-only setters at runtime:
`setParams(...)` (opens a new params version; running jobs keep theirs) and
`setTier(tier, auditBps, challengeWindow, enabled)`. A tier whose bond exceeds `maxBond` is
automatically unavailable. `forge script script/Deploy.s.sol` prints this table and refuses to
continue if honest miners would not profit.

The gateway reads tier prices from `quote(tier)`. You never type a price into the gateway.

## 5. Verify (Sourcify)

Use the Remix **Contract Verification** plugin with Sourcify, chain 296, and the same compiler
settings. HashScan then shows the contracts as verified. Put all addresses into the README.

## 6. Accounts checklist (all ECDSA)

deployer/owner · gateway (also the x402 `payTo`) · miner A/B/C (≥ 15 HBAR each: 10 stake + gas) ·
arbiter 1/2/3 (only sign off-chain; a relayer pays gas) · challenger bot · buyer agent
(**must differ from `payTo`**).

## 7. Re-running the local checks

```bash
cd contracts && forge build --sizes && forge test
```

`forge build --sizes` checks the Remix settings stay under the size limit. `forge test` runs the
unit, fuzz, invariant, parity, tier and canary suites. Hedera-specific behaviour (units, PRNG, EVM
version) can only be checked on testnet with `Probe` (G2).
