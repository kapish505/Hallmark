// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Hallmark, IHallmarkJudge} from "../src/Hallmark.sol";
import {HallmarkJudge} from "../src/HallmarkJudge.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";

abstract contract Base is Test {
    Hallmark h;
    HallmarkJudge judge;
    ModelRegistry reg;

    address owner = makeAddr("owner");
    address gateway = makeAddr("gateway");
    address buyer = makeAddr("buyer");
    address keeper = makeAddr("keeper");
    address challenger = makeAddr("challenger");
    address[] ops;

    bytes32 constant ASR = keccak256("asr/whisper-large-v3");
    bytes32 constant OCR = keccak256("ocr/engine");
    bytes32 constant INPUT = keccak256("input-bytes");
    uint256 constant STAKE = 10e8; // 10 HBAR in tinybar
    uint256 constant N_OPS = 6;

    bytes constant HONEST = "the quick brown fox jumps over the lazy dog";
    bytes constant GARBAGE = "zzz qqq xxx";
    // differs from HONEST by one word: overlap 8/9 = 8888 bps (>= tau 8000)
    bytes constant NEAR = "the quick brown fox jumps over the lazy cat";

    uint256 jobSeq;

    function setUp() public virtual {
        reg = new ModelRegistry(owner);
        judge = new HallmarkJudge();
        h = new Hallmark(owner, reg, IHallmarkJudge(address(judge)), gateway);
        vm.startPrank(owner);
        reg.setHallmark(address(h));
        reg.setModel(ASR, asrModel());
        reg.setModel(OCR, ocrModel());
        vm.stopPrank();
        for (uint256 i; i < N_OPS; ++i) {
            address op = makeAddr(string.concat("op", vm.toString(i)));
            ops.push(op);
            vm.deal(op, 100e8);
            vm.prank(op);
            h.registerOperator{value: STAKE}();
        }
        vm.deal(gateway, 1_000e8);
        vm.deal(challenger, 100e8);
        h.fundAuditPool{value: 0}();
    }

    function asrModel() internal pure returns (ModelRegistry.Model memory m) {
        m.class = 0; // EXACT
        m.normSpec = 1;
        m.minWords = 1;
        m.maxWords = 96;
        m.enabled = true;
        m.piBps = 5000;
        m.fpBps = 0;
        m.fee = 20_000_000;
        m.cTinybar = 15_000_000;
        m.marginTinybar = 5_000_000;
        m.runtimeDigest = keccak256("sha256:asr-image");
        m.hwClass = keccak256("cpu-x86_64-avx2");
    }

    function ocrModel() internal pure returns (ModelRegistry.Model memory m) {
        m.class = 1; // TOLERANCE
        m.tauBps = 8000;
        m.normSpec = 2;
        m.minWords = 1;
        m.maxWords = 96;
        m.enabled = true;
        m.piBps = 6000;
        m.fpBps = 50;
        m.fee = 10_000_000;
        m.cTinybar = 8_000_000;
        m.marginTinybar = 2_000_000;
    }

    // ------------------------------------------------------------ helpers
    function price(bytes32 model) internal view returns (uint256 p) {
        (p,,,) = h.quote(model);
    }

    function bondOf(bytes32 id) internal view returns (uint256) {
        return h.getJob(id).bond;
    }

    function jobSalt(bytes32 id) internal pure returns (bytes32) {
        return keccak256(abi.encode("jobSalt", id));
    }

    function saltCommit(bytes32 id) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(jobSalt(id)));
    }

    function outC(bytes32 id, bytes memory text) internal view returns (bytes32) {
        return h.outCommitFor(id, jobSalt(id), text);
    }

    function create(bytes32 model) internal returns (bytes32 id) {
        id = keccak256(abi.encode("job", ++jobSeq));
        uint256 p = price(model);
        vm.prank(gateway);
        h.createJob{value: p}(id, buyer, INPUT, saltCommit(id), model);
    }

    function job(bytes32 id) internal view returns (Hallmark.Job memory) {
        return h.getJob(id);
    }

    function status(bytes32 id) internal view returns (Hallmark.Status) {
        return h.getJob(id).status;
    }

    function salt(address who) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", who));
    }

    function commitText(bytes32 id, address who, bytes memory text) internal {
        bytes32 c = h.commitmentFor(id, who, outC(id, text), salt(who));
        vm.prank(who);
        h.commit(id, c);
    }

    function revealTextHash(bytes32 id, address who, bytes memory text) internal {
        bytes32 oc = outC(id, text);
        vm.prank(who);
        h.reveal(id, oc, salt(who), "blob://x");
    }

    /// @dev search prevrandao so drawAudit gives the wanted outcome (deterministic tests)
    function drawAs(bytes32 id, bool wantAudit) internal {
        for (uint256 v = 1; v < 500; ++v) {
            uint256 snap = vm.snapshotState();
            vm.prevrandao(bytes32(v));
            vm.prank(keeper, keeper);
            h.drawAudit(id);
            if (job(id).audited == wantAudit) return;
            vm.revertToState(snap);
        }
        revert("no randomness gave the wanted audit outcome");
    }

    /// @dev create -> executor commits `eText` -> draw(wantAudit)
    function toDraw(bytes32 model, bytes memory eText, bool wantAudit) internal returns (bytes32 id) {
        id = create(model);
        commitText(id, job(id).executor, eText);
        drawAs(id, wantAudit);
    }

    /// @dev audited job where both reveal: executor `eText`, verifier `vText`
    function auditedReveal(bytes32 model, bytes memory eText, bytes memory vText) internal returns (bytes32 id) {
        id = toDraw(model, eText, true);
        Hallmark.Job memory j = job(id);
        commitText(id, j.verifier, vText);
        revealTextHash(id, j.executor, eText);
        revealTextHash(id, j.verifier, vText);
    }

    function members(bytes32 id) internal view returns (address[] memory) {
        return h.committeeOf(id);
    }

    function committeeRun(bytes32 id, bytes[] memory texts, bool tolerance) internal {
        address[] memory m = members(id);
        for (uint256 i; i < m.length; ++i) {
            commitText(id, m[i], texts[i]);
        }
        for (uint256 i; i < m.length; ++i) {
            bytes32 oc = outC(id, texts[i]);
            vm.prank(m[i]);
            if (tolerance) h.revealText(id, texts[i], jobSalt(id), salt(m[i]), "blob://m");
            else h.reveal(id, oc, salt(m[i]), "blob://m");
        }
    }

    function three(bytes memory a, bytes memory b, bytes memory c) internal pure returns (bytes[] memory t) {
        t = new bytes[](3);
        t[0] = a;
        t[1] = b;
        t[2] = c;
    }

    function free(address a) internal view returns (uint256 f) {
        (f,,) = h.operators(a);
    }

    function locked(address a) internal view returns (uint256 l) {
        (, l,) = h.operators(a);
    }

    function assertConserved() internal view {
        assertEq(address(h).balance, h.accounted(), "conservation");
    }
}
