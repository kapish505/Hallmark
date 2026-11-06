# Integrate

Two ways to ask the Hallmark pool for work. Both end in the same on-chain verdict.

| | Direct (core) | x402 gateway (one client) |
|---|---|---|
| Who calls `createJob` | your account or contract | the gateway, after your x402 payment settles |
| You pay | the contract, in HBAR, from your account | the gateway, over x402 |
| You need | an EVM key with testnet HBAR, `@hallmark/sdk` | an x402 client with a Hedera account |

## Direct: from a service

```bash
npm install ./hallmark-sdk-0.1.0-alpha.0.tgz ./hallmark-contracts-0.1.0-alpha.0.tgz ethers
```

```js
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { HallmarkClient } from "@hallmark/sdk";
import { hederaTestnet as c } from "@hallmark/contracts";

const signer = new Wallet(process.env.KEY, new JsonRpcProvider("https://testnet.hashio.io/api", 296));
const hm = new HallmarkClient({ signer, contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS }, evidenceUrl: process.env.EVIDENCE_URL });
const job = await hm.createJob({ modelKey: "OCR_V1", input: readFileSync("receipt.png") });
const v = await hm.waitForVerdict(job.jobId);
console.log(v.verdict, (await hm.result(job)).text);
```

What `createJob` does:

1. Quotes the price from the contract and refuses if the pool cannot take the job (nothing is paid).
2. Picks a random job id and a random job salt.
3. `POST {evidenceUrl}/v1/core/jobs` with the input, the salt and your signature over
   `hallmark-register:<jobId>:<inputHash>:<keccak(salt)>:<modelId>:<you>`. The store checks the input
   against the model's media rule (format, size) and returns a locator and a bearer token for the result.
4. Calls `Hallmark.createJob(jobId, you, inputHash, keccak(salt), modelId, locator)` from your account
   with the quoted price.

`waitForVerdict` polls `HallmarkVerdict.status` and, by default, advances the job when a step is due
(`drawAudit` after the commit, `settle` after the challenge window). Anyone may call those; the
gateway's keeper usually does it first. Pass `{ poke: false }` to only watch.

`result(job)` reads the text with your bearer token and recomputes the salted commitment
(`outCommitFor`) against the chain. `commitmentMatches: false` means the store handed you something the
executor did not commit to.

Which models exist: the manifests in `models/` (`modelKey`, input rules, measured error). The live ones
are `ASR_V1` (16 kHz mono WAV, up to 15 s) and `OCR_V1` (PNG, printed ASCII text).

## From a contract

Contracts **read** verdicts directly:

```solidity
import {IHallmarkVerdict} from "@hallmark/contracts/src/IHallmarkVerdict.sol";

IHallmarkVerdict v = IHallmarkVerdict(VERDICT_ADDRESS);
if (v.finalizedAt(jobId) != 0 && v.status(jobId) == IHallmarkVerdict.Verdict.FinalAudited) { /* checked */ }
```

`contracts/examples/ExampleConsumer.sol` is an escrow that pays a provider only on `FinalAudited` and
refunds on everything else, including `FinalUnaudited` and `AuditSkipped`. It is an example, not audited.

A contract may also **call** `Hallmark.createJob` itself with `buyer = address(this)` (only the configured
gateway may name a different buyer); the contract test suite does this. The limit today is the evidence
store: it accepts a registration only when it is signed by the buyer's key, and a contract has no key
(EIP-1271 signatures are not supported yet). So in practice an EOA or service creates the job and hands
the job id to the contract that acts on the verdict.

Refunds to a contract buyer are pushed with a small gas stipend; if its `receive` needs more, the amount
goes to its pull-payment credits instead (`Hallmark.withdraw()`).

## Spam rule (what happens if your input is not there)

If the drawn executor cannot get the input or salt, it calls `reportInputMissing` and a different
executor is drawn. If that one finds it, the first claim is penalized as a no-show. If it does not, the
job is `Voided`: you get the price back minus the void fee (the job's protocol fee, 0.02 HBAR on testnet),
which goes to the two executors for their trouble. Register before you create.

## Via x402

Agents that already speak x402 can pay the gateway and get the same job and verdict:

```js
import { viaX402 } from "@hallmark/sdk";
const job = await viaX402({ gatewayUrl, endpoint: "/v1/ocr", input, filename: "page.png", fetchWithPayment });
```

`fetchWithPayment` is `wrapFetchWithPayment` from `@x402/fetch` with a Hedera signer. The gateway's
discovery document is `GET /.well-known/hallmark.json`. The repo's buyer agent (`pnpm agent`) adds a
spend policy and checks on top of this.

## Checking a job independently

```bash
pnpm verify <jobId> --token <access token>
```

re-derives every step of a job from public chain data plus the evidence you are allowed to read.
