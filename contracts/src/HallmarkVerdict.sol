// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Hallmark} from "./Hallmark.sol";
import {IHallmarkVerdict} from "./IHallmarkVerdict.sol";

/// @title HallmarkVerdict: IHallmarkVerdict for one Hallmark deployment
/// @notice A read-only view over the core contract (a separate contract only because the core sits at
///         the 24,576-byte cap). It holds no funds and no state besides the core address, so reading it is
///         exactly as trustworthy as reading Hallmark.getJob yourself. The core's events carry the same
///         data: StatusChanged (final status), JobSettled (audited, auditSkipped), Slashed (reason 4 =
///         wrong output), Revealed (the executor's outCommit).
contract HallmarkVerdict is IHallmarkVerdict {
    Hallmark public immutable core;

    constructor(Hallmark core_) {
        core = core_;
    }

    /// @inheritdoc IHallmarkVerdict
    function status(bytes32 jobId) public view returns (Verdict) {
        Hallmark.Job memory j = core.getJob(jobId);
        if (j.status == Hallmark.Status.Settled) {
            if (j.auditSkipped) return Verdict.AuditSkipped;
            return j.audited ? Verdict.FinalAudited : Verdict.FinalUnaudited;
        }
        if (j.status == Hallmark.Status.Refunded) return j.executorSlashed ? Verdict.ExecutorSlashed : Verdict.Refunded;
        if (j.status == Hallmark.Status.Voided) return Verdict.Voided;
        return Verdict.Pending;
    }

    /// @inheritdoc IHallmarkVerdict
    function outCommit(bytes32 jobId) external view returns (bytes32) {
        Hallmark.Job memory j = core.getJob(jobId);
        if (j.status != Hallmark.Status.Settled) return bytes32(0);
        return core.seat(jobId, j.executor).outCommit;
    }

    /// @inheritdoc IHallmarkVerdict
    function finalizedAt(bytes32 jobId) external view returns (uint64) {
        return core.getJob(jobId).finalizedAt;
    }
}
