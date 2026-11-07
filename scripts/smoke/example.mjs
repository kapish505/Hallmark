// The README example: a service creates a job directly on the contract and reads the verdict.
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { HallmarkClient } from "@kapish505/hallmark-sdk";
import { hederaTestnet as c } from "@kapish505/hallmark-contracts";

const signer = new Wallet(process.env.KEY, new JsonRpcProvider(process.env.RPC_URL ?? "https://testnet.hashio.io/api", 296));
const hm = new HallmarkClient({ signer, contracts: { hallmark: c.HALLMARK_ADDRESS, verdict: c.VERDICT_ADDRESS }, evidenceUrl: process.env.EVIDENCE_URL });
const job = await hm.createJob({ modelKey: "OCR_V1", input: readFileSync(process.env.INPUT ?? "input.png") });
const v = await hm.waitForVerdict(job.jobId); // FinalAudited | FinalUnaudited | AuditSkipped | ExecutorSlashed | Refunded | Voided
console.log(v.verdict, v.audited ? "(re-run by a second operator and agreed)" : "(not re-run: bond-backed only)");
if (v.verdict.startsWith("Final") || v.verdict === "AuditSkipped") console.log((await hm.result(job)).text);

// smoke-test only: machine-readable line for scripts/smoke-core.sh
console.log("SMOKE", JSON.stringify({ jobId: job.jobId, createTx: job.txHash, verdict: v.verdict, final: v.final, hallmark: c.HALLMARK_ADDRESS }));
