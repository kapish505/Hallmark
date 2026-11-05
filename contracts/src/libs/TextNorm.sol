// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title TextNorm: validation of normalized output (must match packages/shared/src/norm.ts)
/// @notice The contract never normalizes raw text; operators commit to the hash of the
///         normalized text and the contract only checks that posted text IS normalized.
///   NORM_ASR_V1 (spec 1): words of [a-z0-9'] separated by single spaces, no leading/trailing space.
///   NORM_OCR_V1B (spec 2): words of [a-z0-9], plus '.' and ',' only BETWEEN two digits (so amounts like
///                          42.50 and 1,200 survive), separated by single spaces, no leading/trailing space.
///   Limits: MAX_BYTES = 1024, MAX_WORDS = 96 (bounds the on-chain overlap cost).
library TextNorm {
    uint256 internal constant MAX_BYTES = 1024;
    uint256 internal constant MAX_WORDS = 96;
    uint8 internal constant ASR_V1 = 1;
    uint8 internal constant OCR_V1B = 2;

    error BadChar(uint256 index);
    error TooLong();
    error TooManyWords();
    error BadSpacing();
    error BadSpec();

    function _isWordChar(uint8 c, uint8 spec) private pure returns (bool) {
        return (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || (c == 0x27 && spec == ASR_V1);
    }

    /// @dev '.' or ',' with a digit on both sides
    function _isDigitSep(bytes memory s, uint256 i) private pure returns (bool) {
        uint8 c = uint8(s[i]);
        if ((c != 0x2e && c != 0x2c) || i == 0 || i + 1 >= s.length) return false;
        uint8 a = uint8(s[i - 1]);
        uint8 b = uint8(s[i + 1]);
        return a >= 0x30 && a <= 0x39 && b >= 0x30 && b <= 0x39;
    }

    /// @return words number of words (0 for empty input). Reverts if `s` is not normalized.
    function validate(bytes memory s, uint8 spec) internal pure returns (uint256 words) {
        if (spec != ASR_V1 && spec != OCR_V1B) revert BadSpec();
        uint256 n = s.length;
        if (n > MAX_BYTES) revert TooLong();
        if (n == 0) return 0;
        if (s[n - 1] == 0x20) revert BadSpacing();
        bool prevSpace = true; // also rejects a leading space
        for (uint256 i; i < n; ++i) {
            uint8 c = uint8(s[i]);
            if (c == 0x20) {
                if (prevSpace) revert BadSpacing();
                prevSpace = true;
            } else if (_isWordChar(c, spec) || (spec == OCR_V1B && _isDigitSep(s, i))) {
                if (prevSpace) {
                    unchecked {
                        ++words;
                    }
                    prevSpace = false;
                }
            } else {
                revert BadChar(i);
            }
        }
        if (words > MAX_WORDS) revert TooManyWords();
    }

    /// @notice keccak256 of every word. Input MUST already be valid normalized text.
    function wordHashes(bytes memory s) internal pure returns (bytes32[] memory h) {
        uint256 n = s.length;
        uint256 count;
        for (uint256 i; i < n; ++i) {
            if (s[i] != 0x20 && (i == 0 || s[i - 1] == 0x20)) ++count;
        }
        h = new bytes32[](count);
        uint256 k;
        uint256 start;
        for (uint256 i; i <= n; ++i) {
            if (i == n || s[i] == 0x20) {
                if (i > start) {
                    bytes32 hash;
                    assembly {
                        hash := keccak256(add(add(s, 32), start), sub(i, start))
                    }
                    h[k++] = hash;
                }
                start = i + 1;
            }
        }
    }
}
