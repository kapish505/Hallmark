# Run an operator

An operator stakes HBAR, runs the pinned model containers, and serves whatever seat the contract draws it
for: executor, verifier (a blind re-run) or committee member. It earns the executor fee and audit rewards;
it loses part of its bond for not showing up and all of it for a wrong output. Testnet only.

## Requirements

- Node 22, Docker
- an ECDSA testnet key with at least the stake plus a few HBAR for gas (Hedera reserves
  `gasLimit x gasPrice` up front for every transaction)
- the same hardware class as the rest of the pool (each manifest's `runtime.hwClassLabel`): an honest
  run on different hardware can disagree and be penalized

## Install

```bash
npm install -g @kapish505/hallmark-operator
npx hallmark-operator init ./my-operator
cd my-operator
```

`init` writes:

- `.env`: key, RPC, the testnet contract addresses, the evidence store URL, stake, one worker URL per model
- `docker-compose.yml`: one service per model container, built from the shipped worker sources
- `models/`: the manifests of the models the pool runs

Fill `OPERATOR_PRIVATE_KEY` and `GATEWAY_URL` (the evidence store the pool uses) in `.env`. Keep the file
private.

## Start the model containers

```bash
docker compose up -d --build
```

Check that each built image's digest matches `runtime.runtimeDigest` in its manifest. A different digest
can produce different output and get you penalized as wrong.

## Run

```bash
npx hallmark-operator run
```

On first start it registers with `STAKE_TINYBAR` (at least the contract's `minStake`). It then follows the
contract's events and for each seat it is drawn for:

1. fetches the job salt and input from the evidence store and checks both against on-chain hashes;
2. runs the pinned model and normalizes the output;
3. saves `{output, salt}` to `STATE_DIR` **before** sending the commit, so a crash never loses a commitment;
4. commits, then reveals when the contract asks, then uploads the text to the evidence store.

If the salt or input cannot be fetched or verified while it is the executor, it calls
`reportInputMissing` once, and the contract draws another executor. If that executor commits, your claim
counts as a no-show and costs part of your bond, so only report what is really missing.

Restarts are safe: every step is decided from chain state.

## Status

```bash
npx hallmark-operator status
```

prints whether you are registered, free and locked stake, credits waiting to be withdrawn, pool size and
audit rate, and whether each model's worker answers its health check.

## Money

| Event | Effect |
|---|---|
| executor job settles | fee credited |
| verifier or committee seat on the winning side | reward from the audit pool |
| no commit, no reveal, no text | `noRevealSlashBps` of the bond to the slash pool |
| output found wrong | the whole bond slashed; part goes to whoever found it |
| input reported missing twice (voided) | each executor gets half the void fee |

Credits accumulate in the contract; withdraw them with `Hallmark.withdraw()`, and free stake with
`withdrawStake(amount)`. Stake locked as a bond for an open job cannot be withdrawn.

## Running the whole pool on one machine

The repository's `docker-compose.prod.yml` runs the gateway, five operators and the challenger together
(see the README). That is how the testnet demo runs; a real pool would be operators on separate machines.
