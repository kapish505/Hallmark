#!/usr/bin/env node
/**
 * hallmark-operator (0.x alpha): run a bonded Hallmark operator.
 *
 *   hallmark-operator init [dir]          write .env, docker-compose.yml and the model manifests into dir
 *   hallmark-operator run [--env .env]    register (stake) if needed, then serve executor / verifier / committee seats
 *   hallmark-operator status [--env .env] registration, free and locked stake, credits, pool size, worker health
 *
 * The operator never holds a model: each model runs in its own pinned container (see docker-compose.yml);
 * the manifest in models/ names the env var with that container's URL. Testnet only.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, formatUnits, JsonRpcProvider, Wallet } from "ethers";
import { abis, loadEnv } from "@hallmark/shared";
import { selectManifests, workerUrls } from "@hallmark/model-spec";
import { OperatorEnv } from "./env.js";
import { runOperator } from "./run.js";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : undefined;
};
const loadFile = () => {
  const f = flag("--env") ?? ".env";
  if (existsSync(f)) process.loadEnvFile(f);
};

/** files shipped next to the bundle (package root): models/, deployments/, templates/ */
const asset = (...p: string[]) => [join(here, "..", ...p), join(here, "../../..", ...p)].find((x) => existsSync(x)) ?? join(here, "..", ...p);

function init(dir: string) {
  mkdirSync(join(dir, "models"), { recursive: true });
  for (const f of readdirSync(asset("models")).filter((x) => x.endsWith(".json"))) copyFileSync(join(asset("models"), f), join(dir, "models", f));
  const models = selectManifests(join(dir, "models"));
  const dep = asset("deployments", "hedera-testnet.json");
  const addrs: Record<string, string> = existsSync(dep) ? JSON.parse(readFileSync(dep, "utf8")) : {};
  const envFile = join(dir, ".env");
  if (!existsSync(envFile)) {
    writeFileSync(
      envFile,
      [
        "# hallmark-operator: testnet only. Keep this file private (it holds your key).",
        "OPERATOR_PRIVATE_KEY=",
        "RPC_URL=https://testnet.hashio.io/api",
        "CHAIN_ID=296",
        `HALLMARK_ADDRESS=${addrs.HALLMARK_ADDRESS ?? ""}`,
        `REGISTRY_ADDRESS=${addrs.REGISTRY_ADDRESS ?? ""}`,
        `JUDGE_ADDRESS=${addrs.JUDGE_ADDRESS ?? ""}`,
        "# evidence store (a Hallmark gateway) the pool reads inputs and salts from",
        "GATEWAY_URL=",
        "# stake to register with, tinybar (>= the contract's minStake)",
        "STAKE_TINYBAR=450000000",
        "STATE_DIR=./data",
        "MODELS_DIR=./models",
        "# one URL per model container (names come from models/*.json worker.urlEnv)",
        ...models.map((m) => `${m.worker.urlEnv}=http://localhost:${m.worker.port}`),
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  }
  const compose = [
    "# Model containers for this operator: build each from its pinned source and check the image digest",
    "# against the manifest's runtime.runtimeDigest before you register. Every honest operator in a pool",
    "# runs the same digest on the same hardware class (manifest runtime.hwClassLabel).",
    "services:",
    ...models.flatMap((m) => [
      `  ${m.task}-worker:`,
      `    # ${m.title}: ${m.runtime.image}`,
      `    build: ${resolve(asset("workers", m.task))}`,
      `    ports: ["${m.worker.port}:${m.worker.port}"]`,
      "    restart: unless-stopped",
    ]),
    "",
  ].join("\n");
  writeFileSync(join(dir, "docker-compose.yml"), compose);
  console.log(`wrote ${envFile} (fill OPERATOR_PRIVATE_KEY and GATEWAY_URL), ${join(dir, "docker-compose.yml")}, ${models.length} manifest(s) in ${join(dir, "models")}`);
  console.log("next: docker compose up -d --build   then   hallmark-operator run");
}

async function status() {
  loadFile();
  const env = loadEnv(OperatorEnv);
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  const me = new Wallet(env.OPERATOR_PRIVATE_KEY).address;
  const core = new Contract(env.HALLMARK_ADDRESS, abis.Hallmark, provider);
  const [o, credits, n, p, bal] = await Promise.all([core.operators(me), core.credits(me), core.operatorCount(), core.getParams(), provider.getBalance(me)]);
  const tb = (x: bigint) => `${formatUnits(x, 8)} HBAR`;
  console.log(`operator ${me}`);
  console.log(`  registered ${o.registered}  free ${tb(o.free)}  locked ${tb(o.locked)}  credits ${tb(credits)}  wallet ${formatUnits(bal, 18)} HBAR`);
  console.log(`  pool: ${n} operators, audit ${Number(p.auditBps) / 100}%, committee ${p.committeeSize}, minStake ${tb(p.minStake)}`);
  const models = selectManifests(env.MODELS_DIR, env.MODELS);
  for (const [task, r] of Object.entries(workerUrls(models))) {
    const h = await fetch(`${r.url.replace(/\/$/, "")}/health`).then((x) => (x.ok ? "ok" : `HTTP ${x.status}`)).catch((e) => `unreachable (${String(e).slice(0, 60)})`);
    console.log(`  worker ${task}: ${r.url} -> ${h}`);
  }
}

if (cmd === "init") init(resolve(rest[0] ?? "."));
else if (cmd === "run") {
  loadFile();
  await runOperator();
} else if (cmd === "status") await status();
else {
  console.error("usage: hallmark-operator <init [dir] | run [--env .env] | status [--env .env]>");
  process.exit(2);
}
