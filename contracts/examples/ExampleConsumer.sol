// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IHallmarkVerdict} from "../src/IHallmarkVerdict.sol";

/// @title ExampleConsumer (EXAMPLE ONLY, not audited, not deployed)
/// @notice An escrow that pays a provider only when its Hallmark job was AUDITED and upheld.
///         A payer locks HBAR against a job id; anyone may `close` once the verdict is final.
///           FinalAudited                                  -> the payee is paid
///           anything else (FinalUnaudited, AuditSkipped,  -> the payer is refunded
///           ExecutorSlashed, Refunded, Voided)
///         FinalUnaudited and AuditSkipped are NEVER treated as audited: nobody re-ran those jobs.
/// @dev The payer chooses the job id. Checking that the job is about the right input (getJob(id).inputHash)
///      and the right model is the payer's job before it locks funds; this example does not do it.
contract ExampleConsumer {
    struct Escrow {
        address payer;
        address payee;
        uint256 amount;
    }

    IHallmarkVerdict public immutable hallmark;
    mapping(bytes32 => Escrow) public escrows;

    event Opened(bytes32 indexed jobId, address indexed payer, address indexed payee, uint256 amount);
    event Closed(bytes32 indexed jobId, IHallmarkVerdict.Verdict verdict, address to, uint256 amount);

    error Exists();
    error Unknown();
    error NotFinal();
    error TransferFailed();

    constructor(IHallmarkVerdict hallmark_) {
        hallmark = hallmark_;
    }

    function open(bytes32 jobId, address payee) external payable {
        if (escrows[jobId].amount != 0) revert Exists();
        if (msg.value == 0 || payee == address(0)) revert Unknown();
        escrows[jobId] = Escrow(msg.sender, payee, msg.value);
        emit Opened(jobId, msg.sender, payee, msg.value);
    }

    function close(bytes32 jobId) external {
        Escrow memory e = escrows[jobId];
        if (e.amount == 0) revert Unknown();
        if (hallmark.finalizedAt(jobId) == 0) revert NotFinal();
        IHallmarkVerdict.Verdict v = hallmark.status(jobId);
        address to = v == IHallmarkVerdict.Verdict.FinalAudited ? e.payee : e.payer;
        delete escrows[jobId];
        emit Closed(jobId, v, to, e.amount);
        (bool ok,) = to.call{value: e.amount}("");
        if (!ok) revert TransferFailed();
    }
}
