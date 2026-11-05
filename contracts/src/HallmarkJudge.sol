// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TextNorm} from "./libs/TextNorm.sol";
import {Overlap} from "./libs/Overlap.sol";

/// @title HallmarkJudge: stateless normalization check + word overlap
/// @notice A separate contract so Hallmark stays under the 24,576-byte code-size cap.
contract HallmarkJudge {
    /// @notice Reverts unless `text` is valid normalized text for `spec`; returns its word count.
    function check(bytes calldata text, uint8 spec) external pure returns (uint256 words) {
        return TextNorm.validate(text, spec);
    }

    /// @notice overlapBps between two already-normalized texts.
    function overlap(bytes calldata a, bytes calldata b) external pure returns (uint256) {
        return Overlap.bps(TextNorm.wordHashes(a), TextNorm.wordHashes(b));
    }
}
