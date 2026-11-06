// SPDX-License-Identifier: MIT
pragma solidity =0.8.24 ^0.8.20;

// src/libs/BondMath.sol

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

// lib/openzeppelin-contracts/contracts/utils/Context.sol

// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// lib/openzeppelin-contracts/contracts/access/Ownable.sol

// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// src/ModelRegistry.sol

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

