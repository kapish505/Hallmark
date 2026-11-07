# @kapish505/hallmark-sdk

Thin client for the [Hallmark](https://github.com/kapish505/Hallmark) core: create a job directly on the
Hedera contract, wait for the verdict, and read a result that is checked against the chain.
**0.x alpha. Hedera testnet only.**

```bash
npm install @kapish505/hallmark-sdk @kapish505/hallmark-contracts ethers
```

```js
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { HallmarkClient } from "@kapish505/hallmark-sdk";
import { hederaTestnet as c } from "@kapish505/hallmark-contracts";

const signer = new Wallet(process.env.KEY, new JsonRpcProvider("https://testnet.hashio.io/api", 296));
const hm = new HallmarkClient({ signer, contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS }, evidenceUrl: process.env.EVIDENCE_URL });
const job = await hm.createJob({ modelKey: "OCR_V1", input: readFileSync("receipt.png") }); // you pay the contract
const v = await hm.waitForVerdict(job.jobId);
console.log(v.verdict, (await hm.result(job)).text);
```

| API | What it does |
|---|---|
| `new HallmarkClient({ signer, contracts, evidenceUrl, gasLimit?, gasPrice? })` | `signer` pays and is the buyer |
| `quote(modelKey)` | price, per-job bond, availability |
| `createJob({ modelKey, input })` | registers the input and a salt with the evidence store (signed), then calls `Hallmark.createJob` from your account |
| `waitForVerdict(jobId, { poke? })` | polls `IHallmarkVerdict`; by default also advances due steps (`drawAudit`, `settle`, `expire`) |
| `verdict(jobId)` | `FinalAudited`, `FinalUnaudited`, `AuditSkipped`, `ExecutorSlashed`, `Refunded`, `Voided` or `Pending` |
| `result(job)` | the text plus `commitmentMatches`: whether it opens the executor's on-chain commitment |
| `verify(jobId, input?)` | public-data check: job exists, input hash, verdict |
| `viaX402({ gatewayUrl, endpoint, input, filename, fetchWithPayment })` | optional: pay a Hallmark gateway over x402 instead |

Only `FinalAudited` means a second bonded operator re-ran the job. A verdict checks fidelity to the pinned
model, not whether the output is true. Docs: https://hallmark-two.vercel.app/docs · MIT
