import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ChildProcess } from "node:child_process";
import { JsonRpcProvider, NonceManager, Wallet, keccak256 } from "ethers";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { connect, loadEnv, modelIdOf, outCommitOf, outputUploadMessage, readMessage, saltCommitOf, sleep } from "@hallmark/shared";
import { buildGateway, GatewayEnv } from "../src/index.js";
import { ASR_KEY, deployAll, devKey, OCR_KEY, startAnvil, synthPng, synthWav, type Deployment } from "../../../scripts/local/chain.js";
import { FakeClientScheme, FakeFacilitator } from "../../../scripts/local/fakes.js";

let anvil: { proc: ChildProcess; url: string; provider: JsonRpcProvider };
let dep: Deployment;
let gw: Awaited<ReturnType<typeof buildGateway>>;
let server: ReturnType<typeof gw.app.listen>;
let base: string;
const facilitator = new FakeFacilitator();
const buyer = new Wallet(devKey(12));
const priceOf = (t: "asr" | "ocr") => gw.tasks.find((x) => x.task === t)!.priceTinybar;

function paidFetch(record?: (h: Headers) => void) {
  const client = x402Client.fromConfig({
    schemes: [{ network: "hedera:testnet", client: new FakeClientScheme(buyer.address) }],
    spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0" }] },
  });
  const inner: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    record?.(req.headers);
    return fetch(req);
  };
  return wrapFetchWithPayment(inner, client);
}

function form(bytes: Uint8Array, name = "clip.wav") {
  const f = new FormData();
  f.append("file", new Blob([bytes]), name);
  return f;
}

async function waitFor<T>(fn: () => T | undefined | null | false, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout");
    await sleep(100);
  }
}

