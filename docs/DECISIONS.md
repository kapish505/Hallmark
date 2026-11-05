# Decisions

v2 (`HALLMARK_BUILD_PROMPT` v2, 2026-11-06) replaced the v1 design. Decisions from v1 that no longer apply are not
repeated here. Each entry: what, and why.

| # | Decision | Why |
|---|---|---|
| V1 | **One executor + a sampled verifier; a committee only on mismatch.** No two-executor default, no TEE referee, no EIP-712 arbiters. | Prompt v2 section 0. |
| V2 | **Three contracts:** `Hallmark` (escrow, bonds, lifecycle), `ModelRegistry` (models + window check), `HallmarkJudge` (stateless normalization check + overlap). | Code-size cap. The judge is a separate contract, not a linked library, so Remix deploys it without library linking. |
| V3 | **`via_ir = true`** (optimizer runs 50, paris). Without it Hallmark is 26.6 KB; with it 23.1 KB. | The full lifecycle (verifier, text phase, committee, challenge, every expiry) does not fit otherwise. Remix supports viaIR in its compiler config. Margin is 1.5 KB, so new features need another split (edge case 28). |
| V4 | **OpenZeppelin v5.1.0** `Ownable` + `ReentrancyGuard` (storage-based, not transient), as the prompt asks. | v1 avoided OZ only because unversioned imports could pull newer opcodes; v5.1.0 pinned with these two contracts compiles for `paris`. |
| V5 | **`drawAudit` is callable by anyone, any time after the executor commits, EOA only.** No draw deadline is enforced. | Liveness never depends on one party (the keeper normally calls it). Since the outcome is random and an EOA cannot revert on it, waiting gives no advantage. |
| V6 | **Verifier no-show handling:** at the commit stage, penalize and re-draw once, then `auditSkipped`. At the reveal or text stage, penalize and settle as `auditSkipped`. | After the executor reveals, a re-drawn verifier would not be blind (it could copy the hash), so no re-draw then. |
| V7 | **Tolerance text phase uses calldata, not storage.** `postText` checks normalization and the hash and sets a flag; `compareTexts(textE, textV)` and `resolve(texts)` take the texts again as calldata and re-check hashes. Committee members in tolerance jobs reveal with `revealText`. | Storing up to 1 KB per party costs about 33 SSTOREs. Calldata is on chain anyway, so availability is guaranteed. The indexer recovers text from calldata if an operator never uploads it. |
| V8 | **Committee threshold uses the configured size**: `thr = floor(committeeSize / 2) + 1`, counted over members who revealed. Fewer drawn or revealed means inconclusive. | A shortage of eligible operators must not lower the bar for slashing. |
| V9 | **Who gets the finder share:** executor slashed means the challenger (if challenge-forced) or else the verifier. Verifier slashed means the committee members who sided with the executor, split equally (dust to slashPool). | The prompt defines the finder for executor slashes only; the committee is what found the verifier wrong. |
| V10 | **Rewards come from the audit pool**, capped by its balance: verifier and each consistent committee member get `arbCostEst` (snapshotted). The pool is funded by every settled job's audit fee, by `fundAuditPool()`, and by the owner moving slashPool funds. | Matches `price = F + protocolFee + ceil(p * arbCostEst)`: in expectation the pool pays one re-run per audited job. Committee rewards can drain it faster; inconclusive jobs pay no rewards. |
| V11 | **Executor wrong refunds the full price** (F + protocol fee + audit fee). | "Refund the buyer" with nothing kept back. |
| V12 | **Bond locked for executor, verifier and each committee member alike**, equal to the job's B. | A cheap verifier or member seat would be the weak link. |
| V13 | **Stake-weighted draw by free stake** among operators with `free >= bond`, excluding executor, verifier, challenger and drawn members. At most 64 operators. | Simple O(n) draw; bounded gas. |
| V14 | **Randomness:** Hedera PRNG precompile `0x169 getPseudorandomSeed()`, hashed with jobId, a nonce and the contract address. If the call returns nothing (local EVM), fall back to `prevrandao` + blockhash and report `prng=false` in `AuditDrawn`. | Edge case 20, labelled weaker. G2 confirms the signature. |
| V15 | **Normalization: the chain only validates.** `TextNorm.validate(text, spec)` checks the output is normalized; operators normalize raw output off chain. ASR: `[a-z0-9']`; OCR: `[a-z0-9]`. Whitespace and `-` separate words (OCR also `/` and `_`); other ASCII punctuation is dropped without separating; curly apostrophes become `'` in ASR and are dropped in OCR; any other non-ASCII rejects. | Section 10 left the separator set open. Parity vectors (96 normalization, 60 overlap, 60 bond cases) are generated in TS and asserted in Foundry. |
| V16 | **Overlap via an open-addressing hash table in memory**, same result as the nested loop (fuzz-tested against it). 708k gas at 96 x 96 instead of 2.4M. | A tolerance `resolve` runs up to 2 overlaps per member; the nested loop would have needed about 14.5M gas, near Hedera's 15M limit. |
| V17 | **Model fee F lives in the registry** (per model), not in global params. | OCR and ASR cost different amounts; the bond formula and the margin are per model. |
| V18 | **Output text reaches the evidence store only after the operator's own reveal**, signed with its key. The gateway accepts it only if a revealed seat on chain has that hash. | Blindness: nothing about an output leaks before its commitment is opened. |
| V19 | **jobId = keccak256(inputHash ‖ keccak256(payment header))**, plus a unique `payment_key` and a unique `settle_tx` column. | Retries with the same payment map to the same job (edge case 1); one settlement can never fund two jobs. |
| V20 | **Prices are read from the contract** (`quote(modelId)`) at start and every `PRICE_REFRESH_MS`. A buyer who paid a stale price gets `WrongValue` on `createJob` and a refund. | Prices are never configured twice or supplied by the client (T4). |
| V21 | **The keeper is the gateway's EOA.** It draws audits, settles, compares texts, resolves and expires. All of these are permissionless. | Liveness bot; anyone can run another. |
| V22 | **The OCR engine candidate is Tesseract 5** (tessdata_best LSTM, single-threaded); the lazy-engine cheat uses tessdata_fast. | CPU-deterministic is preferred by G3. Final choice is G3's: the worker API is engine-agnostic. |
| V23 | **ASR settings:** faster-whisper large-v3, CPU int8, fixed threads, `temperature=[0.0]` (one element disables the fallback), all fallback thresholds off, `language=en`, no conditioning, beam 1, no VAD, WAV decoded in the container. | Section 7 G3. |
| V24 | **Operator behaviors are role-aware** (`/behavior {behavior, role}`). | Makes the e2e and attack lab deterministic, for example "silent only as committee member" for the inconclusive path. |
| V25 | **The challenger challenges when the executor's text is missing from the evidence store** (tolerance class). | An output nobody can read cannot be checked; the challenge forces an audit. |

