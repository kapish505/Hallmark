// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Hallmark, IHallmarkJudge} from "../src/Hallmark.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";

/// @notice Deploy Judge, Registry, Hallmark, link them, optionally register models from env and
///         print both bond limits per model. Refuses to enable a model whose window is empty.
///   env: PRIVATE_KEY (owner), GATEWAY_ADDRESS
///   optional per model X in {ASR, OCR}: X_ENABLE=true, X_CLASS (0 exact|1 tolerance), X_TAU_BPS,
///     X_FEE, X_C, X_MARGIN, X_PI_BPS, X_FP_BPS, X_MAX_WORDS, X_DIGEST, X_HW
///   Values must come from docs/MEASUREMENTS.md (G3); nothing is enabled by default.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        address gw = vm.envAddress("GATEWAY_ADDRESS");
        vm.startBroadcast(pk);
        HallmarkJudge judge = new HallmarkJudge();
        ModelRegistry reg = new ModelRegistry(owner);
        Hallmark h = new Hallmark(owner, reg, IHallmarkJudge(address(judge)), gw);
        reg.setHallmark(address(h));
        _model(reg, h, "ASR", 1);
        _model(reg, h, "OCR", 2);
        vm.stopBroadcast();
        console2.log("HallmarkJudge ", address(judge));
        console2.log("ModelRegistry ", address(reg));
        console2.log("Hallmark      ", address(h));
    }

    function _model(ModelRegistry reg, Hallmark h, string memory k, uint8 spec) internal {
        if (!vm.envOr(string.concat(k, "_ENABLE"), false)) {
            console2.log(k, "not enabled (set", string.concat(k, "_ENABLE=true"), "with measured values)");
            return;
        }
        ModelRegistry.Model memory m;
        m.class = uint8(vm.envUint(string.concat(k, "_CLASS")));
        m.tauBps = uint16(vm.envOr(string.concat(k, "_TAU_BPS"), uint256(0)));
        m.normSpec = spec;
        m.minWords = 1;
        m.maxWords = uint16(vm.envOr(string.concat(k, "_MAX_WORDS"), uint256(96)));
        m.enabled = true;
        m.piBps = uint16(vm.envUint(string.concat(k, "_PI_BPS")));
        m.fpBps = uint16(vm.envUint(string.concat(k, "_FP_BPS")));
        m.fee = uint128(vm.envUint(string.concat(k, "_FEE")));
        m.cTinybar = uint128(vm.envUint(string.concat(k, "_C")));
        m.marginTinybar = uint128(vm.envUint(string.concat(k, "_MARGIN")));
        m.runtimeDigest = vm.envOr(string.concat(k, "_DIGEST"), bytes32(0));
        m.hwClass = vm.envOr(string.concat(k, "_HW"), bytes32(0));
        Hallmark.Params memory p = h.getParams();
        (uint256 b, uint256 ceil) = reg.window(m, p.auditBps, p.minBond);
        console2.log(k, "deterrence bond (tinybar):", b);
        if (ceil == type(uint256).max) console2.log(k, "fairness ceiling: none (fp = 0)");
        else console2.log(k, "fairness ceiling (tinybar):", ceil);
        require(b <= ceil, string.concat(k, ": bond window is EMPTY at this audit rate; not enabling"));
        reg.setModel(keccak256(bytes(vm.envOr(string.concat(k, "_MODEL_KEY"), string.concat(k, "_V1")))), m);
    }
}
