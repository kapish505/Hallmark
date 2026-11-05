// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Hallmark} from "../src/Hallmark.sol";

contract Reenterer {
    Hallmark h;
    uint256 public reentered;

    constructor(Hallmark h_) payable {
        h = h_;
    }

    function register() external {
        h.registerOperator{value: address(this).balance}();
    }

    function pull(uint256 amt) external {
        h.withdrawStake(amt);
    }

    receive() external payable {
        if (reentered++ == 0) {
            try h.withdrawStake(1) {} catch {}
            try h.withdraw() {} catch {}
        }
    }
}

contract ReentrancyTest is Base {
    function test_withdrawStakeCannotReenter() public {
        Reenterer r = new Reenterer{value: STAKE}(h);
        r.register();
        r.pull(STAKE / 2);
        // the nested withdrawStake(1) failed (lock held), so exactly STAKE/2 left
        assertEq(free(address(r)), STAKE / 2);
        assertEq(address(r).balance, STAKE / 2);
        assertConserved();
    }
}
