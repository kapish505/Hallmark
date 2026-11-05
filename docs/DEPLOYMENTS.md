# Deployments

## Hedera testnet (chain 296), 2026-11-06

Deployed with `forge script script/Deploy.s.sol --legacy --slow` (solc 0.8.24, paris, via-IR, optimizer runs 50), from
deployer `0x8Fcf46291F12Ab11D5616A845f939d8c3dB0EdD5` (account 0.0.11288543, ECDSA).

| Contract | Address | Deploy tx | Gas used |
|---|---|---|---|
| HallmarkJudge | `0x883b674a9050bf8e1531116A3AA524b08983bd46` | [0x602a80c0…](https://hashscan.io/testnet/transaction/0x602a80c052a20f5e6b2e6a2bb380f3ed424e2115e3f1dd268b823ce847903cea) | 555,354 |
| ModelRegistry | `0x252A9478e703524aFe022C407e6C61ee27633282` | [0xbecabd19…](https://hashscan.io/testnet/transaction/0xbecabd197d71139354ff16f5eb77d7856dafdbb0ee6a42f258a78cf695331940) | 1,000,134 |
| Hallmark | `0xb719b79bdEfcaE9fD981ebc9b545419645FAd1c4` | [0x8a763d1a…](https://hashscan.io/testnet/transaction/0x8a763d1a98d963a2776b6abb39a40a15b465e73acddd8b6ce643d23976323764) | 5,289,549 |
| `registry.setHallmark` | | [0xce060ec3…](https://hashscan.io/testnet/transaction/0xce060ec361a2d837dddb7aecffab0eb266b46b523c64f1e48770afd274047b1a) | 47,099 |

Checked on chain after deploying: deployed code sizes 2,324 / 4,256 / 23,530 B (the 23.5 KB Hallmark was accepted through
Hashio); `registry.hallmark`, `hallmark.registry`, `hallmark.judge` all linked; `judge.check("hello world", 1) = 2`.

- **Measured:** total cost of the four transactions 8.68 HBAR (deployer balance 17.457 → 8.773 HBAR).
- **Gateway = the deployer for now.** Change it to the real gateway account with `Hallmark.setGateway(address)` (owner only).
- **Params:** constructor defaults ([DEMO]/[ASSUMED]: auditBps 3000, minBond 0.1 HBAR, ...).
- **Models: none registered.** `setModel` waits for measured G3 values; the gateway offers no task until then.
- Not yet verified on Sourcify.
