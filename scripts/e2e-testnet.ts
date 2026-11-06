/**
 * TESTNET e2e (section 13): real x402 payments on Hedera, real operators running the pinned
 * workers, real transactions. Each scenario sets operator behaviors through the gateway demo
 * endpoint, pays with the buyer agent, waits for the outcome, asserts it on chain, prints HashScan
 * links and writes docs/e2e/testnet-<scenario>.json.
 *
 *   tsx scripts/e2e-testnet.ts <scenario|all> --clip clip.wav [--image page.png]
 * env: GATEWAY_URL, BUYER_ACCOUNT_ID, BUYER_PRIVATE_KEY, AGENT_MAX_PRICE_HBAR, AGENT_BUDGET_HBAR,
 *      DEMO_CONTROL_TOKEN, OWNER_PRIVATE_KEY (sets auditBps per scenario; [DEMO] values), RPC_URL?
 * Needs: gateway with DEMO_MODE=true and OPERATOR_CONTROL_URLS for >= 5 operators, the challenger bot.
 * Scenarios: honest honest-ocr garbage replay-other-input lazy-small-model lazy-engine truncate silent
 *            no-reveal collude-challenge false-challenge verifier-noshow inconclusive-refund no-capacity
 *            replay-payment-x20
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { abis, DEFAULTS, hbarToTinybar, Outcome, readJob, Role, SlashReason, type OperatorBehavior, type Task } from "../packages/shared/src/index.js";
import { HallmarkAgent, type TaskResult } from "../packages/buyer-agent/src/index.js";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { clip: { type: "string" }, image: { type: "string" } } });
const which = positionals[0] ?? "all";
if (!values.clip) throw new Error("--clip <file.wav> is required (your own 16 kHz mono clip, <= 15 s)");
const gateway = process.env.GATEWAY_URL!.replace(/\/$/, "");
const token = process.env.DEMO_CONTROL_TOKEN!;
const inputs: Record<Task, Uint8Array | null> = { asr: new Uint8Array(readFileSync(values.clip)), ocr: values.image ? new Uint8Array(readFileSync(values.image)) : null };

const agent = await HallmarkAgent.hedera({
  gatewayUrl: gateway,
  accountId: process.env.BUYER_ACCOUNT_ID!,
  privateKey: process.env.BUYER_PRIVATE_KEY!,
  rpcUrl: process.env.RPC_URL,
  policy: { maxPricePerCallTinybar: hbarToTinybar(process.env.AGENT_MAX_PRICE_HBAR!), sessionBudgetTinybar: hbarToTinybar(process.env.AGENT_BUDGET_HBAR!) },
});
let manifest = await agent.discover();
const provider = new JsonRpcProvider(process.env.RPC_URL ?? DEFAULTS.rpcUrl, manifest.chainId, { staticNetwork: true });
const core = new Contract(manifest.contract, abis.Hallmark, provider);
const owner = process.env.OWNER_PRIVATE_KEY ? new Contract(manifest.contract, abis.Hallmark, new Wallet(process.env.OWNER_PRIVATE_KEY, provider)) : null;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const operatorStep = async (msg: string) => void (await rl.question(`\n>>> OPERATOR: ${msg}\n    press Enter when done `));

async function demo(body: Record<string, unknown>) {
  const r = await fetch(`${gateway}/demo/behavior`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`demo/behavior ${JSON.stringify(body)}: ${r.status} ${await r.text()}`);
}
const setAll = (role: number, behavior: OperatorBehavior) => demo({ operator: "all", role, behavior });
const reset = () => demo({ operator: "all", reset: true });

/** [DEMO] the audit rate is raised to 100% for attack scenarios so a single run shows the catch */
async function setAudit(bps: number) {
  const cur = Number((await core.getParams()).auditBps);
  if (cur === bps) return;
  if (!owner) return operatorStep(`set auditBps = ${bps} (setParams as owner), currently ${cur}`);
  const p = (await owner.getParams()).toObject();
  await (await owner.setParams({ ...p, auditBps: bps }, { gasLimit: 300_000 })).wait();
  await new Promise((r) => setTimeout(r, 65_000)); // gateway price refresh (PRICE_REFRESH_MS)
  manifest = await agent.discover();
}

