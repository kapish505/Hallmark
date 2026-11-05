# Deploying the full Hallmark demo (Hedera testnet)

Everything in the demo is real: the Hedera testnet contracts (already deployed and verified, see `docs/DEPLOYMENTS.md`),
x402 payments signed by the visitor's own wallet, and the pinned Whisper / Tesseract workers. There is no sponsored buyer.
Fakes exist only in the local automated tests (`scripts/local`), never in the deployed stack.

**Disclosure:** the demo pool (5 operators + a challenger) is run by the team on one server, sharing the worker containers.
That is a demo pool, not a decentralized network. The protocol does not depend on it: anyone could register an operator.

## 0. What you need

| Item | Why | Where |
|---|---|---|
| One **x86_64 Linux server**, at least 8 vCPU / 16 GB RAM / 80 GB disk, Docker installed | Whisper large-v3 on CPU; all services in one compose project | any cloud (Hetzner, DigitalOcean, AWS, GCP...) |
| Two DNS names pointing at it (A records) | web app + gateway over HTTPS (WalletConnect needs HTTPS) | your DNS provider |
| A WalletConnect / Reown **project id** | lets visitors connect HashPack / Kabila / Blade | free at https://cloud.reown.com (add both domains to its allowlist) |
| About **30 testnet HBAR** on the deployer (`PRIVATE_KEY` in `.env`) | funds gateway (5), 5 operators (4 each), challenger (3) | faucet at https://portal.hedera.com |

## 1. Prepare on your laptop (once)

```bash
cd /Users/kapish/Work/HallMark
```

1. Top up the deployer from the faucet, then create and fund the service accounts (writes `env/gateway.env`,
   `env/operator-1..5.env`, `env/challenger.env` with in-cluster URLs; keys are never printed):
   ```bash
   npx tsx scripts/setup-accounts.ts --internal --fund --public-gateway-url https://api.YOUR-DOMAIN
   ```
2. Point the contract at the new gateway account (owner only). The script prints the address:
   ```bash
   set -a && . ./.env && set +a && cast send 0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4 'setGateway(address)' <GATEWAY_EVM_ADDRESS> --rpc-url https://testnet.hashio.io/api --private-key "$PRIVATE_KEY" --legacy --gas-limit 100000
   ```
3. Demo controls (optional, for the attack lab): put the same random value in `DEMO_CONTROL_TOKEN` in `env/gateway.env`
   and in every `env/operator-N.env`, and set `DEMO_MODE=true` in the gateway env.
4. Register the models (section 3) once G3 has run on the server.

## 2. Server

```bash
git clone <your repo> hallmark && cd hallmark
```

Copy these git-ignored files from your laptop to the same paths on the server (for example with `scp`): `env/common.env`,
`env/gateway.env`, `env/operator-1.env` ... `env/operator-5.env`, `env/challenger.env`. Then:

```bash
cp deploy/.env.example deploy/.env    # set DOMAIN, API_DOMAIN, WALLETCONNECT_PROJECT_ID
```

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Check: `https://API_DOMAIN/.well-known/hallmark.json` returns the manifest; `https://DOMAIN` shows the app;
`docker compose -f docker-compose.prod.yml logs -f operator-1` shows "registered operator".

## 3. G3 on the server, then register the models

Run the real calibration against the server's own worker containers (same hardware class as the operators). Use
human-recorded clips and real photos/scans for the final numbers; `data/g3/` holds synthetic sets for a first pass.

```bash
docker compose -f docker-compose.prod.yml exec gateway npx tsx scripts/calibrate.ts --task asr --data data/g3/asr --workers http://asr-worker:9000 --runs 20 --honest-cost-tinybar <estimate> --digest <asr image id>
```

Repeat for `--task ocr` with `--workers http://ocr-worker:9001`. Then call `setModel` on ModelRegistry
(`0x252A9478e703524aFe022C407e6C61ee27633282`) for `ASR_V1` / `OCR_V1` with the measured class, tau, the worst cheat's `c`
and `pi`, `fp`, and the accuracy fields (see `contracts/DEPLOY_REMIX.md` step 7). `setModel` reverts with `WindowEmpty` if
no bond is both deterring and fair: then that task is not offered, and the README must say so.

The gateway picks up new prices and models within `PRICE_REFRESH_MS` (60 s).

## 4. Test it for real

- Open `https://DOMAIN`, connect a testnet wallet (HashPack / Kabila / Blade), upload a 16 kHz mono WAV or a PNG, approve the
  transfer. Keep the job link (it carries your access token). Check the x402 settlement and every job transaction on HashScan.
- Agent path (no human approval): `pnpm agent clip.wav --gateway https://API_DOMAIN --max-price 0.5 --budget 5` with your own
  `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY`.
- Full scenario suite: `tsx scripts/e2e-testnet.ts all --clip clip.wav --image page.png`, then `pnpm measure`.
- Put the first settled x402 transaction id + HashScan link in the README (required by the Hedera track).

## 5. Costs to expect (measured on testnet, G2)

126 tinybar per gas unit; an unaudited job is about 5 transactions (createJob, commit, drawAudit, reveal, settle), an audited
one 7 or more; a dispute adds the committee. Measure the real per-job cost with `pnpm measure` after the first jobs.
