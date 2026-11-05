/**
 * Copy contract ABIs from Foundry output (contracts/out; run `forge build`) into packages/shared/src/abi.
 *   pnpm gen:abi
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const names = ["Hallmark", "HallmarkJudge", "ModelRegistry", "Probe", "ProbeWrapper"];
const outDir = join(root, "packages/shared/src/abi");
mkdirSync(outDir, { recursive: true });

for (const n of names) {
  const forge = join(root, `contracts/out/${n === "ProbeWrapper" ? "Probe" : n}.sol/${n}.json`);
  const src = existsSync(forge) ? forge : null;
  if (!src) throw new Error(`no build output for ${n}; run forge build in contracts/`);
  const j = JSON.parse(readFileSync(src, "utf8"));
  writeFileSync(join(outDir, `${n}.json`), JSON.stringify(j.abi, null, 2) + "\n");
  console.log(`${n}: ${j.abi.length} ABI entries from ${src.replace(root + "/", "")}`);
}
