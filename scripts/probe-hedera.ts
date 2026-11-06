/**
 * Gate G2: exercise the deployed Probe (and ProbeWrapper) on Hedera testnet and record real behavior.
 *   env: PROBE_ADDRESS, PROBE_WRAPPER_ADDRESS, PROBE_PRIVATE_KEY (ECDSA), optional HALLMARK_ADDRESS
 *        (to record deployed code size), RPC_URL, MIRROR_NODE_URL
 * Writes docs/gates/G2.raw.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, ethers } from "ethers";
import { abis, DEFAULTS, MirrorNode, sleep, tinybarToWeibar } from "../packages/shared/src/index.js";

const rpc = process.env.RPC_URL ?? DEFAULTS.rpcUrl;
const provider = new JsonRpcProvider(rpc, 296, { staticNetwork: true });
const wallet = new Wallet(process.env.PROBE_PRIVATE_KEY!, provider);
const probe = new Contract(process.env.PROBE_ADDRESS!, abis.Probe, wallet);
const wrapper = process.env.PROBE_WRAPPER_ADDRESS ? new Contract(process.env.PROBE_WRAPPER_ADDRESS, abis.ProbeWrapper, wallet) : null;
const mirror = new MirrorNode(process.env.MIRROR_NODE_URL ?? DEFAULTS.mirrorNodeUrl);
const out: Record<string, unknown> = { ranAt: new Date().toISOString(), rpc, probe: probe.target };

async function timed(label: string, send: () => Promise<ethers.TransactionResponse>) {
  const t0 = Date.now();
  const tx = await send();
  const rc = await tx.wait();
  const confirmMs = Date.now() - t0;
  let mirrorLagMs: number | null = null;
  let chargedFeeTinybar: number | null = null;
  for (let i = 0; i < 30; i++) {
    try {
      const f = await mirror.feeForEvmTx(tx.hash);
      mirrorLagMs = Date.now() - t0 - confirmMs;
      chargedFeeTinybar = f.chargedFeeTinybar;
      break;
    } catch {
      await sleep(1000);
    }
  }
  const row = { hash: tx.hash, status: rc?.status, gasUsed: rc?.gasUsed.toString(), confirmMs, mirrorLagMs, chargedFeeTinybar };
  out[label] = row;
  console.log(label, row);
  return rc!;
}
const parse = (rc: ethers.TransactionReceipt, name: string) => rc.logs.map((l) => probe.interface.parseLog(l)).find((e) => e?.name === name);

// 1. units: 1 HBAR on the wire (1e18 weibar) -> what does Solidity see? and the constructor value
const rc1 = await timed("deposit_1HBAR", () => probe.deposit({ value: tinybarToWeibar(100_000_000n), gasLimit: 200_000 }));
const d = parse(rc1, "Deposit");
out.units = { msgValueSeen: d?.args.msgValue.toString(), expectTinybar: "100000000", tinybarInsideSolidity: d?.args.msgValue.toString() === "100000000", balanceSeen: d?.args.balance.toString(), rpcBalanceWire: (await provider.getBalance(probe.target)).toString() };
out.constructorValue = (await probe.constructorValue()).toString();

// 2. PRNG precompile 0x169: two transactions, and twice inside one transaction
for (const k of ["seed_tx1", "seed_tx2"]) {
  const rc = await timed(k, () => probe.seed({ gasLimit: 200_000 }));
  const e = parse(rc, "Seed");
  out[`${k}_result`] = { ok: e?.args.ok, len: e?.args.len.toString(), seed: e?.args.seed };
}
const rcTwice = await timed("seed_twice_same_tx", () => probe.seedTwice({ gasLimit: 400_000 }));
out.seed_twice_values = rcTwice.logs.map((l) => probe.interface.parseLog(l)).filter((e) => e?.name === "Seed").map((e) => e!.args.seed);

// 3. tx.origin: direct call vs through a wrapper contract
const rcO = await timed("origin_direct", () => probe.origin({ gasLimit: 100_000 }));
out.origin_direct = parse(rcO, "Origin")?.args.equal;
if (wrapper) {
  const rcW = await timed("origin_via_wrapper", () => wrapper.callOrigin(probe.target, { gasLimit: 200_000 }));
  out.origin_via_wrapper = parse(rcW, "Origin")?.args.equal;
}

// 4. deployed code sizes
for (const k of ["HALLMARK_ADDRESS", "JUDGE_ADDRESS", "REGISTRY_ADDRESS"]) {
  const a = process.env[k];
  if (a) out[`codeSize_${k}`] = (ethers.dataLength(await provider.getCode(a)));
}

const dir = join(import.meta.dirname, "../docs/gates");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "G2.raw.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote docs/gates/G2.raw.json (also try shanghai/cancun builds of Probe, G2.4)");
