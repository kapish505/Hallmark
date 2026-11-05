# Architecture

```
 Buyer agent --x402 (HBAR)--> GATEWAY --createJob(saltCommit)+price--> HEDERA CONTRACTS
   (spend limits,            (Express, SQLite,                          Hallmark + ModelRegistry + HallmarkJudge
    commitment check)         keeper, indexer)                          draw / commit / drawAudit / reveal /
        ^                        |  salt + input + outputs               challenge / text / committee / settle
        | result (token)         v  (buyer, role operators, watchers)          |
        +------------------ EVIDENCE STORE <------ OPERATORS <-----------------+
                                                   (executor, verifier, committee from one pool,
                                                    pinned ASR / OCR containers)
```

| Component | Code | Role |
|---|---|---|
| Contracts | `contracts/src` | Escrow, bonds, lifecycle, bond window, normalization check, overlap |
| Gateway | `packages/gateway` | x402 merchant (`/v1/transcribe`, `/v1/ocr`), job salt and access token, Mirror Node settlement check, createJob, HAPI refunds, indexer, keeper, evidence store, manifest |
| Operator | `packages/operator` | One orchestrator for all roles; pinned workers in `worker/asr` and `worker/ocr`; challenger bot |
| Buyer agent | `packages/buyer-agent` | Discovers, checks the 402 against the manifest and its spend policy, pays, checks inputHash and outCommit |
| Verifier CLI | `packages/verifier` | Re-derives a verdict from receipts, evidence and the chain |
| Simulator | `packages/simulator` | Bond window from `docs/MEASUREMENTS.md` |
| Web | `packages/web` | Job, Network, Core model, Attack lab |

Lifecycle: see the README and `contracts/src/Hallmark.sol` (Status enum). Order matters: the executor commits, then the
audit is drawn (EOA only), then a verifier commits blind, then both reveal.
