# @kapish505/hallmark-operator

Run a bonded [Hallmark](https://github.com/kapish505/Hallmark) operator: stake HBAR, run the pinned model
containers, and serve executor, verifier and committee seats. **0.x alpha. Hedera testnet only.**

```bash
npm install -g @kapish505/hallmark-operator
hallmark-operator init ./node     # .env, docker-compose.yml for the model containers, model manifests
cd node && docker compose up -d --build
hallmark-operator run             # registers with STAKE_TINYBAR, then serves every seat it is drawn for
hallmark-operator status          # stake, credits, pool, worker health
```

Fill `OPERATOR_PRIVATE_KEY` and `GATEWAY_URL` (the pool's evidence store) in `.env`. Run the same image
digest and hardware class as the rest of the pool: an honest run on different hardware can disagree and be
penalized. Earn fees and audit rewards; lose part of the bond for a no-show and all of it for a wrong answer.

Guide: https://github.com/kapish505/Hallmark/blob/main/docs/RUN_AN_OPERATOR.md · MIT
