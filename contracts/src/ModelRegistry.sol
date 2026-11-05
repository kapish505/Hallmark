// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BondMath} from "./libs/BondMath.sol";

interface IHallmarkParams {
    function auditBps() external view returns (uint16);
    function minBond() external view returns (uint128);
}

/// @title ModelRegistry: one entry per pinned model (section 8.1)
/// @notice Owner-set with bounds. Enabling a model reverts if its bond window is empty for the
///         current audit rate: deterrence bond > fairness ceiling (edge case 27).
contract ModelRegistry is Ownable {
    uint8 public constant EXACT = 0;
    uint8 public constant TOLERANCE = 1;
    uint16 public constant MAX_WORDS = 96;

    struct Model {
        uint8 class; // EXACT | TOLERANCE
        uint16 tauBps; // overlap threshold (TOLERANCE only)
        uint8 normSpec; // 1 = NORM_ASR_V1, 2 = NORM_OCR_V1
        uint16 minWords;
        uint16 maxWords;
        bool enabled;
        uint16 piBps; // measured catch rate of the worst cheat (G3)
        uint16 fpBps; // measured false-alarm rate (G3)
        bytes32 runtimeDigest; // container image digest
        bytes32 hwClass; // hardware / OS class every operator in the pool must use
        uint128 fee; // F: executor fee, tinybar
        uint128 cTinybar; // c: compute saved by the worst cheat
        uint128 marginTinybar; // m = F - c_honest
    }

    mapping(bytes32 => Model) private _models;
    bytes32[] public modelIds;
    IHallmarkParams public hallmark;

    event ModelSet(bytes32 indexed modelId, Model model, uint256 bond, uint256 ceiling);
    event HallmarkSet(address hallmark);

    error BadModel();
    error WindowEmpty(uint256 bond, uint256 ceiling);
    error HallmarkNotSet();
    error AlreadySet();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice One-time link to the core contract (its auditBps and minBond feed the window check).
    function setHallmark(address h) external onlyOwner {
        if (address(hallmark) != address(0)) revert AlreadySet();
        hallmark = IHallmarkParams(h);
        emit HallmarkSet(h);
    }

    function setModel(bytes32 id, Model calldata m) external onlyOwner {
        if (
            id == bytes32(0) || m.class > TOLERANCE || m.tauBps > 10_000 || (m.normSpec != 1 && m.normSpec != 2)
                || m.minWords == 0 || m.maxWords > MAX_WORDS || m.minWords > m.maxWords || m.piBps == 0
                || m.piBps > 10_000 || m.fpBps > 10_000 || m.fee == 0 || (m.class == TOLERANCE && m.tauBps == 0)
        ) revert BadModel();
        uint256 b;
        uint256 ceil;
        if (m.enabled) {
            if (address(hallmark) == address(0)) revert HallmarkNotSet();
            (b, ceil) = window(m, hallmark.auditBps(), hallmark.minBond());
            if (b > ceil) revert WindowEmpty(b, ceil);
        }
        if (_models[id].fee == 0) modelIds.push(id);
        _models[id] = m;
        emit ModelSet(id, m, b, ceil);
    }

    function get(bytes32 id) external view returns (Model memory) {
        return _models[id];
    }

    function modelCount() external view returns (uint256) {
        return modelIds.length;
    }

    /// @notice (deterrence bond, fairness ceiling) for a model at audit rate `auditBps`.
    function window(Model memory m, uint256 auditBps, uint256 minBond) public pure returns (uint256 b, uint256 ceil) {
        b = BondMath.bond(m.cTinybar, m.fee, auditBps, m.piBps, minBond);
        ceil = BondMath.ceiling(m.marginTinybar, auditBps, m.fpBps);
    }
}