const events = async (id: string) => (await fetch(`${gateway}/v1/jobs/${id}`).then((r) => r.json())).events as Array<{ name: string; args: Record<string, string>; link: string }>;
const wrongSlashed = async (id: string) => (await events(id)).filter((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.Wrong).map((e) => e.args.who.toLowerCase());
const fail = (m: string): never => {
  throw new Error(m);
};
const res = (r: TaskResult | Error) => (r instanceof Error ? fail(r.message) : r);
const executorSlashed = async (r0: TaskResult | Error) => {
  const r = res(r0);
  const j = await readJob(core, r.jobId);
  if (r.status !== "Refunded" || !(await wrongSlashed(r.jobId)).includes(j.executor.toLowerCase())) fail(`status ${r.status}; executor not slashed`);
  return `executor ${j.executor} slashed; buyer refunded`;
};

type S = { task?: Task; audit: number; setup?: () => Promise<void>; check: (r: TaskResult | Error) => Promise<string>; custom?: () => Promise<{ result: TaskResult | Error; detail: string }> };
const scenarios: Record<string, S> = {
  honest: { audit: 3000, check: async (r0) => { const r = res(r0); if (r.status !== "Settled") fail(r.status); return `settled, badge ${r.badge}`; } },
  "honest-ocr": { task: "ocr", audit: 3000, check: async (r0) => { const r = res(r0); if (r.status !== "Settled") fail(r.status); return `OCR settled, badge ${r.badge}`; } },
  garbage: { audit: 10_000, setup: () => setAll(Role.Executor, "garbage"), check: executorSlashed },
  "replay-other-input": { audit: 10_000, setup: () => setAll(Role.Executor, "replay-other-input"), check: executorSlashed },
  "lazy-small-model": { audit: 10_000, setup: () => setAll(Role.Executor, "lazy-small-model"), check: async (r0) => {
    // report honestly: identical output from the small model on an easy clip is not caught (and not harmful)
    const r = res(r0);
    return r.status === "Refunded" ? await executorSlashed(r0) : `NOT caught on this clip (status ${r.status}); see the measured pi in MEASUREMENTS.md`;
  } },
  "lazy-engine": { task: "ocr", audit: 10_000, setup: () => setAll(Role.Executor, "lazy-engine"), check: async (r0) => {
    const r = res(r0);
    return r.status === "Refunded" ? await executorSlashed(r0) : `NOT caught on this image (status ${r.status}); see the measured pi`;
  } },
  truncate: { audit: 10_000, setup: () => setAll(Role.Executor, "truncate"), check: executorSlashed },
  silent: { audit: 3000, setup: () => setAll(Role.Executor, "silent"), check: async (r0) => {
    const r = res(r0);
    const ev = await events(r.jobId);
    if (r.status !== "Refunded" || !ev.some((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.NoCommit)) fail(r.status);
    return "refunded; no-commit penalty";
  } },
  "no-reveal": { audit: 3000, setup: () => setAll(Role.Executor, "no-reveal"), check: async (r0) => {
    const r = res(r0);
    if (r.status !== "Refunded") fail(r.status);
    return "refunded; no-reveal penalty";
  } },
  "verifier-noshow": { audit: 10_000, setup: () => setAll(Role.Verifier, "silent"), check: async (r0) => {
    const r = res(r0);
    if (r.status !== "Settled" || r.badge !== "audit skipped") fail(`${r.status} ${r.badge}`);
    return "re-draw, second no-show, settled with auditSkipped";
  } },
  "inconclusive-refund": { audit: 10_000, setup: async () => { await setAll(Role.Executor, "garbage"); await setAll(Role.Member, "silent"); }, check: async (r0) => {
    const r = res(r0);
    const ev = await events(r.jobId);
    if (r.status !== "Refunded" || !ev.some((e) => e.name === "Resolved" && Number(e.args.outcome) === Outcome.Inconclusive)) fail(r.status);
    return "inconclusive: refunded, no R_WRONG slash";
  } },
  "collude-challenge": { audit: 3000, setup: async () => {
    const ops = (await fetch(`${gateway}/demo/operators`).then((r) => r.json())) as string[];
    await demo({ operator: ops[0], behavior: "collude" });
    await demo({ operator: ops[1], behavior: "collude" });
  }, check: async (r0) => {
    const r = res(r0);
    const ev = await events(r.jobId);
    return ev.some((e) => e.name === "Challenged") ? `challenged; final status ${r.status}` : `no challenge (executor was honest or audited); status ${r.status}`;
  } },
  "false-challenge": { audit: 3000, check: async (r0) => res(r0) && "challenge an honest result manually with the challenger key; it is expected to settle" },
  "no-capacity": { audit: 3000, setup: () => operatorStep("withdraw free stake from operators until fewer than 2 + committeeSize are eligible"), check: async (r0) => {
    if (!(r0 instanceof Error)) return fail("expected a refusal");
    return `refused before payment: ${r0.message.slice(0, 80)}`;
  } },
};

/** one REAL signed payment header replayed 20 times: expect one jobId and one on-chain job */
async function replayX20() {
  const signer = createClientHederaSigner(process.env.BUYER_ACCOUNT_ID!, PrivateKey.fromStringECDSA(process.env.BUYER_PRIVATE_KEY!), { network: "hedera:testnet" });
  const client = x402Client.fromConfig({
    schemes: [{ network: "hedera:testnet", client: new ExactHederaScheme(signer) }],
    spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: hbarToTinybar(process.env.AGENT_MAX_PRICE_HBAR!).toString() }] },
  });
  let header: string | null = null;
  const inner: typeof fetch = async (i, init) => {
    const req = new Request(i as RequestInfo, init);
    header = req.headers.get("payment-signature") ?? header;
    return fetch(req);
  };
  const form = () => {
    const f = new FormData();
    f.append("file", new Blob([inputs.asr!]), "clip.wav");
    return f;
  };
  const first = await wrapFetchWithPayment(inner, client)(`${gateway}/v1/transcribe`, { method: "POST", body: form() });
  const id = (await first.json()).jobId as string;
  const statuses: number[] = [];
  const ids = new Set([id]);
  for (let k = 0; k < 20; k++) {
    const r = await fetch(`${gateway}/v1/transcribe`, { method: "POST", body: form(), headers: { "PAYMENT-SIGNATURE": header! } });
    statuses.push(r.status);
    if (r.status === 202) ids.add((await r.json()).jobId);
  }
  await new Promise((r) => setTimeout(r, 15_000));
  const created = (await events(id)).filter((e) => e.name === "JobCreated").length;
  return { ok: ids.size === 1 && created === 1, detail: `${ids.size} jobId(s), ${created} JobCreated, replay statuses ${[...new Set(statuses)].join("/")}`, id };
}

