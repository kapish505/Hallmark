# Core model

Verification is a hypothesis test: *is this output what the pinned function gives for this input?*

| Symbol | Meaning | Where it comes from |
|---|---|---|
| s | spread between two honest runs | G3 (`scripts/calibrate.ts`) |
| p | audit rate (`auditBps / 10000`) | parameter; compute is about `1 + p` times plain inference |
| c | compute an operator saves by cheating (at most the honest cost) | G3 timings x honest cost (the cost is an estimate) |
| pi | chance a cheated output differs (EXACT) or falls below tau (TOLERANCE) | G3, per cheat |
| fp | chance an honest output is wrongly flagged | G3; 0 if honest runs are bit-exact |
| F | executor fee | registry |
| m = F - c_honest | executor margin | registry |
| B | per-job bond (executor, verifier, each committee member) | computed on chain |

These two limits are our own derivation, not from a paper, and are untested beyond the arithmetic:

```
Deterrence:  B >= c / (p * pi) - F      cheating must lose money in expectation
Fairness:    B <= m / (p * fp)          honest operators must not lose money to false alarms
A window exists roughly when  pi / fp >= c / m.
```

Deterrence, spelled out: cheating saves c. It is caught with probability `p * pi` (audited, and the audit shows the
difference), and then the operator loses its bond B plus the fee F it would have earned. So
`E[cheat] - E[honest] = c - p * pi * (B + F)`, which is <= 0 when `B >= c / (p * pi) - F`.

Fairness: an honest operator is audited with probability p and wrongly flagged with probability fp. If the committee then
sides against it, it loses B. Expected loss `p * fp * B` must stay below its margin m.

**Worst cheat.** For every cheat in the G3 set compute `c'/(p * pi') - F` and take the maximum. One registry entry holds the
worst cheat's `c` and `pi`, so the on-chain bond covers every measured cheat.

**Where it is enforced.** `ModelRegistry.setModel(enabled = true)` and `Hallmark.createJob` compute both limits
(`libs/BondMath.sol`, parity-tested against `packages/shared/src/bond.ts`) and revert with `WindowEmpty` if the floor is
above the ceiling. `script/Deploy.s.sol` prints both limits and refuses to enable an empty window. `pnpm simulate --sweep`
shows how the window moves with p.

**What the chain does.** Only neutral escrow, the bonds, and the public record. Hallmark's job is to run this test
cheaply (sampled re-runs), make the audit unpredictable (commit, then draw, from an EOA-only call), and make the penalty real
(bonds locked before any output is seen).

**What it does not cover.** A cheat with pi = 0 on the workload (a cheaper model that gives the same output on easy inputs)
is not detected, and is not harmful: the output is what the pinned model would have produced. That is why pi is measured on
the real workload rather than assumed. Two colluding operators (executor and verifier) are caught only by the committee
after a challenge; with an attacker share s of stake the chance both are the attacker's is about s^2 (T2).
