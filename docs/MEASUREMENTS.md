# Measurements

Every number is tagged **measured**, **assumed** or **cited**, with the script that produced it.
**Status (2026-11-06): G2 measured on Hedera testnet; the models are not measured yet** (G3 not run), so every protocol
parameter below is **assumed** and the model windows are illustrative only.

## Inputs to the core model (read by `pnpm simulate` and the web "Core model" page)

Replace each value with the G3 output (`docs/gates/G3.asr.json`, `docs/gates/G3.ocr.json`) and change its `source` to
`measured`. The simulator prints `NOT MEASURED` for any task with an assumed input.

```json hallmark-measurements
{
  "auditBps": { "value": 3000, "source": "assumed", "note": "[DEMO] default audit rate" },
  "minBond": { "value": 10000000, "source": "assumed", "note": "0.1 HBAR" },
  "tasks": [
    {
      "task": "asr",
      "class": { "value": "EXACT", "source": "assumed", "note": "G3 decides EXACT vs TOLERANCE" },
      "tauBps": { "value": 0, "source": "assumed" },
      "fee": { "value": 20000000, "source": "assumed", "note": "F = 0.2 HBAR" },
      "honestCost": { "value": 15000000, "source": "assumed", "note": "large-v3 CPU int8, one 15 s clip" },
      "fpBps": { "value": 0, "source": "assumed", "note": "0 only if honest runs are bit-exact (G3)" },
      "cheats": [
        { "name": "garbage", "c": { "value": 15000000, "source": "assumed" }, "piBps": { "value": 10000, "source": "assumed" } },
        { "name": "replay-other-input", "c": { "value": 15000000, "source": "assumed" }, "piBps": { "value": 10000, "source": "assumed" } },
        { "name": "model-tiny", "c": { "value": 13500000, "source": "assumed" }, "piBps": { "value": 5000, "source": "assumed" } },
        { "name": "model-small", "c": { "value": 9000000, "source": "assumed" }, "piBps": { "value": 3000, "source": "assumed" } },
        { "name": "truncate-60pct", "c": { "value": 6000000, "source": "assumed" }, "piBps": { "value": 9000, "source": "assumed" } }
      ]
    },
    {
      "task": "ocr",
      "class": { "value": "TOLERANCE", "source": "assumed" },
      "tauBps": { "value": 8500, "source": "assumed" },
      "fee": { "value": 10000000, "source": "assumed", "note": "F = 0.1 HBAR" },
      "honestCost": { "value": 6000000, "source": "assumed" },
      "fpBps": { "value": 50, "source": "assumed", "note": "0.5% target from G3" },
      "cheats": [
        { "name": "garbage", "c": { "value": 6000000, "source": "assumed" }, "piBps": { "value": 10000, "source": "assumed" } },
        { "name": "replay-other-input", "c": { "value": 6000000, "source": "assumed" }, "piBps": { "value": 10000, "source": "assumed" } },
        { "name": "engine-fast", "c": { "value": 4000000, "source": "assumed" }, "piBps": { "value": 3000, "source": "assumed" } },
        { "name": "downscale-50pct", "c": { "value": 3000000, "source": "assumed" }, "piBps": { "value": 4000, "source": "assumed" } },
        { "name": "crop-70pct", "c": { "value": 2000000, "source": "assumed" }, "piBps": { "value": 8000, "source": "assumed" } }
      ]
    }
  ]
}
```

## Measured on Hedera testnet

| What | Value | Source |
|---|---|---|
| Effective gas price | 126 tinybar per reported gas unit (all G2 probe transactions) | measured: `scripts/probe-hedera.ts` → `docs/gates/G2.raw.json` |
| Confirmation time (Hashio, `tx.wait()`) | 6.6-6.9 s | measured: G2 |
| Mirror Node lag after confirmation | 0.6-0.9 s | measured: G2 |
| Deploy gas | Judge 555,354 · Registry 1,000,134 · Hallmark 5,289,549 | measured: deployment receipts (`docs/DEPLOYMENTS.md`) |
| Cost of deploying all three + linking | 8.68 HBAR | measured: deployer balance before/after |
| Small call costs | probe calls of 28k-84k gas cost 0.035-0.106 HBAR | measured: G2 (`charged_tx_fee`) |

## Measured locally (not Hedera)

| What | Value | Source |
|---|---|---|
| Contract runtime sizes | Hallmark 23,089 B · ModelRegistry 4,009 B · HallmarkJudge 2,069 B (cap 24,576 B) | measured: `forge build --sizes` (solc 0.8.24, paris, via-IR, runs 50) |
| `overlap` gas, 96 × 96 distinct words | 707,636 gas | measured on the local EVM: `forge test --mt test_gas_overlap96x96 -vv`. Hedera value pending G2 |

## Pending

| ID | What | Script |
|---|---|---|
| M1 | Honest agreement s and fp per task (exact-hash rate, overlap distribution, cross-machine) | `scripts/calibrate.ts` (G3) |
| M2 | Catch rate pi and compute saved c' per cheat per task | `scripts/calibrate.ts` (G3) |
| M3 | HBAR fee and gas per transaction type; chain cost per job (HBAR, USD) | `scripts/measure.ts` from `docs/e2e/testnet-*.json` |
| M4 | Paid -> provisional and paid -> final latency | `scripts/e2e-testnet.ts` + `scripts/measure.ts` |
| M6 | Cheats caught on testnet (reported honestly, including misses) | `scripts/measure.ts` |
| M7 | Compute cost multiplier `1 + p` in practice | G3 timings × audit rate |
