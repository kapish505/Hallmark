// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Overlap: Dice coefficient over word-hash multisets, in basis points
/// @notice overlapBps(A, B) = 10000 * 2 * |A ∩ B| / (|A| + |B|), multiset intersection with a
///         used-bitmap nested loop. 0 if either side is empty. B may hold at most 256 words.
library Overlap {
    error TooManyWords();

    function bps(bytes32[] memory a, bytes32[] memory b) internal pure returns (uint256) {
        uint256 na = a.length;
        uint256 nb = b.length;
        if (na == 0 || nb == 0) return 0;
        if (nb > 256) revert TooManyWords();
        uint256 used;
        uint256 common;
        for (uint256 i; i < na; ++i) {
            bytes32 w = a[i];
            for (uint256 j; j < nb; ++j) {
                if ((used >> j) & 1 == 0 && b[j] == w) {
                    used |= (1 << j);
                    ++common;
                    break;
                }
            }
        }
        return (20_000 * common) / (na + nb);
    }
}
