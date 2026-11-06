// @hallmark/contracts (0.x alpha). ABIs and addresses; the Solidity sources are in ./src.
import { readFileSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
export const abis = {
  Hallmark: load("./abi/Hallmark.json"),
  HallmarkVerdict: load("./abi/HallmarkVerdict.json"),
  ModelRegistry: load("./abi/ModelRegistry.json"),
  HallmarkJudge: load("./abi/HallmarkJudge.json"),
};
/** Hedera testnet (chain 296) deployment */
export const hederaTestnet = load("./deployments/hedera-testnet.json");
/** IHallmarkVerdict.Verdict, in order */
export const VERDICTS = ["Pending", "FinalAudited", "FinalUnaudited", "ExecutorSlashed", "Refunded", "Voided", "AuditSkipped"];