## Add-on (privacy and accuracy), 2026-11-06

| # | Decision | Why |
|---|---|---|
| P1 | **A1 shipped.** `outCommit = keccak256(abi.encode(OUT_DOMAIN, chainid, contract, jobId, jobSalt, normalizedText))` replaces the text hash in commit, reveal, compare, committee and events. Only `saltCommit = keccak256(jobSalt)` is on chain; `createJob(jobId, buyer, inputHash, saltCommit, modelId)`. The operator's own blinding salt is `commitSalt`. | A short transcript could otherwise be guessed and tested against the chain. |
| P2 | **The gateway generates `jobSalt`** and gives it to the payer (via a bearer `accessToken` in the 202, which only the payer receives), to operators holding a role on the job (signed request, role checked on chain), and to listed `EVIDENCE_WATCHERS`. Inputs and outputs follow the same rule. | The add-on's distribution rule. Watchers are added because the challenger bot (the collusion defense) must read inputs and outputs; they are listed in config and disclosed. |
| P3 | **Operators refuse a job whose served salt does not hash to `saltCommit`** (edge case 29). | A gateway cannot give the executor and the verifier different salts and cause a false mismatch. |
| P4 | **Tolerance class publishes the salt with the text** (`postText(id, text, jobSalt)`, `compareTexts(..., jobSalt)`, `revealText(id, text, jobSalt, commitSalt, ref)`, `resolve(id, texts, jobSalt)`); each call checks the salt against `saltCommit`. | Text posted on chain is public anyway. The private route (if ever built) is EXACT-only. |
| P5 | **The empty-output check moved off chain.** With a salted commitment the contract cannot tell an empty text from any other; empty text still fails `minWords` at `postText` / `revealText`, and an honest verifier mismatches it. | Unavoidable consequence of P1. |
| P6 | **The buyer checks the commitment**: the result returns `text` and `jobSalt`, and the agent recomputes `outCommit` and compares it with the executor's on-chain seat (`commitmentMatches`). | Cheap end-to-end check that the delivered text is the committed one. |
| P7 | **A3: NORM_OCR_V1B adopted before G3** (OCR keeps `.` and `,` only between two digits). All validators ship: `none`, `min_words:<n>`, `date_iso`, `amount_present`, `invoice_total` (OCR-only for the last two). | The add-on asks to decide before G3 so calibration uses the final normalization; amounts are needed for the two invoice validators. |
| P8 | **Validators run on the executor's raw text** (uploaded and signed with its output), falling back to the normalized text. Result field `validated: pass / fail / n/a`. No money effect. Inputs over 8 KB give `n/a`; all scans are linear. | Advisory evidence; the commitment binds only the normalized text. |
| P9 | **A2: `expectedErrorBps` and `errorSampleSize` added to the registry entry** (informational, emitted in `ModelSet`, shown in the manifest, result and UI). `calibrate.ts` reports corpus WER/CER with a bootstrap 95% interval. Values stay 0 ("not measured") until G3. | The add-on; no number is invented. |
| P10 | **A4 (canaries) cut**, per the add-on's cut order. **A5 (private route) not built**: G6 needs a real TEE host and attestation verification, which were not available. Nothing about it is claimed. | No faking; label what did not ship. |

## Process note (disclosure)

- v1 of this codebase (TEE arbiters, tiers, canaries) was written **before the official kickoff**, at the team's request,
  and was disclosed at the time. It was never committed to git.
- On 2026-11-06, after the team confirmed kickoff had started, v1 was replaced in place by v2. **The git history starts with
  the v2 rewrite.**
- Carried over from the pre-kickoff v1 prototype, adapted: the tinybar/weibar unit helpers, the transaction sender (one
  nonce queue per key), the Mirror Node and RPC log sources, the x402 middleware wrapper and facilitator selection, the HAPI
  refunder, the core of the ASR normalizer and of `TextNorm.validate` / `wordHashes`, the HTTP helpers, the WAV header probe,
  the local anvil harness, and the web styles. Everything else (all contracts, the operator, keeper, gateway app, verifier,
  simulator, calibration, e2e suites, web pages) was written for v2. See `AI_USAGE.md`.
