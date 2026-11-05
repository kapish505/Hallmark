# Prior art

Hallmark is **not novel in mechanism** and does not claim "first". Close prior art (from the build prompt's research;
**re-check every link before submitting**):

| Project | What it does | Relation to Hallmark |
|---|---|---|
| EigenAI | Deterministic inference with optimistic re-execution | Same idea: make inference reproducible, re-run on dispute |
| Gensyn Verde | Refereed delegation of ML work | Same family: disagreement resolved by a referee re-running |
| Proof of Sampling | Sampled verification with incentives | Same family: verify a random sample, make cheating unprofitable |
| TOPLOC | Locality-sensitive hashes of model activations to detect substitution | Different check (activations vs output text) |
| DiFR | Verifying inference by recomputation | Same family |
| CommitLLM | Commitments to LLM outputs | Related commit/reveal |
| VeriLLM | Verifiable LLM inference | Related |
| Rerun (ETHGlobal Lisbon) | Stake / challenge / slash on 0G | Closest hackathon neighbor |

What Hallmark adds: x402 payments on Hedera joined to bonded, sampled verification, and a bond sized from **measured**
detection and false-alarm rates for two concrete text tasks (OCR and speech), with commit-then-draw ordering and salted
output commitments.
