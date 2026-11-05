// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {Hallmark} from "../src/Hallmark.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";

contract Wrapper {
    /// @dev the re-roll attack: call drawAudit and revert unless the job came out unaudited
    function reroll(Hallmark h, bytes32 id) external {
        h.drawAudit(id);
        require(!h.getJob(id).audited, "audited: revert and try again");
    }
}

contract RejectingBuyer {
    receive() external payable {
        revert("no");
    }
}

contract LifecycleTest is Base {
    // ------------------------------------------------------------ create
    function test_quoteAndCreate() public {
        (uint256 p, uint256 bond, uint256 ceil, bool ok) = h.quote(ASR);
        assertEq(p, 20_000_000 + 1_000_000 + 3_000_000); // F + protocol + ceil(0.3 * 0.1 HBAR)
        assertEq(bond, 80_000_000); // 15e6 / (0.3 * 0.5) - 20e6
        assertEq(ceil, type(uint256).max); // fp = 0
        assertTrue(ok);
        bytes32 id = create(ASR);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.Assigned));
        assertTrue(j.executor != address(0));
        assertEq(locked(j.executor), bond);
        assertConserved();
    }

    function test_createRevertsWrongValueDuplicateAndNotGateway() public {
        bytes32 id = create(ASR);
        uint256 p = price(ASR);
        vm.prank(gateway);
        vm.expectRevert(Hallmark.JobExists.selector);
        h.createJob{value: p}(id, buyer, INPUT, ASR);
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(Hallmark.WrongValue.selector, p));
        h.createJob{value: p - 1}(keccak256("x"), buyer, INPUT, ASR);
        vm.expectRevert(Hallmark.NotGateway.selector);
        h.createJob{value: p}(keccak256("y"), buyer, INPUT, ASR);
    }

    /// edge case 4: fewer than 2 + committeeSize eligible operators
    function test_noCapacity() public {
        for (uint256 i; i < 2; ++i) {
            vm.prank(ops[i]);
            h.withdrawStake(STAKE);
        }
        (,,, bool ok) = h.quote(ASR);
        assertFalse(ok);
        uint256 p = price(ASR);
        vm.prank(gateway);
        vm.expectRevert(Hallmark.NoCapacity.selector);
        h.createJob{value: p}(keccak256("z"), buyer, INPUT, ASR);
    }

    // ------------------------------------------------------------ unaudited
    function test_honestUnaudited_settles() public {
        bytes32 id = toDraw(ASR, HONEST, false);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.Reveal));
        revealTextHash(id, j.executor, HONEST);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Challenge));
        vm.expectRevert(Hallmark.TooEarly.selector);
        h.settle(id);
        vm.warp(block.timestamp + 61);
        h.settle(id);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Settled));
        assertEq(h.credits(j.executor), j.fee);
        assertEq(locked(j.executor), 0);
        assertEq(h.treasury(), j.protocolFee);
        assertEq(h.auditPool(), j.auditFee);
        assertConserved();
        uint256 before = j.executor.balance;
        vm.prank(j.executor);
        h.withdraw();
        assertEq(j.executor.balance - before, j.fee);
        assertConserved();
    }

    /// edge case 9: a wrapper contract cannot re-roll the audit draw
    function test_wrapperRerollBlocked() public {
        bytes32 id = create(ASR);
        commitText(id, job(id).executor, HONEST);
        Wrapper w = new Wrapper();
        vm.prank(keeper, keeper); // tx.origin = keeper, msg.sender = wrapper
        vm.expectRevert(Hallmark.OnlyEOA.selector);
        w.reroll(h, id);
    }

    function test_drawOnlyAfterCommit() public {
        bytes32 id = create(ASR);
        vm.prank(keeper, keeper);
        vm.expectRevert(Hallmark.BadStatus.selector);
        h.drawAudit(id);
    }

    // ------------------------------------------------------------ audited, exact
    function test_auditedAgree_paysBoth() public {
        h.fundAuditPool{value: 1e8}();
        bytes32 id = auditedReveal(ASR, HONEST, HONEST);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.Settled));
        assertEq(h.credits(j.executor), j.fee);
        assertEq(h.credits(j.verifier), j.reward);
        assertEq(locked(j.executor) + locked(j.verifier), 0);
        assertConserved();
    }

    /// edge case 10: the verifier commits while the executor's output is still hidden
    function test_verifierBlind_executorCannotRevealFirst() public {
        bytes32 id = toDraw(ASR, HONEST, true);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.VerifierCommit));
        vm.prank(j.executor);
        vm.expectRevert(Hallmark.BadStatus.selector);
        h.reveal(id, keccak256(HONEST), salt(j.executor), "");
    }

    function test_badRevealAndEmptyOutput() public {
        bytes32 id = toDraw(ASR, HONEST, false);
        address e = job(id).executor;
        vm.prank(e);
        vm.expectRevert(Hallmark.BadReveal.selector);
        h.reveal(id, keccak256(GARBAGE), salt(e), "");
        vm.prank(e);
        vm.expectRevert(Hallmark.EmptyOutput.selector);
        h.reveal(id, keccak256(""), salt(e), "");
    }

    function test_mismatch_executorWrong_slashedAndRefunded() public {
        h.fundAuditPool{value: 5e8}();
        bytes32 id = auditedReveal(ASR, GARBAGE, HONEST);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.CommitteeCommit));
        Hallmark.Job memory j = job(id);
        uint256 eFree = free(j.executor);
        uint256 buyerBefore = buyer.balance;
        committeeRun(id, three(HONEST, HONEST, HONEST), false);
        h.resolve(id, new bytes[](0));
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(buyer.balance - buyerBefore, uint256(j.fee) + j.protocolFee + j.auditFee);
        assertEq(free(j.executor), eFree, "executor bond gone");
        assertEq(locked(j.executor), 0);
        assertEq(h.credits(j.verifier), uint256(j.bond) / 2 + j.reward, "finder + reward");
        assertConserved();
    }

    function test_mismatch_verifierWrong() public {
        h.fundAuditPool{value: 5e8}();
        bytes32 id = auditedReveal(ASR, HONEST, GARBAGE);
        Hallmark.Job memory j = job(id);
        committeeRun(id, three(HONEST, HONEST, HONEST), false);
        h.resolve(id, new bytes[](0));
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Settled));
        assertEq(h.credits(j.executor), j.fee);
        assertEq(h.credits(j.verifier), 0);
        address[] memory m = members(id);
        uint256 finderEach = (uint256(j.bond) / 2) / 3;
        assertEq(h.credits(m[0]), finderEach + j.reward);
        assertConserved();
    }

    /// exact class: a member that matches neither side loses its bond
    function test_exactMemberMatchingNeitherSlashed() public {
        h.fundAuditPool{value: 5e8}();
        bytes32 id = auditedReveal(ASR, GARBAGE, HONEST);
        address[] memory m = members(id);
        uint256 f2 = free(m[2]);
        committeeRun(id, three(HONEST, HONEST, "something else"), false);
        h.resolve(id, new bytes[](0));
        assertEq(free(m[2]), f2, "bond not returned");
        assertEq(h.credits(m[2]), 0);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertConserved();
    }

    function test_committeeNoShow_inconclusiveRefund() public {
        bytes32 id = auditedReveal(ASR, GARBAGE, HONEST);
        vm.warp(block.timestamp + 121);
        h.expire(id); // nobody committed
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        Hallmark.Job memory j = job(id);
        assertEq(locked(j.executor) + locked(j.verifier), 0, "no slash on inconclusive");
        assertConserved();
    }

    function test_committeeSplit_inconclusive() public {
        bytes32 id = auditedReveal(ASR, GARBAGE, HONEST);
        address[] memory m = members(id);
        // one member sides with each, one reveals nothing -> neither reaches 2 of 3
        commitText(id, m[0], GARBAGE);
        commitText(id, m[1], HONEST);
        vm.warp(block.timestamp + 121);
        h.expire(id); // m[2] did not commit
        revealTextHash(id, m[0], GARBAGE);
        revealTextHash(id, m[1], HONEST);
        h.resolve(id, new bytes[](0));
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertConserved();
    }

    // ------------------------------------------------------------ tolerance
    function test_tolerance_nearAgree() public {
        bytes32 id = auditedReveal(OCR, HONEST, NEAR);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Text));
        Hallmark.Job memory j = job(id);
        vm.prank(j.executor);
        h.postText(id, HONEST);
        vm.expectRevert(Hallmark.TextMissing.selector);
        h.compareTexts(id, HONEST, NEAR);
        vm.prank(j.verifier);
        h.postText(id, NEAR);
        h.compareTexts(id, HONEST, NEAR);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Settled));
        assertConserved();
    }

    function test_tolerance_committeeSlashesExecutor() public {
        bytes32 id = auditedReveal(OCR, GARBAGE, HONEST);
        Hallmark.Job memory j = job(id);
        vm.prank(j.executor);
        h.postText(id, GARBAGE);
        vm.prank(j.verifier);
        h.postText(id, HONEST);
        h.compareTexts(id, GARBAGE, HONEST);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.CommitteeCommit));
        bytes[] memory mt = three(HONEST, NEAR, HONEST);
        committeeRun(id, mt, true);
        bytes[] memory all = new bytes[](5);
        all[0] = GARBAGE;
        all[1] = HONEST;
        all[2] = mt[0];
        all[3] = mt[1];
        all[4] = mt[2];
        h.resolve(id, all);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(locked(j.executor), 0);
        assertConserved();
    }

    function test_tolerance_postTextRejectsBadText() public {
        bytes32 id = auditedReveal(OCR, HONEST, GARBAGE);
        address e = job(id).executor;
        vm.prank(e);
        vm.expectRevert(Hallmark.BadText.selector);
        h.postText(id, GARBAGE);
        vm.prank(e);
        vm.expectRevert(); // apostrophe is not an OCR word char
        h.postText(id, "it's");
    }

    function test_tolerance_missingText_executorPenalized() public {
        bytes32 id = auditedReveal(OCR, GARBAGE, HONEST);
        Hallmark.Job memory j = job(id);
        vm.prank(j.verifier);
        h.postText(id, HONEST);
        vm.warp(block.timestamp + 46);
        h.expire(id);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(h.slashPool(), uint256(j.bond) / 2);
        assertConserved();
    }

    // ------------------------------------------------------------ timeouts
    function test_noCommit_refundAndPenalty() public {
        bytes32 id = create(ASR);
        Hallmark.Job memory j = job(id);
        uint256 before = buyer.balance;
        vm.warp(block.timestamp + 61);
        h.expire(id);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(buyer.balance - before, uint256(j.fee) + j.protocolFee + j.auditFee);
        assertEq(free(j.executor), STAKE - uint256(j.bond) / 2);
        assertConserved();
    }

    function test_noReveal_penalty() public {
        bytes32 id = toDraw(ASR, HONEST, false);
        Hallmark.Job memory j = job(id);
        vm.warp(block.timestamp + 46);
        h.expire(id);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(h.slashPool(), uint256(j.bond) / 2);
        assertConserved();
    }

    /// edge case 12: verifier no-show -> one re-draw -> second no-show -> auditSkipped
    function test_verifierNoShow_redrawThenSkip() public {
        bytes32 id = toDraw(ASR, HONEST, true);
        address v1 = job(id).verifier;
        vm.warp(block.timestamp + 61);
        h.expire(id);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.VerifierCommit));
        assertTrue(j.verifier != v1 && j.verifier != j.executor);
        vm.warp(block.timestamp + 61);
        h.expire(id);
        j = job(id);
        assertTrue(j.auditSkipped);
        assertEq(uint8(j.status), uint8(Hallmark.Status.Reveal));
        revealTextHash(id, j.executor, HONEST);
        vm.warp(block.timestamp + 61);
        h.settle(id);
        assertEq(h.slashPool(), uint256(j.bond)); // two half-bond penalties
        assertConserved();
    }

    function test_verifierNoReveal_skipsAndPaysExecutor() public {
        bytes32 id = toDraw(ASR, HONEST, true);
        Hallmark.Job memory j = job(id);
        commitText(id, j.verifier, HONEST);
        revealTextHash(id, j.executor, HONEST);
        vm.warp(block.timestamp + 46);
        h.expire(id);
        j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.Settled));
        assertTrue(j.auditSkipped);
        assertEq(h.credits(j.executor), j.fee);
        assertConserved();
    }

    // ------------------------------------------------------------ challenge
    function _toChallenge(bytes memory eText) internal returns (bytes32 id) {
        id = toDraw(ASR, eText, false);
        revealTextHash(id, job(id).executor, eText);
    }

    function test_falseChallenge_forfeitsBond() public {
        bytes32 id = _toChallenge(HONEST);
        uint256 cb = job(id).challengeBond;
        assertEq(cb, 2 * job(id).fee);
        vm.prank(challenger);
        h.challenge{value: cb}(id);
        Hallmark.Job memory j = job(id);
        assertEq(uint8(j.status), uint8(Hallmark.Status.VerifierCommit));
        commitText(id, j.verifier, HONEST);
        revealTextHash(id, j.verifier, HONEST);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Settled));
        assertEq(h.credits(challenger), 0);
        assertEq(h.credits(j.executor), j.fee + cb / 2);
        assertConserved();
    }

    function test_collusionChallenge_catchesExecutor() public {
        h.fundAuditPool{value: 5e8}();
        bytes32 id = _toChallenge(GARBAGE);
        uint256 cb = job(id).challengeBond;
        vm.prank(challenger);
        h.challenge{value: cb}(id);
        Hallmark.Job memory j = job(id);
        commitText(id, j.verifier, HONEST);
        revealTextHash(id, j.verifier, HONEST);
        committeeRun(id, three(HONEST, HONEST, HONEST), false);
        h.resolve(id, new bytes[](0));
        assertEq(uint8(status(id)), uint8(Hallmark.Status.Refunded));
        assertEq(h.credits(challenger), cb + uint256(j.bond) / 2, "bond back + finder share");
        assertConserved();
    }

    function test_challengeWrongValueAndAfterWindow() public {
        bytes32 id = _toChallenge(HONEST);
        uint256 cb = job(id).challengeBond;
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Hallmark.WrongValue.selector, cb));
        h.challenge{value: cb - 1}(id);
        vm.warp(block.timestamp + 61);
        vm.prank(challenger);
        vm.expectRevert(Hallmark.WindowClosed.selector);
        h.challenge{value: cb}(id);
    }

    // ------------------------------------------------------------ money safety
    /// edge case 16: locked stake is never withdrawable
    function test_lockedStakeNotWithdrawable() public {
        bytes32 id = create(ASR);
        address e = job(id).executor;
        vm.prank(e);
        vm.expectRevert(Hallmark.Insufficient.selector);
        h.withdrawStake(STAKE);
        uint256 freeNow = STAKE - job(id).bond;
        vm.prank(e);
        h.withdrawStake(freeNow);
        assertConserved();
    }

    /// edge case 17: a buyer that rejects HBAR gets credits instead
    function test_refundFallsBackToCredits() public {
        RejectingBuyer rb = new RejectingBuyer();
        bytes32 id = keccak256("rb");
        uint256 p = price(ASR);
        vm.prank(gateway);
        h.createJob{value: p}(id, address(rb), INPUT, ASR);
        vm.warp(block.timestamp + 61);
        h.expire(id);
        assertEq(h.credits(address(rb)), p);
        assertConserved();
    }

    /// edge case 21: owner changes mid-job do not affect the running job
    function test_paramsSnapshot() public {
        bytes32 id = create(ASR);
        Hallmark.Params memory p = h.getParams();
        p.auditBps = 10_000;
        p.commitWindow = 600;
        vm.prank(owner);
        h.setParams(p);
        Hallmark.Job memory j = job(id);
        assertEq(j.auditBps, 3000);
        assertEq(j.commitWindow, 60);
    }

    function test_paramBounds() public {
        Hallmark.Params memory p = h.getParams();
        p.revealWindow = 10;
        vm.prank(owner);
        vm.expectRevert(Hallmark.BadParams.selector);
        h.setParams(p);
        vm.expectRevert();
        h.setParams(p); // not owner
    }

    /// edge case 27: a model whose bond window is empty cannot be enabled
    function test_emptyWindowRejected() public {
        ModelRegistry.Model memory m = ocrModel();
        m.fpBps = 5000; // false alarms everywhere -> ceiling tiny
        vm.prank(owner);
        vm.expectRevert();
        reg.setModel(keccak256("bad"), m);
    }

    function test_alwaysAudited() public {
        Hallmark.Params memory p = h.getParams();
        p.auditBps = 10_000;
        vm.prank(owner);
        h.setParams(p);
        bytes32 id = create(ASR);
        commitText(id, job(id).executor, HONEST);
        vm.prank(keeper, keeper);
        h.drawAudit(id);
        assertEq(uint8(status(id)), uint8(Hallmark.Status.VerifierCommit));
    }
}