const names = which === "all" ? [...Object.keys(scenarios), "replay-payment-x20"] : [which];
const out = join(import.meta.dirname, "../docs/e2e");
mkdirSync(out, { recursive: true });
for (const name of names) {
  if (name === "replay-payment-x20") {
    const r = await replayX20();
    console.log(`${r.ok ? "PASS" : "FAIL"} replay-payment-x20: ${r.detail}`);
    writeFileSync(join(out, "testnet-replay-payment-x20.json"), JSON.stringify({ scenario: name, pass: r.ok, detail: r.detail, jobId: r.id }, null, 2) + "\n");
    continue;
  }
  const s = scenarios[name];
  if (!s) throw new Error(`unknown scenario ${name}`);
  const task = s.task ?? "asr";
  if (!inputs[task]) {
    console.log(`SKIP ${name}: no --image given`);
    continue;
  }
  await reset();
  await setAudit(s.audit);
  await s.setup?.();
  const t0 = Date.now();
  let r: TaskResult | Error;
  try {
    r = await agent.run(task, inputs[task]!, { mode: "require-final", timeoutMs: 600_000 });
  } catch (e) {
    r = e as Error;
  }
  let pass = false;
  let detail: string;
  try {
    detail = await s.check(r);
    pass = true;
  } catch (e) {
    detail = String(e instanceof Error ? e.message : e);
  }
  const seconds = (Date.now() - t0) / 1000;
  const evs = r instanceof Error ? [] : await events(r.jobId);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} (${seconds.toFixed(0)} s): ${detail}`);
  if (!(r instanceof Error)) {
    console.log(`  payment ${r.payment.link}`);
    for (const e of evs) console.log(`  ${e.name.padEnd(16)} ${e.link}`);
  }
  writeFileSync(join(out, `testnet-${name}.json`), JSON.stringify({ scenario: name, pass, detail, seconds, result: r instanceof Error ? { error: r.message } : r, events: evs.map((e) => ({ name: e.name, tx: e.link?.split("/").pop(), args: e.args })) }, null, 2) + "\n");
}
await reset();
console.log("\nspending summary:", JSON.stringify(agent.spend.summary(), null, 2));
rl.close();
