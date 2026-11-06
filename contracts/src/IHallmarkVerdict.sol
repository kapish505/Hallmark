// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IHallmarkVerdict: what other contracts read to act on a Hallmark job
/// @notice A verdict is final once `finalizedAt(jobId) != 0`; it never changes after that.
///   FinalAudited    settled, and a second operator re-ran the job and agreed (or a committee upheld it)
///   FinalUnaudited  settled without a re-run: bond-backed only, NOT checked
///   ExecutorSlashed the executor's output was found wrong; it was slashed and the buyer refunded
///   Refunded        refunded for any other reason (no-show, inconclusive committee)
///   Voided          both drawn executors reported the input missing; refunded minus the void fee
///   AuditSkipped    settled, an audit was drawn but no verifier could be seated: NOT checked
///   Fidelity to the pinned model is what is checked, not the truth of the output.
interface IHallmarkVerdict {
    enum Verdict {
        Pending,
        FinalAudited,
        FinalUnaudited,
        ExecutorSlashed,
        Refunded,
        Voided,
        AuditSkipped
    }

    function status(bytes32 jobId) external view returns (Verdict);

    /// @notice The executor's salted output commitment for a settled job (zero otherwise).
    function outCommit(bytes32 jobId) external view returns (bytes32);

    /// @notice Block timestamp at which the job became final (zero while pending).
    function finalizedAt(bytes32 jobId) external view returns (uint64);
}
