// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Hallmark, IHallmarkJudge} from "../src/Hallmark.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {HallmarkVerdict} from "../src/HallmarkVerdict.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";

/// @notice Deploy Judge, Registry, Hallmark and the HallmarkVerdict view, and link them.
///   env: PRIVATE_KEY (owner), GATEWAY_ADDRESS (the x402 gateway: the one caller that may name another buyer)
///   Models are NOT registered here. Each model is a manifest (models/*.json): propose it with
///   `hallmark-models propose <manifest>` and enable it from the owner with `hallmark-models enable`,
///   which refuses a manifest whose bond window is empty (the registry checks again on chain).
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
        HallmarkVerdict verdict = new HallmarkVerdict(h);
        vm.stopBroadcast();
        console2.log("HallmarkJudge  ", address(judge));
        console2.log("ModelRegistry  ", address(reg));
        console2.log("Hallmark       ", address(h));
        console2.log("HallmarkVerdict", address(verdict));
    }
}
