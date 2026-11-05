/**
 * Create the service accounts for the demo pool (testnet only) and write their env files.
 *
 *   tsx scripts/setup-accounts.ts [--operators 5] [--fund] [--gateway-hbar 5] [--operator-hbar 4] [--challenger-hbar 3]
 *     [--internal]   write in-cluster URLs (http://gateway:8787, http://asr-worker:9000) for docker-compose.prod.yml
 *
 * - Generates an ECDSA key per service ONLY if its env file does not exist yet (never overwrites a key).
 * - Keys go only into git-ignored env/*.env files; this script never prints a key.
 * - --fund sends HBAR from the funder (PRIVATE_KEY in .env) to each new EVM address. On Hedera that
 *   auto-creates the account; its account id is then looked up on the Mirror Node.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { JsonRpcProvider, Wallet, parseEther } from "ethers";
import { DEFAULTS, fetchJson, sleep } from "../packages/shared/src/index.js";

const { values } = parseArgs({
  options: {
    operators: { type: "string", default: "5" },
    fund: { type: "boolean", default: false },
    internal: { type: "boolean", default: false },
    "gateway-hbar": { type: "string", default: "5" },
    "operator-hbar": { type: "string", default: "4" },
    "challenger-hbar": { type: "string", default: "3" },
    "public-gateway-url": { type: "string", default: "http://localhost:8787" },
  },
});
const ROOT = join(import.meta.dirname, "..");
const env = (n: string) => join(ROOT, "env", `${n}.env`);
const internal = values.internal;
const gwInternal = internal ? "http://gateway:8787" : "http://localhost:8787";
const asr = internal ? "http://asr-worker:9000" : "http://localhost:9000";
const ocr = internal ? "http://ocr-worker:9001" : "http://localhost:9001";

function readKey(file: string, name: string): string | null {
  if (!existsSync(file)) return null;
  const m = new RegExp(`^${name}=(0x[0-9a-fA-F]{64})$`, "m").exec(readFileSync(file, "utf8"));
  return m ? m[1] : null;
}

interface Svc {
  name: string;
  keyVar: string;
  hbar: string;
  body: (key: string) => string;
}
const n = Number(values.operators);
const operatorsList = Array.from({ length: n }, (_, i) => i + 1);
const services: Svc[] = [
  {
    name: "gateway",
    keyVar: "GATEWAY_PRIVATE_KEY",
    hbar: values["gateway-hbar"]!,
    body: (k) => `PORT=8787
PUBLIC_URL=${values["public-gateway-url"]}
GATEWAY_PRIVATE_KEY=${k}
GATEWAY_ACCOUNT_ID=
VERIFY_SETTLEMENT=true
PRICE_REFRESH_MS=60000
DB_PATH=./data/gateway.sqlite
BLOB_DIR=./data/blobs
EVIDENCE_WATCHERS=
DEMO_MODE=false
DEMO_CONTROL_TOKEN=
OPERATOR_CONTROL_URLS=
`,
  },
  ...operatorsList.map((i) => ({
    name: `operator-${i}`,
    keyVar: "OPERATOR_PRIVATE_KEY",
    hbar: values["operator-hbar"]!,
    body: (k: string) => `OPERATOR_PRIVATE_KEY=${k}
GATEWAY_URL=${gwInternal}
ASR_WORKER_URL=${asr}
OCR_WORKER_URL=${ocr}
STAKE_TINYBAR=200000000
STATE_DIR=./data/operator-${i}
BEHAVIOR=honest
CONTROL_PORT=${9100 + i}
DEMO_CONTROL_TOKEN=
`,
  })),
  {
    name: "challenger",
    keyVar: "CHALLENGER_PRIVATE_KEY",
    hbar: values["challenger-hbar"]!,
    body: (k) => `CHALLENGER_PRIVATE_KEY=${k}
GATEWAY_URL=${gwInternal}
ASR_WORKER_URL=${asr}
OCR_WORKER_URL=${ocr}
STATE_DIR=./data/challenger
CHALLENGE_BUDGET_TINYBAR=1000000000
CHALLENGE_MARGIN_BPS=300
`,
  },
];

const addrs: Record<string, string> = {};
for (const s of services) {
  let key = readKey(env(s.name), s.keyVar);
  if (!key) {
    key = Wallet.createRandom().privateKey;
    writeFileSync(env(s.name), s.body(key), { mode: 0o600 });
    console.log(`created env/${s.name}.env (new key)`);
  } else console.log(`kept env/${s.name}.env (existing key)`);
  addrs[s.name] = new Wallet(key).address;
}

// gateway: the challenger may read private evidence; demo control URLs for the operators
const operatorAddrs = operatorsList.map((i) => addrs[`operator-${i}`]);
let gw = readFileSync(env("gateway"), "utf8");
gw = gw.replace(/^EVIDENCE_WATCHERS=.*$/m, `EVIDENCE_WATCHERS=${addrs.challenger}`);
gw = gw.replace(/^OPERATOR_CONTROL_URLS=.*$/m, `OPERATOR_CONTROL_URLS=${operatorsList.map((i) => `${addrs[`operator-${i}`]}=http://${internal ? `operator-${i}` : "localhost"}:${9100 + i}`).join(",")}`);
writeFileSync(env("gateway"), gw, { mode: 0o600 });

const rpc = process.env.RPC_URL ?? DEFAULTS.rpcUrl;
const provider = new JsonRpcProvider(rpc, 296, { staticNetwork: true });
if (values.fund) {
  const funderKey = readKey(join(ROOT, ".env"), "PRIVATE_KEY");
  if (!funderKey) throw new Error("--fund needs PRIVATE_KEY in .env");
  const funder = new Wallet(funderKey, provider);
  const total = services.reduce((t, s) => t + parseEther(s.hbar), 0n);
  const bal = await provider.getBalance(funder.address);
  console.log(`funder ${funder.address}: ${Number(bal) / 1e18} HBAR, sending ${Number(total) / 1e18} HBAR in total`);
  if (bal < total) throw new Error("funder balance too low; top it up from the faucet (portal.hedera.com) or lower the amounts");
  for (const s of services) {
    const cur = await provider.getBalance(addrs[s.name]);
    if (cur >= parseEther(s.hbar)) {
      console.log(`${s.name} already has ${Number(cur) / 1e18} HBAR`);
      continue;
    }
    // 1 HBAR on the wire = 1e18 weibar (G2)
    const tx = await funder.sendTransaction({ to: addrs[s.name], value: parseEther(s.hbar), gasLimit: 1_000_000 });
    await tx.wait();
    console.log(`funded ${s.name} with ${s.hbar} HBAR (${tx.hash})`);
  }
}

// account ids (exist only after the first transfer to the address)
const mirror = process.env.MIRROR_NODE_URL ?? DEFAULTS.mirrorNodeUrl;
for (const s of services) {
  let id: string | null = null;
  for (let i = 0; i < 10 && !id; i++) {
    try {
      id = (await fetchJson<{ account: string }>(`${mirror}/accounts/${addrs[s.name]}`)).account;
    } catch {
      if (!values.fund) break;
      await sleep(2000);
    }
  }
  console.log(`${s.name.padEnd(12)} ${addrs[s.name]}  ${id ?? "(no account yet: fund this address)"}`);
  if (s.name === "gateway" && id) {
    const g = readFileSync(env("gateway"), "utf8").replace(/^GATEWAY_ACCOUNT_ID=.*$/m, `GATEWAY_ACCOUNT_ID=${id}`);
    writeFileSync(env("gateway"), g, { mode: 0o600 });
  }
}
console.log(`\nnext: Hallmark.setGateway(${addrs.gateway}) from the owner, then start the stack.`);
