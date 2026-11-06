// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BondMath} from "./libs/BondMath.sol";

interface IHallmarkParams {
    function bondParams() external view returns (uint16 auditBps, uint128 minBond);
}

/// @title ModelRegistry: one entry per pinned model (section 8.1)
/// @notice Anyone may PROPOSE a model (from its manifest); only the owner ENABLES one, and enabling reverts
///         if its bond window is empty for the current audit rate: deterrence bond > fairness ceiling
///         (edge case 27). Enabling stays with the owner because a fake manifest could claim a low bond.
contract ModelRegistry is Ownable {
    uint8 public constant EXACT = 0;
    uint8 public constant TOLERANCE = 1;
    uint16 public constant MAX_WORDS = 96;

    struct Model {
        uint8 class; // EXACT | TOLERANCE
        uint16 tauBps; // overlap threshold (TOLERANCE only)
        uint8 normSpec; // normalization rule id in the TextNorm rule library (1 or 2)
        uint16 minWords;
        uint16 maxWords;
        bool enabled;
        uint16 piBps; // measured catch rate of the worst cheat (G3)
        uint16 fpBps; // measured false-alarm rate (G3)
        uint16 expectedErrorBps; // informational: pinned model's measured error rate (metric named in its manifest), add-on A2
        uint32 errorSampleSize; // informational: number of reference samples behind expectedErrorBps
        bytes32 runtimeDigest; // container image digest
        bytes32 hwClass; // hardware / OS class every operator in the pool must use
        uint128 fee; // F: executor fee, tinybar
        uint128 cTinybar; // c: compute saved by the worst cheat
        uint128 marginTinybar; // m = F - c_honest
    }

    mapping(bytes32 => Model) private _models;
    mapping(bytes32 => Model) private _proposals;
    bytes32[] public modelIds;
    IHallmarkParams public hallmark;

    event ModelSet(bytes32 indexed modelId, Model model, uint256 bond, uint256 ceiling);
    event HallmarkSet(address hallmark);
    event ModelProposed(bytes32 indexed modelId, address indexed proposer, bytes32 proposalHash, bytes32 manifestHash, string manifestUri);

    error BadModel();
    error WindowEmpty(uint256 bond, uint256 ceiling);
    error HallmarkNotSet();
    error AlreadySet();
    error NoProposal();
    error ProposalChanged();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice One-time link to the core contract (its auditBps and minBond feed the window check).
    function setHallmark(address h) external onlyOwner {
        if (address(hallmark) != address(0)) revert AlreadySet();
        hallmark = IHallmarkParams(h);
        emit HallmarkSet(h);
    }

    function setModel(bytes32 id, Model memory m) public onlyOwner {
        _check(id, m);
        uint256 b;
        uint256 ceil;
        if (m.enabled) {
            if (address(hallmark) == address(0)) revert HallmarkNotSet();
            (uint16 auditBps, uint128 minBond) = hallmark.bondParams();
            (b, ceil) = window(m, auditBps, minBond);
            if (b > ceil) revert WindowEmpty(b, ceil);
        }
        if (_models[id].fee == 0) modelIds.push(id);
        _models[id] = m;
        emit ModelSet(id, m, b, ceil);
    }

    /// @notice Anyone: propose a model from its manifest. Stored disabled; nothing changes until the owner enables it.
    ///         `manifestHash` / `manifestUri` point at the full manifest (container digest, normalization, calibration).
    function proposeModel(bytes32 id, Model calldata m, bytes32 manifestHash, string calldata manifestUri) external {
        _check(id, m);
        _proposals[id] = m;
        _proposals[id].enabled = false;
        emit ModelProposed(id, msg.sender, proposalHash(id), manifestHash, manifestUri);
    }

    /// @notice Owner: enable the proposal it reviewed. `expectedHash` pins the exact proposal, so a later
    ///         re-proposal by someone else cannot be slipped in. Reverts if the bond window is empty.
    function enableModel(bytes32 id, bytes32 expectedHash) external onlyOwner {
        Model memory m = _proposals[id];
        if (m.fee == 0) revert NoProposal();
        if (proposalHash(id) != expectedHash) revert ProposalChanged();
        delete _proposals[id];
        m.enabled = true;
        setModel(id, m);
    }

    function proposal(bytes32 id) external view returns (Model memory) {
        return _proposals[id];
    }

    function proposalHash(bytes32 id) public view returns (bytes32) {
        return keccak256(abi.encode(id, _proposals[id]));
    }

    function _check(bytes32 id, Model memory m) private pure {
        if (
            id == bytes32(0) || m.class > TOLERANCE || m.tauBps > 10_000 || (m.normSpec != 1 && m.normSpec != 2)
                || m.minWords == 0 || m.maxWords > MAX_WORDS || m.minWords > m.maxWords || m.piBps == 0
                || m.piBps > 10_000 || m.fpBps > 10_000 || m.expectedErrorBps > 10_000 || m.fee == 0 || (m.class == TOLERANCE && m.tauBps == 0)
        ) revert BadModel();
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
