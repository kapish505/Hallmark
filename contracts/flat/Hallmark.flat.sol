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

// lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
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
        uint8 normSpec; // 1 = NORM_ASR_V1, 2 = NORM_OCR_V1B
        uint16 minWords;
        uint16 maxWords;
        bool enabled;
        uint16 piBps; // measured catch rate of the worst cheat (G3)
        uint16 fpBps; // measured false-alarm rate (G3)
        uint16 expectedErrorBps; // informational: pinned model's measured WER (ASR) / CER (OCR), add-on A2
        uint32 errorSampleSize; // informational: number of reference samples behind expectedErrorBps
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
                || m.piBps > 10_000 || m.fpBps > 10_000 || m.expectedErrorBps > 10_000 || m.fee == 0 || (m.class == TOLERANCE && m.tauBps == 0)
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

// src/Hallmark.sol

interface IHallmarkJudge {
    function check(bytes calldata text, uint8 spec) external pure returns (uint256 words);
    function overlap(bytes calldata a, bytes calldata b) external pure returns (uint256);
}

/// @title Hallmark: escrow, bonds, commit-then-draw audit, verifier re-run, committee, slashing
/// @notice All amounts are TINYBAR (Hedera). Lifecycle (section 4.3 / 8.3):
///   createJob -> executor commit -> drawAudit (EOA only) ->
///     not audited: executor reveal -> challenge window -> settle
///     audited:     verifier commits blind -> both reveal -> compare -> agree | (text) | committee -> resolve
///   Every stalled stage has an `expire` path that refunds the buyer and penalizes only the missing party.
///   Output text never appears in events; only salted commitments (and, in tolerance disputes, calldata text).
contract Hallmark is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------- types
    enum Status {
        None,
        Assigned, // executor must commit
        Committed, // waiting for drawAudit
        VerifierCommit, // verifier must commit (blind)
        Reveal, // executor (and verifier) must reveal
        Challenge, // unaudited result, challenge window open
        Text, // tolerance mismatch: executor and verifier must post text
        CommitteeCommit,
        CommitteeReveal,
        Settled,
        Refunded
    }

    struct Params {
        uint16 auditBps;
        uint8 committeeSize;
        uint16 noRevealSlashBps;
        uint16 slashToFinderBps;
        uint32 challengeBondMultBps;
        uint32 commitWindow;
        uint32 drawWindow;
        uint32 revealWindow;
        uint32 challengeWindow;
        uint32 committeeWindow;
        uint128 protocolFee;
        uint128 arbCostEst;
        uint128 minBond;
        uint128 minStake;
    }

    struct Job {
        address buyer;
        Status status;
        uint8 cls;
        uint8 normSpec;
        uint16 tauBps;
        uint16 auditBps;
        bool audited;
        bool auditSkipped;
        bool challenged;
        uint8 redraws;
        uint8 committeeSize;
        address executor;
        uint64 deadline;
        uint8 committed;
        uint8 revealedCount;
        uint16 minWords;
        address verifier;
        uint16 maxWords;
        uint16 noRevealSlashBps;
        uint16 slashToFinderBps;
        uint32 commitWindow;
        address challenger;
        uint32 drawWindow;
        uint32 revealWindow;
        uint32 challengeWindow;
        uint32 committeeWindow;
        uint64 createdAt;
        bytes32 modelId;
        bytes32 inputHash;
        bytes32 saltCommit;
        uint128 fee;
        uint128 protocolFee;
        uint128 auditFee;
        uint128 bond;
        uint128 challengeBond;
        uint128 reward;
    }

    struct Seat {
        bytes32 commitment;
        bytes32 outCommit;
        uint8 role;
        bool revealed;
        bool textPosted;
        bool bondHeld;
    }

    struct Operator {
        uint128 free;
        uint128 locked;
        bool registered;
    }

    // ---------------------------------------------------------------- constants
    uint8 internal constant ROLE_EXECUTOR = 1;
    uint8 internal constant ROLE_VERIFIER = 2;
    uint8 internal constant ROLE_MEMBER = 3;
    uint8 internal constant TOLERANCE = 1;

    uint8 internal constant OUT_AGREED = 1;
    uint8 internal constant OUT_VERIFIER_WRONG = 2;
    uint8 internal constant OUT_EXECUTOR_WRONG = 3;
    uint8 internal constant OUT_BOTH_CONSISTENT = 4;
    uint8 internal constant OUT_INCONCLUSIVE = 5;

    uint8 internal constant R_NO_COMMIT = 1;
    uint8 internal constant R_NO_REVEAL = 2;
    uint8 internal constant R_VERIFIER_NOSHOW = 3;
    uint8 internal constant R_WRONG = 4;
    uint8 internal constant R_MEMBER_NOSHOW = 5;
    uint8 internal constant R_MEMBER_MISMATCH = 6;
    uint8 internal constant R_NO_TEXT = 7;

    uint8 internal constant PAY_FEE = 1;
    uint8 internal constant PAY_VERIFIER = 2;
    uint8 internal constant PAY_MEMBER = 3;
    uint8 internal constant PAY_FINDER = 4;
    uint8 internal constant PAY_CHALLENGE_REFUND = 5;
    uint8 internal constant PAY_CHALLENGE_FORFEIT = 6;

    bytes32 public constant COMMIT_DOMAIN = keccak256("HALLMARK_COMMIT_V2");
    address internal constant PRNG = address(0x169);
    uint256 internal constant MAX_OPERATORS = 64;
    uint256 internal constant PUSH_GAS = 10_000;
    bytes32 public constant OUT_DOMAIN = keccak256("HALLMARK_OUT_V1");

    // ---------------------------------------------------------------- state
    ModelRegistry public immutable registry;
    IHallmarkJudge public immutable judge;
    address public gateway;
    Params internal params;

    mapping(address => Operator) public operators;
    address[] public operatorList;

    mapping(bytes32 => Job) internal _jobs;
    mapping(bytes32 => mapping(address => Seat)) internal _seats;
    mapping(bytes32 => address[]) internal _committee;
    mapping(address => uint256) public credits;

    uint256 public totalFree;
    uint256 public totalLocked;
    uint256 public escrow;
    uint256 public creditsTotal;
    uint256 public auditPool;
    uint256 public slashPool;
    uint256 public treasury;
    uint256 public challengeEscrow;
    uint256 internal _nonce;

    // ---------------------------------------------------------------- events
    event ParamsSet(Params p);
    event GatewaySet(address gateway);
    event OperatorRegistered(address indexed op, uint256 stake);
    event StakeChanged(address indexed op, uint256 free, uint256 locked);
    event JobCreated(
        bytes32 indexed jobId,
        address indexed buyer,
        bytes32 indexed modelId,
        bytes32 inputHash,
        uint256 price,
        uint256 bond,
        address executor
    );
    event StatusChanged(bytes32 indexed jobId, Status status, uint64 deadline);
    event Committed(bytes32 indexed jobId, address indexed who, uint8 role);
    event AuditDrawn(bytes32 indexed jobId, bool audited, bool prng);
    event VerifierAssigned(bytes32 indexed jobId, address indexed verifier);
    event Revealed(bytes32 indexed jobId, address indexed who, uint8 role, bytes32 outCommit, string evidenceRef);
    event TextPosted(bytes32 indexed jobId, address indexed who);
    event Compared(bytes32 indexed jobId, bool agree, uint256 overlapBps);
    event CommitteeDrawn(bytes32 indexed jobId, address[] members);
    event Resolved(bytes32 indexed jobId, uint8 outcome, uint256 consistentE, uint256 consistentV, uint256 revealed);
    event Challenged(bytes32 indexed jobId, address indexed challenger, uint256 bond);
    event Slashed(bytes32 indexed jobId, address indexed who, uint256 amount, uint8 reason);
    event Paid(bytes32 indexed jobId, address indexed to, uint256 amount, uint8 kind);
    event JobSettled(bytes32 indexed jobId, bool audited, bool auditSkipped);
    event JobRefunded(bytes32 indexed jobId, address buyer, uint256 amount, bool pushed);
    event Withdrawn(address indexed to, uint256 amount);

    // ---------------------------------------------------------------- errors
    error NotGateway();
    error BadArgs();
    error BadParams();
    error JobExists();
    error ModelDisabled();
    error WindowEmpty(uint256 bond, uint256 ceiling);
    error WrongValue(uint256 expected);
    error NoCapacity();
    error BadStatus();
    error WindowClosed();
    error TooEarly();
    error NotYourTurn();
    error OnlyEOA();
    error BadReveal();
    error EmptyOutput();
    error BadSalt();
    error BadText();
    error TextMissing();
    error BadWordCount(uint256 words);
    error UseRevealText();
    error AlreadyRegistered();
    error NotRegistered();
    error StakeTooLow();
    error TooManyOperators();
    error Insufficient();
    error TransferFailed();

    constructor(address owner_, ModelRegistry registry_, IHallmarkJudge judge_, address gateway_) Ownable(owner_) {
        registry = registry_;
        judge = judge_;
        gateway = gateway_;
        // [DEMO]/[ASSUMED] defaults; replace with measured values via setParams (docs/MEASUREMENTS.md)
        _setParams(
            Params({
                auditBps: 3000,
                committeeSize: 3,
                noRevealSlashBps: 5000,
                slashToFinderBps: 5000,
                challengeBondMultBps: 20_000,
                commitWindow: 60,
                drawWindow: 30,
                revealWindow: 45,
                challengeWindow: 60,
                committeeWindow: 120,
                protocolFee: 1_000_000,
                arbCostEst: 10_000_000,
                minBond: 10_000_000,
                minStake: 100_000_000
            })
        );
    }

    // ---------------------------------------------------------------- owner
    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    function _setParams(Params memory p) internal {
        if (
            p.auditBps == 0 || p.auditBps > 10_000 || p.committeeSize == 0 || p.committeeSize > 7
                || p.noRevealSlashBps > 10_000 || p.slashToFinderBps > 10_000 || p.challengeBondMultBps == 0
                || p.challengeBondMultBps > 100_000 || !_win(p.commitWindow) || !_win(p.drawWindow)
                || !_win(p.revealWindow) || !_win(p.challengeWindow) || !_win(p.committeeWindow) || p.minBond == 0
                || p.minStake < p.minBond
        ) revert BadParams();
        params = p;
        emit ParamsSet(p);
    }

    function _win(uint32 w) private pure returns (bool) {
        return w >= 20 && w <= 1 days; // >= 20 s: Hedera finality is 3-5 s
    }

    function setGateway(address g) external onlyOwner {
        gateway = g;
        emit GatewaySet(g);
    }

    /// @notice Anyone may top up the audit pool that pays verifiers and committee members.
    function fundAuditPool() external payable {
        auditPool += msg.value;
    }

    function moveSlashToAuditPool(uint256 amount) external onlyOwner {
        if (amount > slashPool) revert Insufficient();
        slashPool -= amount;
        auditPool += amount;
    }

    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > treasury) revert Insufficient();
        treasury -= amount;
        _send(to, amount);
    }

    /// @notice Used by ModelRegistry for the bond-window check.
    function auditBps() external view returns (uint16) {
        return params.auditBps;
    }

    function minBond() external view returns (uint128) {
        return params.minBond;
    }

    // ---------------------------------------------------------------- operators
    function registerOperator() external payable {
        Operator storage o = operators[msg.sender];
        if (o.registered) revert AlreadyRegistered();
        if (msg.value < params.minStake) revert StakeTooLow();
        if (operatorList.length >= MAX_OPERATORS) revert TooManyOperators();
        o.registered = true;
        o.free = uint128(msg.value);
        totalFree += msg.value;
        operatorList.push(msg.sender);
        emit OperatorRegistered(msg.sender, msg.value);
    }

    function topUp() external payable {
        Operator storage o = operators[msg.sender];
        if (!o.registered) revert NotRegistered();
        o.free += uint128(msg.value);
        totalFree += msg.value;
        emit StakeChanged(msg.sender, o.free, o.locked);
    }

    /// @notice Only free stake is withdrawable; stake locked as a bond never is (edge case 16).
    function withdrawStake(uint256 amount) external nonReentrant {
        Operator storage o = operators[msg.sender];
        if (amount > o.free) revert Insufficient();
        o.free -= uint128(amount);
        totalFree -= amount;
        emit StakeChanged(msg.sender, o.free, o.locked);
        _send(msg.sender, amount);
    }

    /// @notice Pull payments: fees, rewards, finder shares, and refunds that could not be pushed.
    function withdraw() external nonReentrant {
        uint256 amt = credits[msg.sender];
        credits[msg.sender] = 0;
        creditsTotal -= amt;
        emit Withdrawn(msg.sender, amt);
        _send(msg.sender, amt);
    }

    // ---------------------------------------------------------------- quote / create
    /// @return price tinybar the gateway must send with createJob
    /// @return bond per-job bond (executor, verifier and each committee member)
    /// @return ceiling fairness ceiling (type(uint).max if fp = 0)
    /// @return available model enabled, window non-empty, and enough eligible operators
    function quote(bytes32 modelId)
        public
        view
        returns (uint256 price, uint256 bond, uint256 ceiling, bool available)
    {
        ModelRegistry.Model memory m = registry.get(modelId);
        Params memory p = params;
        (bond, ceiling) = registry.window(m, p.auditBps, p.minBond);
        price = m.fee + p.protocolFee + BondMath.auditFee(p.auditBps, p.arbCostEst);
        available = m.enabled && bond <= ceiling && eligibleCount(bond) >= 2 + uint256(p.committeeSize);
    }

    function createJob(bytes32 jobId, address buyer, bytes32 inputHash, bytes32 saltCommit, bytes32 modelId)
        external
        payable
        nonReentrant
    {
        if (msg.sender != gateway) revert NotGateway();
        Job storage j = _jobs[jobId];
        if (jobId == bytes32(0) || j.status != Status.None) revert JobExists();
        if (buyer == address(0) || inputHash == bytes32(0) || saltCommit == bytes32(0)) revert BadArgs();
        ModelRegistry.Model memory m = registry.get(modelId);
        if (!m.enabled) revert ModelDisabled();
        Params memory p = params;
        (uint256 bond, uint256 ceil) = registry.window(m, p.auditBps, p.minBond);
        if (bond > ceil) revert WindowEmpty(bond, ceil);
        uint256 aFee = BondMath.auditFee(p.auditBps, p.arbCostEst);
        uint256 price = m.fee + p.protocolFee + aFee;
        if (msg.value != price) revert WrongValue(price);
        if (eligibleCount(bond) < 2 + uint256(p.committeeSize)) revert NoCapacity();

        _snapshot(j, m, p);
        j.buyer = buyer;
        j.modelId = modelId;
        j.inputHash = inputHash;
        j.saltCommit = saltCommit;
        j.auditFee = uint128(aFee);
        j.bond = uint128(bond);
        escrow += price;

        address e = _draw(jobId, bond, _exclusions(jobId, j));
        j.executor = e;
        _lockSeat(jobId, e, bond, ROLE_EXECUTOR);
        emit JobCreated(jobId, buyer, modelId, inputHash, price, bond, e);
        _setStatus(jobId, j, Status.Assigned, j.commitWindow);
    }

    /// @dev per-job snapshot so owner changes never affect running jobs (edge case 21)
    function _snapshot(Job storage j, ModelRegistry.Model memory m, Params memory p) private {
        j.cls = m.class;
        j.normSpec = m.normSpec;
        j.tauBps = m.tauBps;
        j.minWords = m.minWords;
        j.maxWords = m.maxWords;
        j.fee = m.fee;
        j.auditBps = p.auditBps;
        j.committeeSize = p.committeeSize;
        j.noRevealSlashBps = p.noRevealSlashBps;
        j.slashToFinderBps = p.slashToFinderBps;
        j.commitWindow = p.commitWindow;
        j.drawWindow = p.drawWindow;
        j.revealWindow = p.revealWindow;
        j.challengeWindow = p.challengeWindow;
        j.committeeWindow = p.committeeWindow;
        j.protocolFee = p.protocolFee;
        j.reward = p.arbCostEst;
        j.challengeBond = uint128(uint256(m.fee) * p.challengeBondMultBps / 10_000);
        j.createdAt = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------- commit / draw / reveal
    function commit(bytes32 id, bytes32 c) external {
        Job storage j = _jobs[id];
        Seat storage s = _seats[id][msg.sender];
        if (c == bytes32(0)) revert BadArgs();
        if (block.timestamp > j.deadline) revert WindowClosed();
        Status st = j.status;
        if (st == Status.Assigned && msg.sender == j.executor) {
            s.commitment = c;
            emit Committed(id, msg.sender, s.role);
            _setStatus(id, j, Status.Committed, j.drawWindow);
        } else if (st == Status.VerifierCommit && msg.sender == j.verifier) {
            s.commitment = c;
            emit Committed(id, msg.sender, s.role);
            _setStatus(id, j, Status.Reveal, j.revealWindow);
        } else if (st == Status.CommitteeCommit && s.role == ROLE_MEMBER && s.bondHeld && s.commitment == 0) {
            s.commitment = c;
            emit Committed(id, msg.sender, s.role);
            if (++j.committed == _committee[id].length) _setStatus(id, j, Status.CommitteeReveal, j.revealWindow);
        } else {
            revert NotYourTurn();
        }
    }

    /// @notice Roll the audit AFTER the executor has committed. EOA-only, so a wrapper contract
    ///         cannot call this and revert until the job comes out unaudited (edge case 9).
    ///         Callable by anyone at any time while Committed (liveness does not depend on one party).
    function drawAudit(bytes32 id) external nonReentrant {
        if (msg.sender != tx.origin) revert OnlyEOA();
        Job storage j = _jobs[id];
        if (j.status != Status.Committed) revert BadStatus();
        (uint256 r, bool prng) = _rand(id);
        bool audited = r % 10_000 < j.auditBps;
        emit AuditDrawn(id, audited, prng);
        if (audited) {
            j.audited = true;
            if (_assignVerifier(id, j)) return;
            j.auditSkipped = true; // no eligible verifier left
        }
        _setStatus(id, j, Status.Reveal, j.revealWindow);
    }

    /// @notice Reveal a salted output commitment (outCommitFor). Committee members in a TOLERANCE job
    ///         use revealText instead. `commitSalt` is the operator's own blinding salt from `commit`.
    function reveal(bytes32 id, bytes32 outCommit, bytes32 commitSalt, string calldata evidenceRef) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status == Status.CommitteeReveal && j.cls == TOLERANCE) revert UseRevealText();
        _reveal(id, j, outCommit, commitSalt, evidenceRef);
    }

    /// @notice Committee reveal for TOLERANCE jobs: the text itself, so overlap can be computed.
    function revealText(bytes32 id, bytes calldata text, bytes32 jobSalt, bytes32 commitSalt, string calldata evidenceRef)
        external
        nonReentrant
    {
        Job storage j = _jobs[id];
        if (j.status != Status.CommitteeReveal) revert BadStatus();
        _checkSalt(j, jobSalt);
        _checkText(j, text);
        _reveal(id, j, outCommitFor(id, jobSalt, text), commitSalt, evidenceRef);
        _seats[id][msg.sender].textPosted = true;
    }

    function _reveal(bytes32 id, Job storage j, bytes32 outCommit, bytes32 commitSalt, string calldata ref) private {
        if (block.timestamp > j.deadline) revert WindowClosed();
        if (outCommit == bytes32(0)) revert EmptyOutput();
        if (bytes(ref).length > 256) revert BadArgs();
        Seat storage s = _seats[id][msg.sender];
        if (s.commitment == bytes32(0) || s.revealed) revert NotYourTurn();
        if (j.status == Status.Reveal) {
            if (msg.sender != j.executor && msg.sender != j.verifier) revert NotYourTurn();
        } else if (j.status != Status.CommitteeReveal || s.role != ROLE_MEMBER) {
            revert BadStatus();
        }
        if (commitmentFor(id, msg.sender, outCommit, commitSalt) != s.commitment) revert BadReveal();
        s.revealed = true;
        s.outCommit = outCommit;
        emit Revealed(id, msg.sender, s.role, outCommit, ref);
        if (j.status == Status.Reveal) {
            bool vDone = j.verifier == address(0) || _seats[id][j.verifier].revealed;
            if (_seats[id][j.executor].revealed && vDone) _afterReveals(id, j);
        } else {
            ++j.revealedCount;
        }
    }

    function _afterReveals(bytes32 id, Job storage j) private {
        if (j.verifier == address(0)) {
            _setStatus(id, j, Status.Challenge, j.challengeWindow);
            return;
        }
        bytes32 he = _seats[id][j.executor].outCommit;
        bytes32 hv = _seats[id][j.verifier].outCommit;
        if (he == hv) {
            emit Compared(id, true, 10_000);
            _settleAgreed(id, j);
        } else if (j.cls != TOLERANCE) {
            emit Compared(id, false, 0);
            _startCommittee(id, j);
        } else {
            _setStatus(id, j, Status.Text, j.revealWindow);
        }
    }

    // ---------------------------------------------------------------- tolerance text
    /// @notice Executor and verifier publish their normalized text (calldata) when commitments differ.
    ///         The job salt becomes public here: tolerance-class text is public by nature (add-on A1).
    function postText(bytes32 id, bytes calldata text, bytes32 jobSalt) external {
        Job storage j = _jobs[id];
        if (j.status != Status.Text) revert BadStatus();
        if (block.timestamp > j.deadline) revert WindowClosed();
        if (msg.sender != j.executor && msg.sender != j.verifier) revert NotYourTurn();
        Seat storage s = _seats[id][msg.sender];
        _checkSalt(j, jobSalt);
        _checkText(j, text);
        if (outCommitFor(id, jobSalt, text) != s.outCommit) revert BadText();
        s.textPosted = true;
        emit TextPosted(id, msg.sender);
    }

    /// @notice Anyone, once both texts are posted: overlap >= tau agrees, otherwise the committee re-runs.
    function compareTexts(bytes32 id, bytes calldata textE, bytes calldata textV, bytes32 jobSalt) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.Text) revert BadStatus();
        Seat storage se = _seats[id][j.executor];
        Seat storage sv = _seats[id][j.verifier];
        if (!se.textPosted || !sv.textPosted) revert TextMissing();
        _checkSalt(j, jobSalt);
        if (outCommitFor(id, jobSalt, textE) != se.outCommit || outCommitFor(id, jobSalt, textV) != sv.outCommit) revert BadText();
        uint256 ov = judge.overlap(textE, textV);
        bool agree = ov >= j.tauBps;
        emit Compared(id, agree, ov);
        if (agree) _settleAgreed(id, j);
        else _startCommittee(id, j);
    }

    function _checkSalt(Job storage j, bytes32 jobSalt) private view {
        if (keccak256(abi.encodePacked(jobSalt)) != j.saltCommit) revert BadSalt();
    }

    function _checkText(Job storage j, bytes calldata text) private view {
        uint256 w = judge.check(text, j.normSpec);
        if (w < j.minWords || w > j.maxWords) revert BadWordCount(w);
    }

    // ---------------------------------------------------------------- challenge / settle
    /// @notice Force an audit of an unaudited result during the challenge window.
    function challenge(bytes32 id) external payable nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.Challenge) revert BadStatus();
        if (block.timestamp > j.deadline) revert WindowClosed();
        if (msg.value != j.challengeBond) revert WrongValue(j.challengeBond);
        if (msg.sender == j.executor) revert NotYourTurn();
        j.challenged = true;
        j.challenger = msg.sender;
        j.audited = true;
        j.auditSkipped = false;
        j.redraws = 0;
        challengeEscrow += msg.value;
        emit Challenged(id, msg.sender, msg.value);
        if (!_assignVerifier(id, j)) revert NoCapacity();
    }

    function settle(bytes32 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.Challenge) revert BadStatus();
        if (block.timestamp <= j.deadline) revert TooEarly();
        _payExecutor(id, j);
        _close(id, j, Status.Settled);
    }

    // ---------------------------------------------------------------- timeouts
    /// @notice Resolve any stalled stage after its deadline (section 4.3 step 9).
    function expire(bytes32 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (block.timestamp <= j.deadline) revert TooEarly();
        Status st = j.status;
        if (st == Status.Assigned) {
            _penalizeSeat(id, j, j.executor, R_NO_COMMIT);
            _refund(id, j);
        } else if (st == Status.VerifierCommit) {
            _penalizeSeat(id, j, j.verifier, R_VERIFIER_NOSHOW);
            if (j.redraws == 0) {
                j.redraws = 1;
                if (_assignVerifier(id, j)) return;
            }
            j.verifier = address(0);
            if (j.challenged) {
                _skipAudit(id, j); // executor already revealed
            } else {
                j.auditSkipped = true;
                _setStatus(id, j, Status.Reveal, j.revealWindow);
            }
        } else if (st == Status.Reveal || st == Status.Text) {
            bool text = st == Status.Text;
            Seat storage se = _seats[id][j.executor];
            bool eOk = text ? se.textPosted : se.revealed;
            uint8 reason = text ? R_NO_TEXT : R_NO_REVEAL;
            if (!eOk) {
                _penalizeSeat(id, j, j.executor, reason);
                if (j.verifier != address(0)) {
                    Seat storage sv = _seats[id][j.verifier];
                    if (text ? sv.textPosted : sv.revealed) _reward(id, j, j.verifier, PAY_VERIFIER);
                    else _penalizeSeat(id, j, j.verifier, reason);
                }
                _refund(id, j);
            } else {
                _penalizeSeat(id, j, j.verifier, text ? R_NO_TEXT : R_VERIFIER_NOSHOW);
                _skipAudit(id, j);
            }
        } else if (st == Status.CommitteeCommit) {
            address[] storage c = _committee[id];
            for (uint256 i; i < c.length; ++i) {
                if (_seats[id][c[i]].commitment == bytes32(0)) _penalizeSeat(id, j, c[i], R_MEMBER_NOSHOW);
            }
            if (j.committed == 0) _inconclusive(id, j, 0, 0, 0);
            else _setStatus(id, j, Status.CommitteeReveal, j.revealWindow);
        } else {
            revert BadStatus();
        }
    }

    // ---------------------------------------------------------------- committee
    function _startCommittee(bytes32 id, Job storage j) private {
        address[] storage c = _committee[id];
        for (uint256 i; i < j.committeeSize; ++i) {
            address a = _draw(id, j.bond, _exclusions(id, j));
            if (a == address(0)) break;
            _lockSeat(id, a, j.bond, ROLE_MEMBER);
            c.push(a);
        }
        if (c.length == 0) {
            _inconclusive(id, j, 0, 0, 0);
            return;
        }
        emit CommitteeDrawn(id, c);
        _setStatus(id, j, Status.CommitteeCommit, j.committeeWindow);
    }

    /// @notice Majority of the committee decides (section 8.3). For TOLERANCE jobs pass every text:
    ///         texts[0] = executor, texts[1] = verifier, texts[2+i] = member i (ignored if not revealed).
    function resolve(bytes32 id, bytes[] calldata texts, bytes32 jobSalt) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.CommitteeReveal) revert BadStatus();
        if (j.revealedCount < j.committed && block.timestamp <= j.deadline) revert TooEarly();
        if (j.cls == TOLERANCE) _checkSalt(j, jobSalt);
        Tally memory t = _tally(id, j, texts, jobSalt);
        uint256 thr = uint256(j.committeeSize) / 2 + 1;
        bool eOk = t.cE >= thr;
        bool vOk = t.cV >= thr;
        if (eOk && !vOk) {
            emit Resolved(id, OUT_VERIFIER_WRONG, t.cE, t.cV, t.r);
            uint256 amt = _slashSeat(id, j, j.verifier, R_WRONG);
            _splitFinder(id, j, amt, t.maskE, t.cE);
            _forfeitChallenge(id, j);
            _payExecutor(id, j);
            _rewardMembers(id, j, t.maskE);
            _close(id, j, Status.Settled);
        } else if (vOk && !eOk) {
            emit Resolved(id, OUT_EXECUTOR_WRONG, t.cE, t.cV, t.r);
            uint256 amt = _slashSeat(id, j, j.executor, R_WRONG);
            uint256 finder = amt * j.slashToFinderBps / 10_000;
            _credit(id, j.challenged ? j.challenger : j.verifier, finder, PAY_FINDER);
            slashPool += amt - finder;
            _returnChallenge(id, j);
            _reward(id, j, j.verifier, PAY_VERIFIER);
            _rewardMembers(id, j, t.maskV);
            _refund(id, j);
        } else if (eOk && vOk) {
            emit Resolved(id, OUT_BOTH_CONSISTENT, t.cE, t.cV, t.r);
            _forfeitChallenge(id, j);
            _payExecutor(id, j);
            _reward(id, j, j.verifier, PAY_VERIFIER);
            _rewardMembers(id, j, t.maskE | t.maskV);
            _close(id, j, Status.Settled);
        } else {
            _inconclusive(id, j, t.cE, t.cV, t.r);
        }
    }

    struct Tally {
        uint256 cE;
        uint256 cV;
        uint256 r;
        uint256 maskE;
        uint256 maskV;
    }

    function _tally(bytes32 id, Job storage j, bytes[] calldata texts, bytes32 jobSalt) private returns (Tally memory t) {
        address[] memory c = _committee[id];
        bool tol = j.cls == TOLERANCE;
        if (
            tol
                && (
                    texts.length != 2 + c.length || outCommitFor(id, jobSalt, texts[0]) != _seats[id][j.executor].outCommit
                        || outCommitFor(id, jobSalt, texts[1]) != _seats[id][j.verifier].outCommit
                )
        ) revert BadText();
        for (uint256 i; i < c.length; ++i) {
            Seat storage s = _seats[id][c[i]];
            if (!s.revealed) {
                _penalizeSeat(id, j, c[i], R_MEMBER_NOSHOW);
                continue;
            }
            ++t.r;
            (bool aE, bool aV) = _consistent(id, j, s.outCommit, texts, i, jobSalt);
            if (aE) {
                ++t.cE;
                t.maskE |= 1 << i;
            }
            if (aV) {
                ++t.cV;
                t.maskV |= 1 << i;
            }
            // EXACT class: honest runs are bit-exact, so a member matching neither side loses its bond
            if (!aE && !aV && !tol) slashPool += _slashSeat(id, j, c[i], R_MEMBER_MISMATCH);
        }
    }

    function _consistent(bytes32 id, Job storage j, bytes32 h, bytes[] calldata texts, uint256 i, bytes32 jobSalt)
        private
        view
        returns (bool aE, bool aV)
    {
        aE = h == _seats[id][j.executor].outCommit;
        aV = h == _seats[id][j.verifier].outCommit;
        if (j.cls == TOLERANCE) {
            if (outCommitFor(id, jobSalt, texts[2 + i]) != h) revert BadText();
            if (!aE) aE = judge.overlap(texts[2 + i], texts[0]) >= j.tauBps;
            if (!aV) aV = judge.overlap(texts[2 + i], texts[1]) >= j.tauBps;
        }
    }

    function _splitFinder(bytes32 id, Job storage j, uint256 amt, uint256 mask, uint256 n) private {
        uint256 finder = amt * j.slashToFinderBps / 10_000;
        uint256 per = n == 0 ? 0 : finder / n;
        address[] storage c = _committee[id];
        uint256 paid;
        for (uint256 i; i < c.length; ++i) {
            if ((mask >> i) & 1 == 1) {
                _credit(id, c[i], per, PAY_FINDER);
                paid += per;
            }
        }
        slashPool += amt - paid;
    }

    function _rewardMembers(bytes32 id, Job storage j, uint256 mask) private {
        address[] storage c = _committee[id];
        for (uint256 i; i < c.length; ++i) {
            if ((mask >> i) & 1 == 1) _reward(id, j, c[i], PAY_MEMBER);
        }
    }

    function _inconclusive(bytes32 id, Job storage j, uint256 cE, uint256 cV, uint256 r) private {
        emit Resolved(id, OUT_INCONCLUSIVE, cE, cV, r);
        _returnChallenge(id, j);
        _refund(id, j);
    }

    // ---------------------------------------------------------------- money helpers
    function _settleAgreed(bytes32 id, Job storage j) private {
        _payExecutor(id, j);
        _reward(id, j, j.verifier, PAY_VERIFIER);
        _forfeitChallenge(id, j);
        _close(id, j, Status.Settled);
    }

    function _skipAudit(bytes32 id, Job storage j) private {
        j.auditSkipped = true;
        _returnChallenge(id, j);
        _payExecutor(id, j);
        _close(id, j, Status.Settled);
    }

    function _payExecutor(bytes32 id, Job storage j) private {
        escrow -= uint256(j.fee) + j.protocolFee + j.auditFee;
        _credit(id, j.executor, j.fee, PAY_FEE);
        treasury += j.protocolFee;
        auditPool += j.auditFee;
    }

    /// @dev verifier / committee reward from the audit pool, capped by what the pool holds
    function _reward(bytes32 id, Job storage j, address to, uint8 kind) private {
        uint256 r = j.reward < auditPool ? j.reward : auditPool;
        auditPool -= r;
        _credit(id, to, r, kind);
    }

    function _forfeitChallenge(bytes32 id, Job storage j) private {
        uint256 cb = j.challenged ? j.challengeBond : 0;
        if (cb == 0) return;
        j.challengeBond = 0;
        challengeEscrow -= cb;
        uint256 half = cb / 2;
        _credit(id, j.executor, half, PAY_CHALLENGE_FORFEIT);
        slashPool += cb - half;
    }

    function _returnChallenge(bytes32 id, Job storage j) private {
        uint256 cb = j.challenged ? j.challengeBond : 0;
        if (cb == 0) return;
        j.challengeBond = 0;
        challengeEscrow -= cb;
        _credit(id, j.challenger, cb, PAY_CHALLENGE_REFUND);
    }

    function _credit(bytes32 id, address to, uint256 amt, uint8 kind) private {
        if (amt == 0) return;
        credits[to] += amt;
        creditsTotal += amt;
        emit Paid(id, to, amt, kind);
    }

    /// @dev refund the full price; push with a bounded stipend, fall back to credits (edge case 17)
    function _refund(bytes32 id, Job storage j) private {
        uint256 amt = uint256(j.fee) + j.protocolFee + j.auditFee;
        escrow -= amt;
        _close(id, j, Status.Refunded);
        (bool ok,) = j.buyer.call{value: amt, gas: PUSH_GAS}("");
        if (!ok) {
            credits[j.buyer] += amt;
            creditsTotal += amt;
        }
        emit JobRefunded(id, j.buyer, amt, ok);
    }

    /// @dev final state: release every bond still held, record the outcome
    function _close(bytes32 id, Job storage j, Status st) private {
        _releaseSeat(id, j, j.executor);
        if (j.verifier != address(0)) _releaseSeat(id, j, j.verifier);
        address[] storage c = _committee[id];
        for (uint256 i; i < c.length; ++i) {
            _releaseSeat(id, j, c[i]);
        }
        j.status = st;
        emit StatusChanged(id, st, 0);
        if (st == Status.Settled) emit JobSettled(id, j.audited && !j.auditSkipped, j.auditSkipped);
    }

    function _send(address to, uint256 amt) private {
        if (amt == 0) return;
        (bool ok,) = to.call{value: amt}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- bonds
    function _lockSeat(bytes32 id, address a, uint256 amt, uint8 role) private {
        Operator storage o = operators[a];
        o.free -= uint128(amt);
        o.locked += uint128(amt);
        totalFree -= amt;
        totalLocked += amt;
        Seat storage s = _seats[id][a];
        s.role = role;
        s.bondHeld = true;
    }

    function _unlock(bytes32 id, Job storage j, address a) private returns (bool) {
        Seat storage s = _seats[id][a];
        if (!s.bondHeld) return false;
        s.bondHeld = false;
        Operator storage o = operators[a];
        o.locked -= j.bond;
        totalLocked -= j.bond;
        return true;
    }

    function _releaseSeat(bytes32 id, Job storage j, address a) private {
        if (!_unlock(id, j, a)) return;
        operators[a].free += j.bond;
        totalFree += j.bond;
    }

    /// @dev no-show penalty: noRevealSlashBps of the bond to slashPool, the rest back to free stake
    function _penalizeSeat(bytes32 id, Job storage j, address a, uint8 reason) private {
        if (!_unlock(id, j, a)) return;
        uint256 amt = uint256(j.bond) * j.noRevealSlashBps / 10_000;
        operators[a].free += uint128(j.bond - amt);
        totalFree += j.bond - amt;
        slashPool += amt;
        emit Slashed(id, a, amt, reason);
    }

    /// @dev full bond slash; the caller routes the returned amount
    function _slashSeat(bytes32 id, Job storage j, address a, uint8 reason) private returns (uint256) {
        if (!_unlock(id, j, a)) return 0;
        emit Slashed(id, a, j.bond, reason);
        return j.bond;
    }

    // ---------------------------------------------------------------- draws
    function _assignVerifier(bytes32 id, Job storage j) private returns (bool) {
        address v = _draw(id, j.bond, _exclusions(id, j));
        if (v == address(0)) return false;
        j.verifier = v;
        _lockSeat(id, v, j.bond, ROLE_VERIFIER);
        emit VerifierAssigned(id, v);
        _setStatus(id, j, Status.VerifierCommit, j.commitWindow);
        return true;
    }

    function _exclusions(bytes32 id, Job storage j) private view returns (address[] memory ex) {
        address[] storage c = _committee[id];
        ex = new address[](3 + c.length);
        ex[0] = j.executor;
        ex[1] = j.verifier;
        ex[2] = j.challenger;
        for (uint256 i; i < c.length; ++i) {
            ex[3 + i] = c[i];
        }
    }

    function _eligible(address a, uint256 bond, address[] memory ex) private view returns (bool) {
        Operator storage o = operators[a];
        if (!o.registered || o.free < bond) return false;
        for (uint256 k; k < ex.length; ++k) {
            if (ex[k] == a) return false;
        }
        return true;
    }

    /// @dev stake-weighted (by free stake) draw among eligible operators; address(0) if none
    function _draw(bytes32 id, uint256 bond, address[] memory ex) private returns (address) {
        uint256 n = operatorList.length;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            address a = operatorList[i];
            if (_eligible(a, bond, ex)) total += operators[a].free;
        }
        if (total == 0) return address(0);
        (uint256 r,) = _rand(id);
        r %= total;
        for (uint256 i; i < n; ++i) {
            address a = operatorList[i];
            if (!_eligible(a, bond, ex)) continue;
            uint256 w = operators[a].free;
            if (r < w) return a;
            r -= w;
        }
        return address(0);
    }

    /// @dev Hedera PRNG precompile (0x169). If it is unavailable (e.g. a local EVM) fall back to
    ///      prevrandao + blockhash, which is weaker; `prng` reports which source was used (edge case 20).
    function _rand(bytes32 id) private returns (uint256 r, bool prng) {
        (bool ok, bytes memory out) = PRNG.call(abi.encodeWithSignature("getPseudorandomSeed()"));
        bytes32 seed;
        if (ok && out.length >= 32) {
            seed = abi.decode(out, (bytes32));
            prng = true;
        } else {
            seed = keccak256(abi.encode(block.prevrandao, blockhash(block.number - 1)));
        }
        r = uint256(keccak256(abi.encode(seed, id, ++_nonce, address(this))));
    }

    function _setStatus(bytes32 id, Job storage j, Status st, uint32 window) private {
        j.status = st;
        j.deadline = uint64(block.timestamp + window);
        emit StatusChanged(id, st, j.deadline);
    }

    // ---------------------------------------------------------------- views
    /// @notice the operator's blinded commitment to its outCommit
    function commitmentFor(bytes32 id, address who, bytes32 outCommit, bytes32 commitSalt) public view returns (bytes32) {
        return keccak256(abi.encode(COMMIT_DOMAIN, block.chainid, address(this), id, who, outCommit, commitSalt));
    }

    /// @notice salted output commitment (add-on A1): without jobSalt nobody can test a guessed text against it
    function outCommitFor(bytes32 id, bytes32 jobSalt, bytes calldata text) public view returns (bytes32) {
        return keccak256(abi.encode(OUT_DOMAIN, block.chainid, address(this), id, jobSalt, text));
    }

    function getParams() external view returns (Params memory) {
        return params;
    }

    function getJob(bytes32 id) external view returns (Job memory) {
        return _jobs[id];
    }

    function seat(bytes32 id, address who) external view returns (Seat memory) {
        return _seats[id][who];
    }

    function committeeOf(bytes32 id) external view returns (address[] memory) {
        return _committee[id];
    }

    function operatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    function eligibleCount(uint256 bond) public view returns (uint256 count) {
        uint256 n = operatorList.length;
        for (uint256 i; i < n; ++i) {
            Operator storage o = operators[operatorList[i]];
            if (o.registered && o.free >= bond) ++count;
        }
    }

    /// @notice Sum of every liability; equals the contract balance (conservation invariant).
    function accounted() external view returns (uint256) {
        return totalFree + totalLocked + escrow + creditsTotal + auditPool + slashPool + treasury + challengeEscrow;
    }
}
