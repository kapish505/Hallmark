// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {BondMath} from "../src/libs/BondMath.sol";
import {Vectors, NormCase, OverlapCase, BondCase} from "./generated/Vectors.sol";

/// TypeScript (packages/shared) and Solidity must agree on every generated vector.
contract ParityTest is Test {
    HallmarkJudge j = new HallmarkJudge();

    function test_normParity() public view {
        NormCase[] memory v = Vectors.normCases();
        for (uint256 i; i < v.length; ++i) {
            try j.check(v[i].text, v[i].spec) returns (uint256 w) {
                assertTrue(v[i].ok, string.concat("solidity accepted, ts rejected #", vm.toString(i)));
                assertEq(w, v[i].words);
            } catch {
                assertFalse(v[i].ok, string.concat("solidity rejected, ts accepted #", vm.toString(i)));
            }
        }
    }

    function test_overlapParity() public view {
        OverlapCase[] memory v = Vectors.overlapCases();
        for (uint256 i; i < v.length; ++i) {
            assertEq(j.overlap(v[i].a, v[i].b), v[i].bps);
        }
    }

    function test_bondParity() public pure {
        BondCase[] memory v = Vectors.bondCases();
        for (uint256 i; i < v.length; ++i) {
            BondCase memory c = v[i];
            assertEq(BondMath.bond(c.c, c.fee, c.auditBps, c.piBps, c.minBond), c.bond);
            assertEq(BondMath.ceiling(c.margin, c.auditBps, c.fpBps), c.ceiling);
            assertEq(BondMath.auditFee(c.auditBps, c.arb), c.auditFee);
        }
    }
}
