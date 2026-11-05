import { describe, expect, it } from "vitest";
import type { Manifest } from "@hallmark/shared";
import { SpendTracker } from "../src/policy.js";

const task = (t: "asr" | "ocr", price: string) => ({
  task: t,
  endpoint: "",
  modelId: "0x" + "00".repeat(32),
  modelKey: t.toUpperCase() + "_V1",
  priceTinybar: price,
  bondTinybar: "80000000",
  class: "EXACT" as const,
  tauBps: 0,
  auditBps: 3000,
  available: true,
  limits: { maxBytes: 1_000_000 },
});
const manifest: Manifest = {
  name: "Hallmark",
  version: "0.2.0",
  network: "hedera:testnet",
  payTo: "0.0.5005",
  asset: "0.0.0",
  chainId: 296,
  contract: "0x" + "11".repeat(20),
  facilitator: "https://example.invalid",
  tasks: [task("asr", "24000000"), task("ocr", "14000000")],
  endpoints: { job: "", result: "", events: "" },
};
const req = { network: "hedera:testnet", asset: "0.0.0", amount: "24000000", payTo: "0.0.5005" };
const P = "24000000";

describe("spend policy (section 9.3)", () => {
  it("accepts a requirement that matches the manifest and the caps", () => {
    const t = new SpendTracker({ maxPricePerCallTinybar: 24_000_000n, sessionBudgetTinybar: 100_000_000n });
    expect(t.check(req, manifest, P)).toBeNull();
  });
  it("refuses mismatched payTo, asset, network or amount", () => {
    const t = new SpendTracker({ maxPricePerCallTinybar: 10n ** 9n, sessionBudgetTinybar: 10n ** 10n });
    expect(t.check({ ...req, payTo: "0.0.666" }, manifest, P)).toMatch(/payTo/);
    expect(t.check({ ...req, asset: "0.0.123" }, manifest, P)).toMatch(/asset/);
    expect(t.check({ ...req, network: "eip155:296" }, manifest, P)).toMatch(/network/);
    expect(t.check({ ...req, amount: "24000001" }, manifest, P)).toMatch(/differs/);
  });
  it("enforces the per-call cap and the session budget", () => {
    const t = new SpendTracker({ maxPricePerCallTinybar: 20_000_000n, sessionBudgetTinybar: 100_000_000n });
    expect(t.check(req, manifest, P)).toMatch(/per-call cap/);
    const u = new SpendTracker({ maxPricePerCallTinybar: 10n ** 9n, sessionBudgetTinybar: 30_000_000n });
    u.record({ jobId: "x", amountTinybar: 24_000_000n, payTo: "0.0.5005", transaction: null, at: "" });
    expect(u.check(req, manifest, P)).toMatch(/remaining budget/);
  });
  it("honours an explicit payTo allow-list", () => {
    const t = new SpendTracker({ maxPricePerCallTinybar: 10n ** 9n, sessionBudgetTinybar: 10n ** 10n, allowedPayTo: ["0.0.1"] });
    expect(t.check(req, manifest, P)).toMatch(/allow-list/);
  });
  it("checks the 402 amount against the manifest price of the task being bought", () => {
    const t = new SpendTracker({ maxPricePerCallTinybar: 10n ** 9n, sessionBudgetTinybar: 10n ** 10n });
    expect(t.check({ ...req, amount: "14000000" }, manifest, "14000000")).toBeNull();
    expect(t.check({ ...req, amount: "24000000" }, manifest, "14000000")).toMatch(/differs/);
  });
});
