export declare const abis: { Hallmark: unknown[]; HallmarkVerdict: unknown[]; ModelRegistry: unknown[]; HallmarkJudge: unknown[] };
export declare const hederaTestnet: {
  chainId: number;
  HALLMARK_ADDRESS: string;
  VERDICT_ADDRESS: string;
  REGISTRY_ADDRESS: string;
  JUDGE_ADDRESS: string;
  deployedAt?: string;
};
export declare const VERDICTS: readonly ["Pending", "FinalAudited", "FinalUnaudited", "ExecutorSlashed", "Refunded", "Voided", "AuditSkipped"];
