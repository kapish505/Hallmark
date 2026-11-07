# @kapish505/hallmark-contracts

ABIs, Hedera testnet addresses and Solidity sources of the [Hallmark](https://github.com/kapish505/Hallmark)
core contracts. **0.x alpha. Hedera testnet only. Verified on Sourcify; not audited.**

```js
import { abis, hederaTestnet, VERDICTS } from "@kapish505/hallmark-contracts";
// hederaTestnet.HALLMARK_ADDRESS, .VERDICT_ADDRESS, .REGISTRY_ADDRESS, .JUDGE_ADDRESS (chain 296)
```

Read a verdict from your own contract:

```solidity
import {IHallmarkVerdict} from "@kapish505/hallmark-contracts/src/IHallmarkVerdict.sol";

IHallmarkVerdict v = IHallmarkVerdict(VERDICT_ADDRESS);
if (v.finalizedAt(jobId) != 0 && v.status(jobId) == IHallmarkVerdict.Verdict.FinalAudited) {
    // a second bonded operator re-ran it and agreed
}
```

Contents: `abi/` (Hallmark, HallmarkVerdict, ModelRegistry, HallmarkJudge), `deployments/hedera-testnet.json`,
`src/` (Solidity 0.8.24 sources), `examples/ExampleConsumer.sol` (pays only on `FinalAudited`; example only),
`script/Deploy.s.sol`. MIT
