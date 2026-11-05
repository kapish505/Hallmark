// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Hallmark, IHallmarkJudge} from "../src/Hallmark.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";

/// local-EVM deployment gas (Hedera numbers come from G2); used to set Remix gas limits
contract DeployGasTest is Test {
    function test_deployGas() public {
        uint256 g = gasleft();
        ModelRegistry reg = new ModelRegistry(address(this));
        emit log_named_uint("ModelRegistry deploy gas", g - gasleft());
        g = gasleft();
        HallmarkJudge judge = new HallmarkJudge();
        emit log_named_uint("HallmarkJudge deploy gas", g - gasleft());
        g = gasleft();
        new Hallmark(address(this), reg, IHallmarkJudge(address(judge)), address(1));
        emit log_named_uint("Hallmark deploy gas", g - gasleft());
    }
}
