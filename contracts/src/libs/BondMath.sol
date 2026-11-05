// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title BondMath: the two bond limits of docs/CORE_MODEL.md (must match packages/shared/src/bond.ts)
///   Deterrence (floor):  B >= c / (p * pi) - F            -> ceil, then max(minBond, .)
///   Fairness (ceiling):  B <= m / (p * fp)                -> floor; no ceiling when fp == 0
///   p = auditBps / 1e4, pi = piBps / 1e4, fp = fpBps / 1e4. All amounts tinybar.
library BondMath {
    uint256 internal constant NO_CEILING = type(uint256).max;

    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /// @notice deterrence bond, never below minBond. auditBps and piBps must be > 0.
    function bond(uint256 c, uint256 fee, uint256 auditBps, uint256 piBps, uint256 minBond)
        internal
        pure
        returns (uint256)
    {
        uint256 need = ceilDiv(c * 1e8, auditBps * piBps);
        uint256 b = need > fee ? need - fee : 0;
        return b > minBond ? b : minBond;
    }

    /// @notice fairness ceiling m / (p * fp); NO_CEILING when fpBps == 0.
    function ceiling(uint256 margin, uint256 auditBps, uint256 fpBps) internal pure returns (uint256) {
        if (fpBps == 0) return NO_CEILING;
        return (margin * 1e8) / (auditBps * fpBps);
    }

    /// @notice the per-job audit surcharge ceil(auditBps * arbCostEst / 1e4)
    function auditFee(uint256 auditBps, uint256 arbCostEst) internal pure returns (uint256) {
        return ceilDiv(auditBps * arbCostEst, 1e4);
    }
}
