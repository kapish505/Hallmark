#!/usr/bin/env bash
# Fresh-install smoke test of the core (section 6.6):
#   1. pack the core packages into tarballs (scripts/pack-core.ts)
#   2. install ONLY those tarballs in an empty temp directory outside the repo
#   3. run the README example on Hedera testnet with a funded test key
#   4. assert a final verdict and print explorer links
# Needs: SMOKE_PRIVATE_KEY (or env/smoke.env), a running evidence store (EVIDENCE_URL, default: the
# gateway's PUBLIC_URL from env/gateway.env, else http://127.0.0.1:8787), and operators on the pool.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -z "${SMOKE_PRIVATE_KEY:-}" ] && [ -f "$ROOT/env/smoke.env" ] && SMOKE_PRIVATE_KEY="$(sed -n 's/^SMOKE_PRIVATE_KEY=//p' "$ROOT/env/smoke.env")"
[ -z "${SMOKE_PRIVATE_KEY:-}" ] && { echo "set SMOKE_PRIVATE_KEY (a funded testnet key) or create env/smoke.env"; exit 2; }
if [ -z "${EVIDENCE_URL:-}" ]; then
  EVIDENCE_URL="$(sed -n 's/^PUBLIC_URL=//p' "$ROOT/env/gateway.env" 2>/dev/null || true)"
  curl -fsS -m 10 -H "ngrok-skip-browser-warning: 1" "$EVIDENCE_URL/health" >/dev/null 2>&1 || EVIDENCE_URL="http://127.0.0.1:8787"
fi
echo "evidence store: $EVIDENCE_URL"

(cd "$ROOT" && npx tsx scripts/pack-core.ts)
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hallmark-smoke.XXXXXX")"
echo "fresh install in $WORK"
cp "$ROOT/scripts/smoke/example.mjs" "$ROOT/scripts/smoke/input.png" "$WORK/"
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund "$ROOT"/dist-pack/hallmark-*.tgz >/dev/null
echo "installed: $(ls node_modules/@hallmark | tr '\n' ' ')"
[ -d node_modules/@hallmark/shared ] && { echo "FAIL: a workspace-only package leaked into the install"; exit 1; }

OUT="$(KEY="$SMOKE_PRIVATE_KEY" EVIDENCE_URL="$EVIDENCE_URL" INPUT=input.png node example.mjs | tee /dev/stderr)"
LINE="$(printf '%s\n' "$OUT" | sed -n 's/^SMOKE //p')"
[ -n "$LINE" ] || { echo "FAIL: no result line"; exit 1; }
node -e '
const r = JSON.parse(process.argv[1]);
if (!r.final) { console.error("FAIL: verdict not final"); process.exit(1); }
const hs = "https://hashscan.io/testnet";
console.log(`PASS final verdict ${r.verdict}`);
console.log(`  createJob   ${hs}/transaction/${r.createTx}`);
console.log(`  contract    ${hs}/contract/${r.hallmark}/events`);
console.log(`  job id      ${r.jobId}`);
' "$LINE"
