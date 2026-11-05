// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Base} from "./Base.t.sol";
import {Hallmark} from "../src/Hallmark.sol";

/// Drives random jobs through every legal transition (and some illegal ones) with random outputs.
contract Handler is Test {
    Hallmark h;
    address gateway;
    address keeper = address(0xBEEF);
    bytes32 asr;
    bytes32 ocr;
    bytes32[] public ids;
    mapping(bytes32 => mapping(address => bytes)) txt;
    mapping(bytes32 => bool) public closed;
    mapping(bytes32 => Hallmark.Status) public finalStatus;
    uint256 public openEscrow;
    uint256 public closes;
    bytes[3] texts;

    constructor(Hallmark h_, address gateway_, bytes32 asr_, bytes32 ocr_) {
        h = h_;
        gateway = gateway_;
        asr = asr_;
        ocr = ocr_;
        texts[0] = "the quick brown fox jumps over the lazy dog";
        texts[1] = "the quick brown fox jumps over the lazy cat";
        texts[2] = "zzz qqq xxx";
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 seed) external {
        bytes32 model = seed % 2 == 0 ? asr : ocr;
        (uint256 p,,, bool ok) = h.quote(model);
        if (!ok) return;
        bytes32 id = keccak256(abi.encode(ids.length, seed));
        vm.deal(gateway, p);
        vm.prank(gateway);
        h.createJob{value: p}(id, address(uint160(0x1000 + ids.length)), keccak256("in"), model);
        ids.push(id);
        openEscrow += p;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 200));
    }

    function fund(uint256 amt) external {
        amt = bound(amt, 0, 1e8);
        vm.deal(address(this), amt);
        h.fundAuditPool{value: amt}();
    }

    function withdraw(uint256 seed) external {
        if (ids.length == 0) return;
        Hallmark.Job memory j = h.getJob(ids[seed % ids.length]);
        address who = seed % 3 == 0 ? j.executor : (seed % 3 == 1 ? j.verifier : j.buyer);
        if (who == address(0) || h.credits(who) == 0) return;
        vm.prank(who);
        try h.withdraw() {} catch {}
    }

    function _commit(bytes32 id, address who, uint256 seed) internal {
        bytes memory t = texts[seed % 3];
        txt[id][who] = t;
        bytes32 c = h.commitmentFor(id, who, keccak256(t), bytes32(uint256(uint160(who))));
        vm.prank(who);
        try h.commit(id, c) {} catch {}
    }

    function _reveal(bytes32 id, address who, bool asText) internal {
        bytes memory t = txt[id][who];
        bytes32 s = bytes32(uint256(uint160(who)));
        vm.prank(who);
        if (asText) {
            try h.revealText(id, t, s, "r") {} catch {}
        } else {
            try h.reveal(id, keccak256(t), s, "r") {} catch {}
        }
    }

    function act(uint256 seed, uint256 pick) external {
        if (ids.length == 0) return;
        bytes32 id = ids[pick % ids.length];
        Hallmark.Job memory j = h.getJob(id);
        Hallmark.Status st = j.status;
        if (seed % 9 == 0) {
            try h.expire(id) {} catch {}
        } else if (st == Hallmark.Status.Assigned) {
            _commit(id, j.executor, seed);
        } else if (st == Hallmark.Status.Committed) {
            vm.prevrandao(bytes32(seed));
            vm.prank(keeper, keeper);
            h.drawAudit(id);
        } else if (st == Hallmark.Status.VerifierCommit) {
            _commit(id, j.verifier, seed >> 8);
        } else if (st == Hallmark.Status.Reveal) {
            if (!h.seat(id, j.executor).revealed) _reveal(id, j.executor, false);
            else _reveal(id, j.verifier, false);
        } else if (st == Hallmark.Status.Challenge) {
            if (seed % 3 == 0) {
                address c = address(uint160(0xC000 + (seed % 5)));
                vm.deal(c, j.challengeBond);
                vm.prank(c);
                try h.challenge{value: j.challengeBond}(id) {} catch {}
            } else {
                try h.settle(id) {} catch {}
            }
        } else if (st == Hallmark.Status.Text) {
            address who = seed % 2 == 0 ? j.executor : j.verifier;
            vm.prank(who);
            try h.postText(id, txt[id][who]) {} catch {}
            try h.compareTexts(id, txt[id][j.executor], txt[id][j.verifier]) {} catch {}
        } else if (st == Hallmark.Status.CommitteeCommit) {
            address[] memory m = h.committeeOf(id);
            _commit(id, m[seed % m.length], seed >> 16);
        } else if (st == Hallmark.Status.CommitteeReveal) {
            address[] memory m = h.committeeOf(id);
            if (seed % 4 != 0) {
                _reveal(id, m[seed % m.length], j.cls == 1);
            } else {
                bytes[] memory all;
                if (j.cls == 1) {
                    all = new bytes[](2 + m.length);
                    all[0] = txt[id][j.executor];
                    all[1] = txt[id][j.verifier];
                    for (uint256 i; i < m.length; ++i) {
                        all[2 + i] = txt[id][m[i]];
                    }
                }
                try h.resolve(id, all) {} catch {}
            }
        }
        _track(id);
    }

    function _track(bytes32 id) internal {
        Hallmark.Job memory j = h.getJob(id);
        bool terminal = j.status == Hallmark.Status.Settled || j.status == Hallmark.Status.Refunded;
        if (terminal && !closed[id]) {
            closed[id] = true;
            finalStatus[id] = j.status;
            openEscrow -= uint256(j.fee) + j.protocolFee + j.auditFee;
            ++closes;
        }
    }

    receive() external payable {}
}

contract InvariantTest is StdInvariant, Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(h, gateway, ASR, OCR);
        targetContract(address(handler));
    }

    /// contract balance = free + locked + escrow + credits + pools + treasury + challenge bonds
    function invariant_conservation() public view {
        assertEq(address(h).balance, h.accounted());
    }

    function invariant_escrowMatchesOpenJobs() public view {
        assertEq(h.escrow(), handler.openEscrow());
    }

    function invariant_lockedMatchesOperators() public view {
        uint256 sum;
        for (uint256 i; i < ops.length; ++i) {
            sum += locked(ops[i]);
        }
        assertEq(sum, h.totalLocked());
    }

    /// each job resolves once: a terminal job never changes status again
    function invariant_terminalIsFinal() public view {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            bytes32 id = handler.ids(i);
            if (handler.closed(id)) assertEq(uint8(h.getJob(id).status), uint8(handler.finalStatus(id)));
        }
    }
}
