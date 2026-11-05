/**
 * LOCAL full-stack e2e: real contracts on anvil + the real gateway (x402 middleware, indexer,
 * keeper, evidence store), real operator / challenger / buyer-agent / verifier code. Only the x402
 * facilitator and the ASR/OCR workers are local fakes (scripts/local/fakes.ts).
 *
 * This proves the off-chain stack and the contracts work together on every section-13 path. It is
 * NOT the testnet e2e (scripts/e2e-testnet.ts) and none of its numbers are measurements.
 *
 *   pnpm e2e:local            (needs Foundry: anvil + `forge build` output)
 *   E2E_ONLY=honest,garbage pnpm e2e:local
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  connect,
  ifaces,
  loadEnv,

  normalize,
  Outcome,
  readJob,
  Role,
  RpcLogSource,
  SlashReason,
  sleep,

  TxSender,
  type OperatorBehavior,
  type Task,
} from "../../packages/shared/src/index.js";
import { buildGateway, GatewayEnv } from "../../packages/gateway/src/index.js";
import { Challenger, EvidenceClient, Operator, PendingStore, StateFile } from "../../packages/operator/src/index.js";
import { HallmarkAgent, type TaskResult } from "../../packages/buyer-agent/src/index.js";
import { verifyJob } from "../../packages/verifier/src/verify.js";
import { ASR_KEY, deployAll, devKey, OCR_KEY, setAuditBps, startAnvil, synthPng, synthWav } from "./chain.js";
import { FakeClientScheme, FakeFacilitator, FakeWorker } from "./fakes.js";

const N_OPS = 6;
const STAKE = 10n ** 15n; // [LOCAL] wei == "tinybar" on anvil
const PRICE_CAP = 10n ** 9n;
const results: Array<{ name: string; pass: boolean; seconds: number; detail: string; jobId?: string }> = [];
type Beh = Partial<Record<number, OperatorBehavior>>;

async function main() {
  const anvil = await startAnvil(28545 + Math.floor(Math.random() * 1000));
  const provider: JsonRpcProvider = anvil.provider;
  const opKeys = Array.from({ length: N_OPS }, (_, i) => devKey(2 + i));
  const keys = { owner: devKey(0), gateway: devKey(1), challenger: devKey(10), manualChallenger: devKey(11), buyer: devKey(12) };
  const addr = (k: string) => new Wallet(k).address;
  const dep = await deployAll(provider, { ownerKey: keys.owner, gateway: addr(keys.gateway), auditBps: 1 });
  const owner = connect(dep, new NonceManager(new Wallet(keys.owner, provider)));
  const core = owner.core;
  console.log("deployed", dep);

  // ---------------------------------------------------------------- gateway
  const dir = mkdtempSync(join(tmpdir(), "hallmark-e2e-"));
  const facilitator = new FakeFacilitator();
  const port = 30000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const env = loadEnv(GatewayEnv, {
    RPC_URL: anvil.url,
    CHAIN_ID: "31337",
    LOG_SOURCE: "rpc",
    POLL_MS: "500",
    ...dep,
    GATEWAY_PRIVATE_KEY: keys.gateway,
    ASR_MODEL_KEY: ASR_KEY,
    OCR_MODEL_KEY: OCR_KEY,
    PRICE_REFRESH_MS: "3600000",
    DB_PATH: join(dir, "gw.sqlite"),
    BLOB_DIR: join(dir, "blobs"),
    RATE_LIMIT_PER_MIN: "100000",
    PUBLIC_URL: base,
  });

  // ---------------------------------------------------------------- operators
  const startBlock = await provider.getBlockNumber();
  const source = () => new RpcLogSource(provider, [{ address: dep.HALLMARK_ADDRESS, iface: ifaces.core }], startBlock);
  const beh: Beh[] = Array.from({ length: N_OPS }, () => ({}));
  const workers: FakeWorker[] = [];
  const ops: Operator[] = [];
  for (let i = 0; i < N_OPS; i++) {
    const wallet = new Wallet(opKeys[i], provider);
    const sdir = join(dir, `op${i}`);
    mkdirSync(sdir, { recursive: true });
    workers.push(new FakeWorker());
    const op = new Operator({
      contracts: connect(dep, wallet),
      sender: new TxSender(wallet, { defaultGasLimit: 2_000_000 }),
      wallet,
      source: source(),
      worker: workers[i],
      evidence: new EvidenceClient(base),
      evidenceBase: base,
      pending: new PendingStore(sdir),
      state: new StateFile(join(sdir, "state.json")),
      behavior: (role) => beh[i][role] ?? beh[i][0] ?? "honest",
      chainId: 31337,
      units: "evm",
      gasLimit: 2_000_000,
      gasLimitHeavy: 8_000_000,
      pollMs: 500,
      lazyModel: "tiny",
      tasks: ["asr", "ocr"],
      name: `op${i}`,
    });
    await op.ensureRegistered(STAKE);
    ops.push(op);
  }
  const opAddr = ops.map((o) => o.address.toLowerCase());
  const opIndex = (a: string) => opAddr.indexOf(a.toLowerCase());

  const gw = await buildGateway(env, { facilitator, facilitatorUrl: "local-fake" });
  const server = gw.app.listen(port);
  gw.indexer.start();
  gw.keeper.start();
  ops.forEach((o) => o.start());

  // ---------------------------------------------------------------- challenger bot
  const chWallet = new Wallet(keys.challenger, provider);
  const challengerBot = new Challenger({
    contracts: connect(dep, chWallet),
    sender: new TxSender(chWallet, { defaultGasLimit: 3_000_000 }),
    source: source(),
    worker: new FakeWorker(),
    evidence: new EvidenceClient(base),
    units: "evm",
    budgetTinybar: 10n ** 12n,
    marginBps: 0,
    pollMs: 500,
  });
  challengerBot.start();

  // ---------------------------------------------------------------- buyer agent
  const buyer = addr(keys.buyer);
  const agent = new HallmarkAgent(
    { gatewayUrl: base, rpcUrl: anvil.url, policy: { maxPricePerCallTinybar: PRICE_CAP, sessionBudgetTinybar: PRICE_CAP * 500n } },
    new FakeClientScheme(buyer),
  );
  await agent.discover();

  const setAudit = async (bps: number) => {
    if (Number((await core.getParams()).auditBps) !== bps) await setAuditBps(owner, bps);
    await gw.refreshPrices();
    await agent.discover();
  };
  const jobView = (id: string) => fetch(`${base}/v1/jobs/${id}`).then((r) => r.json());
  const eventsOf = async (id: string) => (await jobView(id)).events as Array<{ name: string; args: Record<string, string> }>;
  const wrongSlashed = async (id: string) => (await eventsOf(id)).filter((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.Wrong).map((e) => e.args.who.toLowerCase());
  let clip = 0;
  const nextInput = (task: Task) => (task === "asr" ? synthWav(1, 200 + ++clip * 7) : synthPng(64, 32, ++clip));
  const ok = (c: unknown, msg: string) => {
    if (!c) throw new Error(msg);
  };
  const res = (r: TaskResult | Error) => {
    if (r instanceof Error) throw r;
    return r;
  };

  const only = process.env.E2E_ONLY?.split(",");
  async function scenario(
    name: string,
    o: { task?: Task; audit: number; setup?: () => Promise<void> | void; teardown?: () => Promise<void> | void; mode?: "require-final" | "accept-provisional"; during?: (jobId: Promise<string>) => Promise<void> },
    check: (r: TaskResult | Error) => Promise<string>,
  ) {
    if (only && !only.includes(name)) return;
    const t0 = Date.now();
    beh.forEach((b) => Object.keys(b).forEach((k) => delete b[Number(k)]));
    workers.forEach((w) => (w.jitter = ""));
    await setAudit(o.audit);
    await o.setup?.();
    let r: TaskResult | Error;
    try {
      const p = agent.run(o.task ?? "asr", nextInput(o.task ?? "asr"), { mode: o.mode ?? "require-final", timeoutMs: 300_000 });
      r = await p;
    } catch (e) {
      r = e as Error;
    }
    let pass = false;
    let detail = "";
    try {
      detail = await check(r);
      pass = true;
    } catch (e) {
      detail = String(e instanceof Error ? e.message : e);
    }
    await o.teardown?.();
    const secs = (Date.now() - t0) / 1000;
    results.push({ name, pass, seconds: secs, detail, jobId: r instanceof Error ? undefined : r.jobId });
    console.log(`${pass ? "PASS" : "FAIL"} e2e:${name} (${secs.toFixed(1)} s) - ${detail}`);
  }
  const allRole = (role: number, b: OperatorBehavior) => beh.forEach((x) => (x[role] = b));
  const uniqueJitter = () => workers.forEach((w, i) => (w.jitter = ` word${i}`));

  // ---------------------------------------------------------------- scenarios (section 13)
  await scenario("honest", { audit: 1 }, async (r0) => {
    const r = res(r0);
    ok(r.status === "Settled", `status ${r.status}`);
    ok(r.badge === "provisional (unaudited, bond-backed)", `badge ${r.badge}`);
    ok(r.inputHashMatches === true, "on-chain inputHash matches our input (T1)");
    ok(r.text && r.text === normalize(r.text, 1).text, "normalized text returned");
    ok((await wrongSlashed(r.jobId)).length === 0, "nobody slashed");
    return `"${r.text}" settled unaudited; payment ${r.payment.transaction}`;
  });

  await scenario("honest-ocr", { task: "ocr", audit: 1 }, async (r0) => {
    const r = res(r0);
    ok(r.status === "Settled" && r.text === normalize(r.text ?? "", 2).text, `status ${r.status}`);
    return `OCR "${r.text}" settled`;
  });

  await scenario("audited-agree", { audit: 10_000 }, async (r0) => {
    const r = res(r0);
    ok(r.status === "Settled" && r.badge === "audited (re-run agreed)", `${r.status} ${r.badge}`);
    return "verifier re-ran blind and agreed; both paid";
  });

  for (const [name, b] of [
    ["garbage", "garbage"],
    ["replay-other-input", "replay-other-input"],
    ["lazy-small-model", "lazy-small-model"],
    ["truncate", "truncate"],
  ] as const) {
    await scenario(name, { audit: 10_000, setup: () => allRole(Role.Executor, b) }, async (r0) => {
      const r = res(r0);
      const j = await readJob(core, r.jobId);
      ok(r.status === "Refunded" && r.badge === "slashed", `${r.status} ${r.badge}`);
      ok((await wrongSlashed(r.jobId)).includes(j.executor.toLowerCase()), "executor slashed (R_WRONG)");
      return `executor op${opIndex(j.executor)} slashed by the committee; buyer refunded`;
    });
  }

  await scenario("silent", { audit: 1, setup: () => allRole(Role.Executor, "silent") }, async (r0) => {
    const r = res(r0);
    const ev = await eventsOf(r.jobId);
    ok(r.status === "Refunded", `status ${r.status}`);
    ok(ev.some((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.NoCommit), "no-commit penalty");
    return "executor never committed: buyer refunded, half its bond penalized";
  });

  await scenario("no-reveal", { audit: 1, setup: () => allRole(Role.Executor, "no-reveal") }, async (r0) => {
    const r = res(r0);
    const ev = await eventsOf(r.jobId);
    ok(r.status === "Refunded" && ev.some((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.NoReveal), `status ${r.status}`);
    return "committed but withheld the reveal: refund + penalty";
  });

  await scenario("tolerance-honest-variation", { task: "ocr", audit: 10_000, setup: uniqueJitter }, async (r0) => {
    const r = res(r0);
    const ev = await eventsOf(r.jobId);
    const cmp = ev.find((e) => e.name === "Compared");
    ok(r.status === "Settled" && cmp && cmp.args.agree && Number(cmp.args.overlapBps) < 10_000, `status ${r.status}, compared ${JSON.stringify(cmp?.args)}`);
    ok(ev.filter((e) => e.name === "TextPosted").length === 2, "both texts posted");
    return `hashes differed, overlap ${cmp!.args.overlapBps} bps >= tau: agreed, nobody slashed (edge case 14)`;
  });

  await scenario("tolerance-garbage", { task: "ocr", audit: 10_000, setup: () => (uniqueJitter(), allRole(Role.Executor, "garbage")) }, async (r0) => {
    const r = res(r0);
    const j = await readJob(core, r.jobId);
    const ev = await eventsOf(r.jobId);
    ok(r.status === "Refunded" && (await wrongSlashed(r.jobId)).includes(j.executor.toLowerCase()), `status ${r.status}`);
    ok(ev.some((e) => e.name === "Resolved" && Number(e.args.outcome) === Outcome.ExecutorWrong), "committee: executor wrong");
    return "tolerance dispute: texts posted, committee revealed text, executor slashed";
  });

  await scenario("verifier-noshow", { audit: 10_000, setup: () => allRole(Role.Verifier, "silent") }, async (r0) => {
    const r = res(r0);
    const ev = await eventsOf(r.jobId);
    ok(r.status === "Settled" && r.badge === "audit skipped", `${r.status} ${r.badge}`);
    ok(ev.filter((e) => e.name === "Slashed" && Number(e.args.reason) === SlashReason.VerifierNoShow).length === 2, "two verifier no-show penalties");
    return "verifier no-show, re-draw, second no-show: settled with auditSkipped";
  });

  await scenario("inconclusive-refund", { audit: 10_000, setup: () => (allRole(Role.Executor, "garbage"), allRole(Role.Member, "silent")) }, async (r0) => {
    const r = res(r0);
    const ev = await eventsOf(r.jobId);
    ok(r.status === "Refunded" && ev.some((e) => e.name === "Resolved" && Number(e.args.outcome) === Outcome.Inconclusive), `status ${r.status}`);
    ok((await wrongSlashed(r.jobId)).length === 0, "no R_WRONG slash without a committee majority");
    return "committee no-show: inconclusive, buyer refunded, nobody slashed for being wrong";
  });

  // collusion: two operators return the same fake text; the random audit is off, the challenger bot catches it
  if (!only || only.includes("collude-challenge")) {
    const t0 = Date.now();
    let pass = false;
    let detail = "";
    let jobId: string | undefined;
    beh.forEach((b) => Object.keys(b).forEach((k) => delete b[Number(k)]));
    workers.forEach((w) => (w.jitter = ""));
    await setAudit(1);
    beh[0][0] = "collude";
    beh[1][0] = "collude";
    try {
      for (let tries = 0; tries < 10 && !pass; tries++) {
        const r = await agent.run("asr", nextInput("asr"), { mode: "require-final", timeoutMs: 300_000 });
        const j = await readJob(core, r.jobId);
        const e = opIndex(j.executor);
        if (e !== 0 && e !== 1) continue; // honest executor: nothing to catch
        jobId = r.jobId;
        const ev = await eventsOf(r.jobId);
        ok(ev.some((x) => x.name === "Challenged"), "challenger challenged the unaudited fake");
        const v = opIndex(j.verifier);
        if (v === 0 || v === 1) {
          ok(r.status === "Settled", "colluding verifier agreed");
          detail = `executor op${e} and verifier op${v} both colluded: the audit agreed and the fake settled (residual risk ~s^2, T2); challenger lost its bond`;
        } else {
          ok(r.status === "Refunded" && (await wrongSlashed(r.jobId)).includes(j.executor.toLowerCase()), `status ${r.status}`);
          detail = `executor op${e} colluded; challenge drew honest verifier op${v}; committee slashed the executor; challenger got bond + finder share`;
        }
        pass = true;
      }
      if (!pass) detail = "no colluder was drawn as executor in 10 jobs";
    } catch (e) {
      detail = String(e instanceof Error ? e.message : e);
    }
    results.push({ name: "collude-challenge", pass, seconds: (Date.now() - t0) / 1000, detail, jobId });
    console.log(`${pass ? "PASS" : "FAIL"} e2e:collude-challenge - ${detail}`);
  }

  // false challenge: a manual challenger challenges an honest unaudited result and loses its bond
  if (!only || only.includes("false-challenge")) {
    const t0 = Date.now();
    let pass = false;
    let detail = "";
    let jobId: string | undefined;
    beh.forEach((b) => Object.keys(b).forEach((k) => delete b[Number(k)]));
    await setAudit(1);
    const mc = connect(dep, new NonceManager(new Wallet(keys.manualChallenger, provider)));
    try {
      const pending = agent.run("asr", nextInput("asr"), { mode: "require-final", timeoutMs: 300_000 });
      // find the job and challenge it as soon as it enters the challenge window
      let id: string | null = null;
      for (let i = 0; i < 300 && !id; i++) {
        const jobs = (await fetch(`${base}/v1/jobs`).then((x) => x.json())) as Array<{ jobId: string; status: string }>;
        id = jobs.find((x) => x.status === "Challenge")?.jobId ?? null;
        if (!id) await sleep(200);
      }
      ok(id, "job reached the challenge window");
      const j = await readJob(core, id!);
      await (await mc.core.challenge(id!, { value: j.challengeBond, gasLimit: 3_000_000 })).wait();
      const r = await pending;
      jobId = r.jobId;
      const credits = await core.credits(addr(keys.manualChallenger));
      ok(r.status === "Settled" && credits === 0n, `status ${r.status}, challenger credits ${credits}`);
      detail = "unjustified challenge: the verifier agreed, the challenge bond was split executor / slashPool";
      pass = true;
    } catch (e) {
      detail = String(e instanceof Error ? e.message : e);
    }
    results.push({ name: "false-challenge", pass, seconds: (Date.now() - t0) / 1000, detail, jobId });
    console.log(`${pass ? "PASS" : "FAIL"} e2e:false-challenge - ${detail}`);
  }

  await scenario(
    "no-capacity",
    {
      audit: 1,
      setup: async () => {
        for (const k of opKeys.slice(0, 2)) {
          const c = connect(dep, new Wallet(k, provider));
          const o = await c.core.operators(new Wallet(k).address);
          await (await c.core.withdrawStake(o.free)).wait();
        }
        await gw.refreshPrices();
        await agent.discover();
      },
      teardown: async () => {
        for (const k of opKeys.slice(0, 2)) {
          const c = connect(dep, new Wallet(k, provider));
          await (await c.core.topUp({ value: STAKE })).wait();
        }
        await gw.refreshPrices();
        await agent.discover();
      },
    },
    async (r0) => {
      ok(r0 instanceof Error && /503|not offer/.test(r0.message), `expected refusal, got ${r0 instanceof Error ? r0.message : "success"}`);
      return `refused before payment (${(r0 as Error).message.slice(0, 60)}); nothing settled`;
    },
  );

  // one payment header replayed 20 times -> exactly one job (section 11)
  if (!only || only.includes("replay-payment-x20")) {
    const t0 = Date.now();
    let pass = false;
    let detail = "";
    try {
      await setAudit(1);
      let header: string | null = null;
      const client = x402Client.fromConfig({
        schemes: [{ network: "hedera:testnet", client: new FakeClientScheme(buyer) }],
        spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0" }] },
      });
      const inner: typeof fetch = async (input, init) => {
        const req = new Request(input as RequestInfo, init);
        header = req.headers.get("payment-signature") ?? header;
        return fetch(req);
      };
      const input = nextInput("asr");
      const mkForm = () => {
        const f = new FormData();
        f.append("file", new Blob([input]), "clip.wav");
        return f;
      };
      const first = await wrapFetchWithPayment(inner, client)(`${base}/v1/transcribe`, { method: "POST", body: mkForm() });
      const firstId = (await first.json()).jobId as string;
      ok(header, "captured the payment header");
      const ids = new Set<string>([firstId]);
      for (let i = 0; i < 20; i++) {
        const r = await fetch(`${base}/v1/transcribe`, { method: "POST", body: mkForm(), headers: { "PAYMENT-SIGNATURE": header! } });
        ids.add((await r.json()).jobId);
      }
      await sleep(4000);
      const created = gw.db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'JobCreated' AND lower(job_id) = lower(?)").get(firstId) as { n: number };
      ok(ids.size === 1 && created.n === 1, `distinct jobIds ${ids.size}, JobCreated ${created.n}`);
      detail = "21 requests with one payment header -> 1 jobId, 1 on-chain job";
      pass = true;
    } catch (e) {
      detail = String(e instanceof Error ? e.message : e);
    }
    results.push({ name: "replay-payment-x20", pass, seconds: (Date.now() - t0) / 1000, detail });
    console.log(`${pass ? "PASS" : "FAIL"} e2e:replay-payment-x20 - ${detail}`);
  }

  // ---------------------------------------------------------------- independent verifier
  for (const r of results.filter((x) => x.jobId && ["honest", "audited-agree", "garbage", "tolerance-garbage", "tolerance-honest-variation", "collude-challenge"].includes(x.name))) {
    const checks = await verifyJob(r.jobId!, { provider, addresses: dep, gatewayUrl: base });
    const failed = checks.filter((c) => c.result === "FAIL");
    const detail = checks.map((c) => `${c.result} ${c.name}`).join("; ");
    results.push({ name: `verify:${r.name}`, pass: failed.length === 0 && checks.length > 0, seconds: 0, detail, jobId: r.jobId });
    console.log(`${failed.length ? "FAIL" : "PASS"} verify:${r.name} - ${failed.length ? failed.map((c) => `${c.name}: ${c.detail}`).join("; ") : `${checks.length} checks`}`);
  }

  // ---------------------------------------------------------------- summary
  const bal = await provider.getBalance(dep.HALLMARK_ADDRESS);
  const acc = await core.accounted();
  const conserved = bal === acc;
  console.log(`\nconservation: balance ${bal} == accounted ${acc} -> ${conserved ? "PASS" : "FAIL"}`);
  console.log("agent spending:", agent.spend.summary().calls, "calls,", agent.spend.summary().spent);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios passed`);
  const outDir = join(import.meta.dirname, "../../docs/e2e");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "local-e2e.json"),
    JSON.stringify({ kind: "LOCAL (anvil): fake x402 facilitator, fake ASR/OCR workers. Not testnet evidence, not measurements.", ranAt: new Date().toISOString(), conservation: conserved, results }, null, 2) + "\n",
  );
  server.close();
  gw.stop();
  ops.forEach((o) => o.stop());
  challengerBot.stop();
  anvil.proc.kill();
  process.exit(passed === results.length && conserved ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
