// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {TextNorm} from "../src/libs/TextNorm.sol";
import {Overlap} from "../src/libs/Overlap.sol";

contract TextNormTest is Test {
    HallmarkJudge j = new HallmarkJudge();

    function test_validAsrAndOcr() public view {
        assertEq(j.check("hello world it's 2", 1), 4);
        assertEq(j.check("hello world 2", 2), 3);
        assertEq(j.check("", 1), 0);
    }

    function test_rejects() public {
        vm.expectRevert(abi.encodeWithSelector(TextNorm.BadChar.selector, 2));
        j.check("it's", 2); // apostrophe not allowed in OCR
        vm.expectRevert(TextNorm.BadSpacing.selector);
        j.check(" a", 1);
        vm.expectRevert(TextNorm.BadSpacing.selector);
        j.check("a  b", 1);
        vm.expectRevert(TextNorm.BadSpacing.selector);
        j.check("a ", 1);
        vm.expectRevert(abi.encodeWithSelector(TextNorm.BadChar.selector, 0));
        j.check("Hello", 1);
        vm.expectRevert(abi.encodeWithSelector(TextNorm.BadChar.selector, 1));
        j.check(hex"61c3a9", 1); // non-ASCII
        vm.expectRevert(TextNorm.BadSpec.selector);
        j.check("a", 3);
    }

    function test_tooManyWords() public {
        bytes memory s = _words(97);
        vm.expectRevert(TextNorm.TooManyWords.selector);
        j.check(s, 1);
    }

    function test_overlap() public view {
        assertEq(j.overlap("a b c", "a b c"), 10_000);
        assertEq(j.overlap("a b c", "x y z"), 0);
        assertEq(j.overlap("a a b", "a b b"), 6666); // multiset: common = 2 of 6
        assertEq(j.overlap("", "a"), 0);
    }

    function testFuzz_overlapSymmetric(uint8 na, uint8 nb, uint256 seed) public view {
        bytes memory a = _rand(bound(na, 0, 20), seed);
        bytes memory b = _rand(bound(nb, 0, 20), seed >> 64);
        assertEq(j.overlap(a, b), j.overlap(b, a));
        assertLe(j.overlap(a, b), 10_000);
    }

    /// the hash-table implementation equals the nested-loop reference (section 10)
    function testFuzz_overlapMatchesNestedLoop(uint8 na, uint8 nb, uint256 seed) public pure {
        bytes32[] memory a = new bytes32[](bound(na, 0, 96));
        bytes32[] memory b = new bytes32[](bound(nb, 0, 96));
        for (uint256 i; i < a.length; ++i) a[i] = bytes32(uint256(keccak256(abi.encode(seed, i))) % 7 + 1);
        for (uint256 i; i < b.length; ++i) b[i] = bytes32(uint256(keccak256(abi.encode(seed >> 1, i))) % 7 + 1);
        assertEq(Overlap.bps(a, b), _nested(a, b));
    }

    function _nested(bytes32[] memory a, bytes32[] memory b) internal pure returns (uint256) {
        if (a.length == 0 || b.length == 0) return 0;
        bool[] memory used = new bool[](b.length);
        uint256 common;
        for (uint256 i; i < a.length; ++i) {
            for (uint256 k; k < b.length; ++k) {
                if (!used[k] && b[k] == a[i]) {
                    used[k] = true;
                    ++common;
                    break;
                }
            }
        }
        return (20_000 * common) / (a.length + b.length);
    }

    /// gas snapshot for the worst case: 96 x 96 distinct words
    function test_gas_overlap96x96() public {
        bytes memory a = _words(96);
        bytes memory b = _rand(96, 7);
        uint256 g = gasleft();
        j.overlap(a, b);
        g -= gasleft();
        emit log_named_uint("overlap 96x96 gas", g);
        assertLt(g, 5_000_000);
    }

    function _words(uint256 n) internal pure returns (bytes memory s) {
        for (uint256 i; i < n; ++i) {
            s = bytes.concat(s, i == 0 ? bytes("") : bytes(" "), bytes(vm.toString(i + 1000)));
        }
    }

    function _rand(uint256 n, uint256 seed) internal pure returns (bytes memory s) {
        for (uint256 i; i < n; ++i) {
            uint256 w = uint256(keccak256(abi.encode(seed, i))) % 6;
            s = bytes.concat(s, i == 0 ? bytes("") : bytes(" "), bytes(vm.toString(w)));
        }
    }
}
