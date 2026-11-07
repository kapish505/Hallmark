/**
 * Pack the core as 0.x alpha npm packages. Workspace code is bundled in, so each package installs on its
 * own from npm deps only (ethers, zod). Published names (the @hallmark scope on npm belongs to someone
 * else): @kapish505/hallmark-contracts, -model-spec, -sdk, -operator. Override the scope with NPM_SCOPE.
 *   npx tsx scripts/pack-core.ts                 -> dist-pack/*.tgz
 *   npx tsx scripts/pack-core.ts --publish       -> also npm publish each (needs `npm login`), tag alpha
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "dist-pack");
const STAGE = join(OUT, "stage");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
const DEPS = { ethers: "6.13.1", zod: "3.23.8" };
const SCOPE = process.env.NPM_SCOPE ?? "@kapish505";
const NAME: Record<string, string> = {
  contracts: `${SCOPE}/hallmark-contracts`,
  "model-spec": `${SCOPE}/hallmark-model-spec`,
  sdk: `${SCOPE}/hallmark-sdk`,
  operator: `${SCOPE}/hallmark-operator`,
};
const PUBLISH = process.argv.includes("--publish");
const REPO = "https://github.com/kapish505/Hallmark";
const COMMON = {
  license: "MIT",
  author: "kapish505",
  homepage: "https://hallmark-two.vercel.app/docs",
  repository: { type: "git", url: `git+${REPO}.git` },
  bugs: { url: `${REPO}/issues` },
  keywords: ["hallmark", "verifiable-inference", "hedera", "x402", "ai", "slashing", "bonds"],
  engines: { node: ">=20" },
  publishConfig: { access: "public", tag: "alpha" },
};
const published: string[] = [];
const pkgJson = (dir: string) => JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));

async function bundle(entry: string, outfile: string, banner = "") {
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["ethers", "zod"],
    banner: { js: `${banner}import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);` },
    logLevel: "warning",
  });
}

/** declarations for one package's public entry; refuses if they leak a workspace-only import */
function dts(entry: string, outFile: string) {
  const tmp = join(STAGE, "_dts");
  rmSync(tmp, { recursive: true, force: true });
  const cfg = join(tmp, "tsconfig.json");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(
    cfg,
    JSON.stringify({
      extends: join(ROOT, "tsconfig.base.json"),
      compilerOptions: { declaration: true, emitDeclarationOnly: true, outDir: join(tmp, "out"), rootDir: join(ROOT, "packages"), noEmit: false },
      files: [join(ROOT, entry)],
    }),
  );
  execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", cfg], { stdio: "inherit" });
  const rel = entry.replace(/^packages\//, "").replace(/\.ts$/, ".d.ts");
  const text = readFileSync(join(tmp, "out", rel), "utf8");
  if (/(from |import\()"@hallmark\//.test(text)) throw new Error(`${entry}: public types reference a workspace package`);
  writeFileSync(outFile, text);
  // sibling module declarations re-exported by the entry
  for (const m of text.matchAll(/from "\.\/([^"]+)\.js"/g)) {
    const sib = join(tmp, "out", rel.replace(/[^/]+\.d\.ts$/, `${m[1]}.d.ts`));
    if (existsSync(sib)) writeFileSync(join(outFile, "..", `${m[1]}.d.ts`), readFileSync(sib, "utf8"));
  }
}

function pack(dir: string, key: string, manifest: Record<string, unknown>) {
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  cpSync(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  cpSync(join(ROOT, "scripts/npm-readmes", `${key}.md`), join(dir, "README.md"));
  const out = execFileSync("npm", ["pack", "--pack-destination", OUT], { cwd: dir, encoding: "utf8" }).trim().split("\n").pop();
  console.log(`packed ${out}`);
  if (PUBLISH) {
    execFileSync("npm", ["publish", "--access", "public", "--tag", "alpha"], { cwd: dir, stdio: "inherit" });
    published.push(`${manifest.name}@${manifest.version}`);
  }
}
const meta = (dir: string) => {
  const p = pkgJson(dir);
  return { name: NAME[dir], version: p.version, description: p.description, type: "module", ...COMMON };
};

// ---- @hallmark/contracts
{
  const d = join(STAGE, "contracts");
  mkdirSync(join(d, "abi"), { recursive: true });
  mkdirSync(join(d, "src"), { recursive: true });
  for (const n of ["Hallmark", "HallmarkVerdict", "ModelRegistry", "HallmarkJudge"]) cpSync(join(ROOT, "packages/shared/src/abi", `${n}.json`), join(d, "abi", `${n}.json`));
  for (const f of ["index.js", "index.d.ts"]) cpSync(join(ROOT, "packages/contracts", f), join(d, f));
  cpSync(join(ROOT, "packages/contracts/deployments"), join(d, "deployments"), { recursive: true });
  cpSync(join(ROOT, "contracts/src"), join(d, "src"), { recursive: true });
  cpSync(join(ROOT, "contracts/examples"), join(d, "examples"), { recursive: true });
  cpSync(join(ROOT, "contracts/script/Deploy.s.sol"), join(d, "script/Deploy.s.sol"));
  const p = pkgJson("contracts");
  pack(d, "contracts", { ...meta("contracts"), exports: p.exports, files: ["index.js", "index.d.ts", "abi", "deployments", "src", "examples", "script"] });
}

// ---- @hallmark/model-spec
{
  const d = join(STAGE, "model-spec");
  mkdirSync(join(d, "dist"), { recursive: true });
  await bundle("packages/model-spec/src/index.ts", join(d, "dist/index.js"));
  await bundle("packages/model-spec/src/calibrate-cli.ts", join(d, "dist/calibrate-cli.js"));
  await bundle("packages/model-spec/src/models-cli.ts", join(d, "dist/models-cli.js"));
  dts("packages/model-spec/src/index.ts", join(d, "dist/index.d.ts"));
  cpSync(join(ROOT, "models"), join(d, "models"), { recursive: true });
  pack(d, "model-spec", {
    ...meta("model-spec"),
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    bin: { "hallmark-calibrate": "./dist/calibrate-cli.js", "hallmark-models": "./dist/models-cli.js" },
    files: ["dist", "models"],
    dependencies: DEPS,
  });
}

// ---- @hallmark/sdk
{
  const d = join(STAGE, "sdk");
  mkdirSync(join(d, "dist"), { recursive: true });
  await bundle("packages/sdk/src/index.ts", join(d, "dist/index.js"));
  dts("packages/sdk/src/index.ts", join(d, "dist/index.d.ts"));
  pack(d, "sdk", { ...meta("sdk"), exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }, files: ["dist"], dependencies: { ethers: DEPS.ethers } });
}

// ---- @hallmark/operator
{
  const d = join(STAGE, "operator");
  mkdirSync(join(d, "dist"), { recursive: true });
  await bundle("packages/operator/src/cli.ts", join(d, "dist/cli.js"));
  cpSync(join(ROOT, "models"), join(d, "models"), { recursive: true });
  cpSync(join(ROOT, "packages/contracts/deployments"), join(d, "deployments"), { recursive: true });
  cpSync(join(ROOT, "packages/operator/worker"), join(d, "workers"), { recursive: true });
  pack(d, "operator", { ...meta("operator"), bin: { "hallmark-operator": "./dist/cli.js" }, files: ["dist", "models", "deployments", "workers"], dependencies: DEPS });
}
rmSync(STAGE, { recursive: true, force: true });
if (PUBLISH) {
  // make each alpha the default install too (there is no stable release yet)
  for (const p of published) execFileSync("npm", ["dist-tag", "add", p, "latest"], { stdio: "inherit" });
  console.log(`published: ${published.join(", ")}`);
}
