#!/usr/bin/env -S npx tsx
/**
 * hallmark-models <check|propose|enable|show> <manifest.json>
 *
 *   check    validate the manifest and its bond window against the LIVE audit rate (read only)
 *   propose  ModelRegistry.proposeModel from any account (stored disabled; nothing goes live)
 *   enable   ModelRegistry.enableModel from the registry OWNER, pinned to the proposal hash of exactly
 *            this manifest; refuses off chain first if the window is empty (the registry checks again)
 *   show     print the on-chain entry and any pending proposal for this manifest's modelKey
 *
 * env: RPC_URL, CHAIN_ID (default 296), REGISTRY_ADDRESS, HALLMARK_ADDRESS, and for propose/enable
 * PRIVATE_KEY (never printed). Testnet only.
 */
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { abis, DEFAULTS } from "@hallmark/shared";
import { manifestHash, modelIdOfKey, onChainModel, proposalHashOf } from "./schema.js";
import { bondWindowFor, describeCeiling, validateManifest } from "./validate.js";

const [cmd, file] = process.argv.slice(2);
if (!cmd || !file || !["check", "propose", "enable", "show"].includes(cmd)) {
  console.error("usage: hallmark-models <check|propose|enable|show> <manifest.json>");
  process.exit(2);
}
const need = (k: string) => process.env[k] ?? (console.error(`set ${k}`), process.exit(2));
const provider = new JsonRpcProvider(process.env.RPC_URL ?? DEFAULTS.rpcUrl, Number(process.env.CHAIN_ID ?? 296), { staticNetwork: true });
const runner = process.env.PRIVATE_KEY && cmd !== "check" && cmd !== "show" ? new Wallet(process.env.PRIVATE_KEY, provider) : provider;
const registry = new Contract(need("REGISTRY_ADDRESS"), abis.ModelRegistry, runner);
const core = new Contract(need("HALLMARK_ADDRESS"), abis.Hallmark, provider);

const raw = JSON.parse(readFileSync(file, "utf8"));
const [auditBps, minBond] = (await core.bondParams()) as [bigint, bigint];
const m = validateManifest(raw);
const id = modelIdOfKey(m.modelKey);
const w = bondWindowFor(m, Number(auditBps), minBond);
console.log(`${m.modelKey}  id ${id}`);
console.log(`class ${m.checkClass}${m.checkClass === "TOLERANCE" ? ` tau ${m.tauBps}` : ""}  pi ${m.piBps}  fp ${m.fpBps}  fee ${m.feeTinybar}  calibration ${m.calibration.status}`);
console.log(`at the live audit rate ${Number(auditBps) / 100}%: bond ${w.bond} tinybar, ceiling ${describeCeiling(w.ceiling)} -> ${w.empty ? "EMPTY" : "ok"}`);

const struct = onChainModel(m, false);
/** exactly what ModelRegistry.proposalHash returns once this manifest is proposed */
const expectedHash = proposalHashOf(m);

if (cmd === "check") process.exit(w.empty && m.enabled ? 1 : 0);
if (cmd === "show") {
  console.log("on chain:", (await registry.get(id)).toObject());
  console.log("proposal:", (await registry.proposal(id)).toObject(), "hash", await registry.proposalHash(id));
  process.exit(0);
}
if (!(runner instanceof Wallet)) {
  console.error("set PRIVATE_KEY to send a transaction");
  process.exit(2);
}
if (cmd === "propose") {
  const tx = await registry.proposeModel(id, struct, manifestHash(m), file.split("/").pop());
  console.log(`proposed: ${tx.hash}`);
  await tx.wait();
  console.log(`proposal hash ${await registry.proposalHash(id)} (expected ${expectedHash})`);
} else {
  if (!m.enabled) throw new Error("this manifest says enabled: false (describe only); refusing to enable it");
  if (w.empty) throw new Error("bond window is EMPTY at the live audit rate; refusing to enable");
  const onChainHash = await registry.proposalHash(id);
  if (onChainHash !== expectedHash) throw new Error(`the pending proposal is not this manifest (on chain ${onChainHash}, this file ${expectedHash}); propose it first`);
  const tx = await registry.enableModel(id, expectedHash);
  console.log(`enabled: ${tx.hash}`);
  await tx.wait();
}
