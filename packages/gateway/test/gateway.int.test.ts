import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ChildProcess } from "node:child_process";
import { JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { connect, loadEnv, modelIdOf, outputUploadMessage, sleep } from "@hallmark/shared";
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
    for (const path of [`/v1/jobs/${firstJob}`, `/v1/jobs/${firstJob}/result`]) {
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

  it("evidence store: rejects unsigned, mismatched or unrevealed output uploads", async () => {
    const op = new Wallet(devKey(2));
    const body = (o: Partial<{ text: string; outputHash: string; signature: string }>) => ({ jobId: firstJob, operator: op.address, outputHash: "0x" + "00".repeat(32), text: "hello", signature: "0x", ...o });
    const put = (b: unknown) => fetch(`${base}/outputs/${firstJob}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    expect((await put(body({ signature: "0x" + "11".repeat(65) }))).status).toBeGreaterThanOrEqual(400);
    const { outputHashOf } = await import("@hallmark/shared");
    const h = outputHashOf("hello");
    const sig = await op.signMessage(outputUploadMessage({ jobId: firstJob, operator: op.address, outputHash: h }));
    expect((await put(body({ outputHash: h, text: "other", signature: sig }))).status).toBe(400);
    expect((await put(body({ outputHash: h, signature: sig }))).status).toBe(409); // no revealed seat
    expect((await fetch(`${base}/inputs/${(await gw.contracts.core.getJob(firstJob)).inputHash}`)).status).toBe(200);
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