beforeAll(async () => {
  anvil = await startAnvil(18545 + Math.floor(Math.random() * 1000));
  const gatewayKey = devKey(1);
  dep = await deployAll(anvil.provider, { ownerKey: devKey(0), gateway: new Wallet(gatewayKey).address });
  for (const i of [2, 3, 4, 5, 6]) {
    const m = connect(dep, new NonceManager(new Wallet(devKey(i), anvil.provider)));
    await (await m.core.registerOperator({ value: 1_000_000_000n })).wait();
  }
  const dir = mkdtempSync(join(tmpdir(), "hallmark-gw-"));
  const env = loadEnv(GatewayEnv, {
    RPC_URL: anvil.url,
    CHAIN_ID: "31337",
    LOG_SOURCE: "rpc",
    POLL_MS: "300",
    ...dep,
    GATEWAY_PRIVATE_KEY: gatewayKey,
    ASR_MODEL_KEY: ASR_KEY,
    OCR_MODEL_KEY: OCR_KEY,
    DB_PATH: join(dir, "db.sqlite"),
    BLOB_DIR: join(dir, "blobs"),
    KEEPER: "false",
    RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: "http://127.0.0.1",
  });
  gw = await buildGateway(env, { facilitator, facilitatorUrl: "local-fake" });
  gw.indexer.start();
  server = gw.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => {
  server?.close();
  gw?.stop();
  anvil?.proc.kill();
});

describe("gateway x402 flow", () => {
  it("serves the discovery manifest with both tasks, priced from the contract", async () => {
    const m = await fetch(`${base}/.well-known/hallmark.json`).then((r) => r.json());
    expect(m.network).toBe("hedera:testnet");
    expect(m.asset).toBe("0.0.0");
    expect(m.tasks.map((t: { task: string }) => t.task)).toEqual(["asr", "ocr"]);
    const [p] = await gw.contracts.core.quote(modelIdOf(ASR_KEY));
    expect(m.tasks[0].priceTinybar).toBe(p.toString());
    expect(m.tasks[1].class).toBe("TOLERANCE");
  });

  it("answers 402 with each task's own fixed price", async () => {
    for (const [path, t] of [["/v1/transcribe", "asr"], ["/v1/ocr", "ocr"]] as const) {
      const r = await fetch(`${base}${path}`, { method: "POST", body: form(synthWav(1)) });
      expect(r.status).toBe(402);
      const decoded = JSON.parse(Buffer.from(r.headers.get("payment-required")!, "base64").toString("utf8"));
      expect(decoded.accepts[0]).toMatchObject({ scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: priceOf(t).toString(), maxTimeoutSeconds: 30 });
    }
  });

  let firstJob = "";
  let paidHeaders: Headers | null = null;
  const audio = synthWav(3, 300);

  it("pays, returns 202 + jobId, settles, and creates the job on chain", async () => {
    const r = await paidFetch((h) => {
      if (h.get("payment-signature")) paidHeaders = h;
    })(`${base}/v1/transcribe`, { method: "POST", body: form(audio) });
    expect(r.status).toBe(202);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    firstJob = (await r.json()).jobId;
    expect(facilitator.settled.at(-1)!.amount).toBe(priceOf("asr").toString());
    await waitFor(() => gw.db.job(firstJob)?.payment_status === "Created");
    const j = await gw.contracts.core.getJob(firstJob);
    expect(Number(j.status)).toBe(1); // Assigned
    expect(String(j.buyer).toLowerCase()).toBe(buyer.address.toLowerCase());
  });

  it("OCR: a PNG is accepted on /v1/ocr", async () => {
    const r = await paidFetch()(`${base}/v1/ocr`, { method: "POST", body: form(synthPng(40, 20, 1), "a.png") });
    expect(r.status).toBe(202);
    const { jobId } = await r.json();
    await waitFor(() => gw.db.job(jobId)?.payment_status === "Created");
    expect((await gw.contracts.core.getJob(jobId)).modelId).toBe(modelIdOf(OCR_KEY));
  });

  it("replaying one payment header 20 times yields exactly one job (section 11)", async () => {
    expect(paidHeaders).toBeTruthy();
    const before = gw.db.jobsWhere("1 = 1").length;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${base}/v1/transcribe`, { method: "POST", headers: { "payment-signature": paidHeaders!.get("payment-signature")! }, body: form(audio) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })),
      ),
    );
    for (const r of results.filter((x) => x.status === 202)) expect(r.body.jobId).toBe(firstJob);
    await sleep(500);
    expect(gw.db.jobsWhere("1 = 1").length).toBe(before);
  });

  it("job and result responses are not cacheable", async () => {
    for (const path of [`/v1/jobs/${firstJob}`, `/v1/jobs/${firstJob}/result?token=${gw.db.job(firstJob)!.access_token}`]) {
      const r = await fetch(`${base}${path}`);
      expect(r.headers.get("cache-control")).toMatch(/no-store/);
      expect(r.headers.get("vary")).toMatch(/PAYMENT-SIGNATURE/);
    }
  });

  it("edge case 2: a handler failure (non-canonical input) is not settled", async () => {
    const before = facilitator.settled.length;
    const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(new Uint8Array(200)) });
    expect(r.status).toBe(415);
    const png = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(synthPng()) });
    expect(png.status).toBe(415);
    expect(facilitator.settled.length).toBe(before);
  });

  it("rejects audio longer than the limit before settlement", async () => {
    const before = facilitator.settled.length;
    const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(synthWav(16)) });
    expect(r.status).toBe(415);
    expect(facilitator.settled.length).toBe(before);
  });

  it("if settlement fails, no job is created", async () => {
    facilitator.failSettle = true;
    try {
      const before = gw.db.jobsWhere("payment_status != 'PendingSettlement'").length;
      const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(synthWav(2, 500)) });
      expect(r.status).not.toBe(202);
      await sleep(500);
      expect(gw.db.jobsWhere("payment_status != 'PendingSettlement'").length).toBe(before);
    } finally {
      facilitator.failSettle = false;
    }
  });

  it("edge case 3: createJob reverting after settlement refunds the payer the full price", async () => {
    // the owner changes the fee after the gateway quoted it: createJob reverts with WrongValue
    const owner = connect(dep, new NonceManager(new Wallet(devKey(0), anvil.provider)));
    const p = (await owner.core.getParams()).toObject();
    await (await owner.core.setParams({ ...p, protocolFee: p.protocolFee + 1n })).wait();
    try {
      const balBefore = await anvil.provider.getBalance(buyer.address);
      const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(synthWav(2, 600)) });
      expect(r.status).toBe(202);
      const { jobId } = await r.json();
      const row = await waitFor(() => {
        const j = gw.db.job(jobId);
        return j?.payment_status === "Rejected" ? j : null;
      });
      expect(row.error).toMatch(/WrongValue/);
      expect(row.refund_tx).toBeTruthy();
      expect((await anvil.provider.getBalance(buyer.address)) - balBefore).toBe(priceOf("asr"));
    } finally {
      await (await owner.core.setParams(p)).wait();
    }
  });

  it("add-on A1: salt, input and result are private; the buyer token unlocks them", async () => {
    const row = gw.db.job(firstJob)!;
    for (const path of ["/salt", "/input", "/result", `/outputs/${new Wallet(devKey(2)).address}`]) {
      expect((await fetch(`${base}/v1/jobs/${firstJob}${path}`)).status).toBe(403);
    }
    // a signed request from an address with no role on this job is refused too
    const stranger = new Wallet(devKey(15));
    const ts = Math.floor(Date.now() / 1000);
    const sig = await stranger.signMessage(readMessage(firstJob, stranger.address, ts));
    const h = { "X-Hallmark-Address": stranger.address, "X-Hallmark-Timestamp": String(ts), "X-Hallmark-Signature": sig };
    expect((await fetch(`${base}/v1/jobs/${firstJob}/salt`, { headers: h })).status).toBe(403);
    // the executor (holds a role) may read the salt
    const j = await gw.contracts.core.getJob(firstJob);
    const exec = new Wallet([2, 3, 4, 5, 6].map(devKey).find((k) => new Wallet(k).address === j.executor)!);
    const sig2 = await exec.signMessage(readMessage(firstJob, exec.address, ts));
    const s2 = await fetch(`${base}/v1/jobs/${firstJob}/salt`, { headers: { "X-Hallmark-Address": exec.address, "X-Hallmark-Timestamp": String(ts), "X-Hallmark-Signature": sig2 } });
    expect(s2.status).toBe(200);
    const { jobSalt } = await s2.json();
    expect(saltCommitOf(jobSalt)).toBe(j.saltCommit);
    // the buyer token works and the salt is never in the public view
    const auth = { Authorization: `Bearer ${row.access_token}` };
    expect((await fetch(`${base}/v1/jobs/${firstJob}/input`, { headers: auth })).status).toBe(200);
    const pub = await fetch(`${base}/v1/jobs/${firstJob}`).then((r) => r.text());
    expect(pub).not.toContain(jobSalt.slice(2));
    expect(pub).not.toContain(row.access_token);
  });

  it("evidence store: rejects unsigned, mismatched or unrevealed output uploads", async () => {
    const op = new Wallet(devKey(2));
    const put = (b: unknown) => fetch(`${base}/v1/jobs/${firstJob}/outputs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const row = gw.db.job(firstJob)!;
    const oc = outCommitOf({ chainId: 31337, core: dep.HALLMARK_ADDRESS, jobId: firstJob, jobSalt: row.job_salt, text: "hello" });
    const rawHash = keccak256(new TextEncoder().encode(""));
    const sig = await op.signMessage(outputUploadMessage({ jobId: firstJob, operator: op.address, outCommit: oc, rawHash }));
    expect((await put({ jobId: firstJob, operator: op.address, outCommit: oc, text: "hello", signature: "0x" + "11".repeat(65) })).status).toBeGreaterThanOrEqual(400);
    expect((await put({ jobId: firstJob, operator: op.address, outCommit: oc, text: "other", signature: sig })).status).toBe(400);
    expect((await put({ jobId: firstJob, operator: op.address, outCommit: oc, text: "hello", signature: sig })).status).toBe(409); // no revealed seat
  });

  it("add-on A3: a validator outside the whitelist is rejected before settlement", async () => {
    const before = facilitator.settled.length;
    const f = form(synthWav(2, 650));
    f.append("validator", "invoice_total");
    const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: f });
    expect(r.status).toBe(400); // invoice_total is OCR-only
    const g = form(synthWav(2, 651));
    g.append("validator", "rm -rf");
    expect((await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: g })).status).toBe(400);
    expect(facilitator.settled.length).toBe(before);
    const ok = form(synthWav(2, 652));
    ok.append("validator", "min_words:2");
    const r2 = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: ok });
    expect(r2.status).toBe(202);
    expect((await r2.json()).validator).toBe("min_words:2");
  });

  it("edge case 4: not enough eligible operators -> 503 before payment", async () => {
    for (const i of [2, 3]) {
      const c = connect(dep, new NonceManager(new Wallet(devKey(i), anvil.provider)));
      const o = await c.core.operators(new Wallet(devKey(i)).address);
      await (await c.core.withdrawStake(o.free)).wait();
    }
    await gw.refreshPrices();
    const before = facilitator.settled.length;
    const r = await paidFetch()(`${base}/v1/transcribe`, { method: "POST", body: form(synthWav(2, 700)) });
    expect(r.status).toBe(503);
    expect(facilitator.settled.length).toBe(before);
  });
});
