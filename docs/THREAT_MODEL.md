# Threat model

## Trust assumptions

| ID | Assumption | If it fails |
|---|---|---|
| T1 | The gateway holds the buyer's payment between x402 settlement and `createJob`, serves inputs, and holds job salts | It could delay or withhold funds, or leak salts and inputs. Hash binding protects integrity; refunds cover failed creation. Operators check the salt against the chain, so it cannot give different operators different salts. |
| T2 | A majority of the committee (and the verifier) is honest | Colluding verifiers could fake a verdict. With attacker share s of stake, executor and verifier both being the attacker's is about s^2. |
| T3 | Hedera ordering and a JSON-RPC relay | Delays. Hashio is for development and testing only. |
| T4 | The contract owner key | The owner could change parameters. Changes are bounded and emit events; running jobs keep a snapshot. |
| T5 | Mirror Node REST for reads | UI lag only. |
| T6 | Operators' output text is held by the evidence store and the gateway | Not private from the operators that run the job, the gateway, or listed watchers. Third parties see only salted commitments (add-on A1). Tolerance-class disputes publish text and salt on chain. |

T7 to T9 (TEE vendor, side channels, metadata) belong to the private route, which is **not shipped** (G6 not run).

## Attacks and what stops them

| Attack | Defense | Residual |
|---|---|---|
| Garbage, replay of another input's output, truncation, cheaper model | Sampled blind re-run by a bonded verifier; committee on mismatch; slash | Caught with probability p x pi per job (measured at G3); the bond is sized so this does not pay |
| Re-rolling the audit draw from a wrapper contract | `drawAudit` requires `msg.sender == tx.origin`, and runs only after the executor committed | An EOA cannot revert on the outcome |
| Verifier copies the executor's answer | The verifier commits while the executor's commitment is still hidden | A re-drawn verifier after the reveal could copy, so no re-draw happens then (D-V6) |
| Two colluding operators | A random audit with an honest verifier, or a challenge, sends it to the committee | About s^2 chance both seats are the attacker's (T2); the e2e reports this case honestly |
| Dictionary test of a short transcript against the chain | Salted commitment `outCommit = keccak(domain, chain, contract, jobId, jobSalt, text)`; only `keccak(jobSalt)` is on chain | Broken if the salt leaks (T1, T6), and by design in tolerance-class disputes |
| Gateway gives different salts to different operators | Each operator checks `keccak(jobSalt) == saltCommit` before working | None |
| Payment replay | Unique payment key and unique settlement id in the DB; jobId derived from the payment header; contract rejects duplicate jobId | None known (tested x20) |
| Paid response cached by a proxy | `Cache-Control: no-store`, `Vary` on payment headers | Proxy misbehavior outside our control |
| Settlement reverts after the facilitator reports success | `createJob` only after the Mirror Node shows SUCCESS | Whether a Hedera settlement can revert is unconfirmed (G1) |
| Operator withdraws stake mid-job | Bonds are locked; only free stake is withdrawable | None |
| Stalled stage | Every stage has `expire`, which refunds the buyer and penalizes only the missing party | Liveness needs any EOA to call it (the keeper does) |
| Unit confusion (tinybar vs weibar) | Helpers throw on non-whole tinybar; tests over ranges | Confirmed on Hedera at G2 |
| Buyer validator abuse (huge or regex-denial input) | Fixed whitelist, linear scans, 8 KB cap | None known |

## Plain statements

- A failed validator is not the operator's fault, so it never causes a slash or a refund.
- Hallmark shows fidelity to a pinned model, not truth. The pinned model's own error rate is reported in `ACCURACY.md`.
- One hardware class per pool; different GPUs or CPUs are not expected to agree bit for bit.
- `committeeSize = 1` is allowed for small demos but a single tie-breaker is not Byzantine-safe. The default is 3.
