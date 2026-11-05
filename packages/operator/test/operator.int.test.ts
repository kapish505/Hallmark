import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { JsonRpcProvider, NonceManager, Wallet, keccak256 } from "ethers";
import { connect, ifaces, modelIdOf, readJob, Role, RpcLogSource, Status, TxSender } from "@hallmark/shared";
import { Operator, PendingStore, StateFile, type EvidenceClient } from "../src/index.js";
import { ASR_KEY, deployAll, devKey, startAnvil, synthWav, type Deployment } from "../../../scripts/local/chain.js";
import { FakeWorker } from "../../../scripts/local/fakes.js";

let anvil: { proc: ChildProcess; url: string; provider: JsonRpcProvider };
let dep: Deployment;
const input = synthWav(1, 321);
const evidence = { input: async () => input, upload: async () => {}, outputByHash: async () => null } as unknown as EvidenceClient;

beforeAll(async () => {
  anvil = await startAnvil(19545 + Math.floor(Math.random() * 1000));
  dep = await deployAll(anvil.provider, { ownerKey: devKey(0), gateway: new Wallet(devKey(1)).address, auditBps: 1 });
  for (const i of [2, 3, 4, 5, 6]) {
    const c = connect(dep, new NonceManager(new Wallet(devKey(i), anvil.provider)));
    await (await c.core.registerOperator({ value: 10n ** 15n })).wait();
  }
}, 60_000);
afterAll(() => anvil?.proc.kill());

function makeOperator(key: string, stateDir: string) {
  const wallet = new Wallet(key, anvil.provider);
  return new Operator({
    contracts: connect(dep, wallet),
    sender: new TxSender(wallet, { defaultGasLimit: 2_000_000 }),
    wallet,
    source: new RpcLogSource(anvil.provider, [{ address: dep.HALLMARK_ADDRESS, iface: ifaces.core }], 0),
    worker: new FakeWorker(),
    evidence,
    evidenceBase: "http://unused",
    pending: new PendingStore(stateDir),
    state: new StateFile(join(stateDir, "state.json")),
    behavior: () => "honest",
    chainId: 31337,
    units: "evm",
    gasLimit: 2_000_000,
    gasLimitHeavy: 8_000_000,
    pollMs: 200,
    lazyModel: "tiny",
    tasks: ["asr"],
  });
}

describe("operator crash recovery (section 9.2)", () => {
  it("persists {output, salt} before committing and reveals after a restart", async () => {
    const gwc = connect(dep, new NonceManager(new Wallet(devKey(1), anvil.provider)));
    const id = keccak256(new TextEncoder().encode("crash-test"));
    const [price] = await gwc.core.quote(modelIdOf(ASR_KEY));
    await (await gwc.core.createJob(id, new Wallet(devKey(12)).address, keccak256(input), modelIdOf(ASR_KEY), { value: price })).wait();
    const j = await readJob(gwc.core, id);
    const key = [2, 3, 4, 5, 6].map(devKey).find((k) => new Wallet(k).address === j.executor)!;
    const dir = mkdtempSync(join(tmpdir(), "hallmark-op-"));

    const first = makeOperator(key, dir);
    await first.take(id, Role.Executor);
    expect((await readJob(gwc.core, id)).status).toBe(Status.Committed);
    const rec = new PendingStore(dir).get(id)!;
    expect(rec.committed).toBe(true);
    // "crash": the first process is gone; the audit is drawn meanwhile
    const keeper = new Wallet(devKey(13), anvil.provider);
    await (await connect(dep, keeper).core.drawAudit(id)).wait();
    expect((await readJob(gwc.core, id)).status).toBe(Status.Reveal);

    const second = makeOperator(key, dir);
    await second.recover();
    const s = await gwc.core.seat(id, j.executor);
    expect(s.revealed).toBe(true);
    expect(s.outputHash).toBe(rec.outputHash);
    expect((await readJob(gwc.core, id)).status).toBe(Status.Challenge);
  }, 60_000);
});
