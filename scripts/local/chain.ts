/**
 * Local chain harness (anvil) for integration tests and the local e2e. Uses anvil's well-known
 * dev mnemonic at runtime: nothing here is deployment data and none of it touches a real network.
 * Model parameters below are [LOCAL] test values, not measurements.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, Mnemonic, NonceManager, Wallet } from "ethers";
import { connect, modelIdOf, sleep } from "../../packages/shared/src/index.js";

const ROOT = join(import.meta.dirname, "../..");
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

export function devKey(i: number): string {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(ANVIL_MNEMONIC), `m/44'/60'/0'/0/${i}`).privateKey;
}

export async function startAnvil(port: number): Promise<{ proc: ChildProcess; url: string; provider: JsonRpcProvider }> {
  const anvil = process.env.ANVIL_BIN ?? join(process.env.HOME ?? "", ".foundry/bin/anvil");
  const proc = spawn(anvil, ["--port", String(port), "--silent", "--chain-id", "31337", "--accounts", "20", "--balance", "100000", "--block-time", "1"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, 31337, { staticNetwork: true, pollingInterval: 200 });
  for (let i = 0; i < 50; i++) {
    try {
      await provider.getBlockNumber();
      return { proc, url, provider };
    } catch {
      await sleep(200);
    }
  }
  proc.kill();
  throw new Error("anvil did not start (is Foundry installed? set ANVIL_BIN)");
}

function artifact(name: string) {
  const j = JSON.parse(readFileSync(join(ROOT, `contracts/out/${name}.sol/${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as string };
}

export const ASR_KEY = "ASR_V1";
export const OCR_KEY = "OCR_V1";

export interface Deployment {
  HALLMARK_ADDRESS: string;
  JUDGE_ADDRESS: string;
  REGISTRY_ADDRESS: string;
}

/** Deploy Judge + Registry + Hallmark, set fast (20 s) windows, register both models. */
export async function deployAll(provider: JsonRpcProvider, o: { ownerKey: string; gateway: string; auditBps?: number; committeeSize?: number }): Promise<Deployment> {
  const owner = new NonceManager(new Wallet(o.ownerKey, provider));
  const ownerAddr = await owner.getAddress();
  const dep = async (name: string, ...args: unknown[]) => {
    const a = artifact(name);
    const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args);
    await c.waitForDeployment();
    return c.getAddress();
  };
  const registry = await dep("ModelRegistry", ownerAddr);
  const judge = await dep("HallmarkJudge");
  const core = await dep("Hallmark", ownerAddr, registry, judge, o.gateway);
  const d: Deployment = { HALLMARK_ADDRESS: core, JUDGE_ADDRESS: judge, REGISTRY_ADDRESS: registry };
  const c = connect(d, owner);
  await (await c.registry.setHallmark(core)).wait();
  await setAuditBps(c, o.auditBps ?? 3000, o.committeeSize);
  const model = (cls: number, spec: number, tau: number, fp: number, fee: bigint) => ({
    class: cls,
    tauBps: tau,
    normSpec: spec,
    minWords: 1,
    maxWords: 96,
    enabled: true,
    piBps: 5000,
    fpBps: fp,
    runtimeDigest: "0x" + "00".repeat(32),
    hwClass: "0x" + "00".repeat(32),
    fee,
    cTinybar: (fee * 3n) / 4n,
    marginTinybar: fee / 4n,
  });
  await (await c.registry.setModel(modelIdOf(ASR_KEY), model(0, 1, 0, 0, 20_000_000n))).wait();
  await (await c.registry.setModel(modelIdOf(OCR_KEY), model(1, 2, 8000, 0, 10_000_000n))).wait();
  return d;
}

/** Change the audit rate (and keep 20 s windows). */
export async function setAuditBps(c: ReturnType<typeof connect>, auditBps: number, committeeSize?: number) {
  const p = (await c.core.getParams()).toObject();
  await (
    await c.core.setParams({
      ...p,
      auditBps,
      committeeSize: committeeSize ?? p.committeeSize,
      commitWindow: 20,
      drawWindow: 20,
      revealWindow: 20,
      challengeWindow: 20,
      committeeWindow: 20,
      minBond: 10_000_000n,
      minStake: 10_000_000n,
    })
  ).wait();
}

/** Deterministic synthetic 16 kHz mono 16-bit PCM WAV (a tone), generated at runtime. */
export function synthWav(seconds: number, freq = 440, seed = 0): Uint8Array {
  const rate = 16000;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * (freq + seed) * i) / rate)), 44 + i * 2);
  return new Uint8Array(buf);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Valid 8-bit grayscale PNG with a seeded pattern (local test input; never real OCR data). */
export function synthPng(w = 64, h = 32, seed = 0): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 7 + y * 13 + seed * 31) & 0xff;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
