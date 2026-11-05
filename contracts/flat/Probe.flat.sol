// SPDX-License-Identifier: MIT
pragma solidity =0.8.24;

// src/Probe.sol

/// @title Probe: Gate G2 measurements on Hedera (units, PRNG, tx.origin). Not part of the protocol.
contract Probe {
    uint256 public constructorValue;
    uint256 public lastValue;
    uint256 public lastBalance;
    bytes32 public lastSeed;
    bool public lastPrngOk;
    bool public lastIsOrigin;

    event Deposit(uint256 msgValue, uint256 balance);
    event Seed(bool ok, bytes32 seed, uint256 len);
    event Origin(address sender, address origin, bool equal);

    /// @dev Hedera: a payable constructor is expected to see msg.value == 0 (never fund here)
    constructor() payable {
        constructorValue = msg.value;
    }

    /// @notice expected: msg.value in TINYBAR here while the RPC `value` was WEIBAR
    function deposit() external payable {
        lastValue = msg.value;
        lastBalance = address(this).balance;
        emit Deposit(msg.value, address(this).balance);
    }

    /// @notice PRNG precompile 0x169, getPseudorandomSeed(): 32 bytes, new per transaction
    function seed() external returns (bytes32 s) {
        (bool ok, bytes memory out) = address(0x169).call(abi.encodeWithSignature("getPseudorandomSeed()"));
        if (ok && out.length >= 32) s = abi.decode(out, (bytes32));
        lastSeed = s;
        lastPrngOk = ok && out.length >= 32;
        emit Seed(ok, s, out.length);
    }

    /// @notice two seeds in one transaction (does the seed change within a tx?)
    function seedTwice() external returns (bytes32 a, bytes32 b) {
        a = this.seed();
        b = this.seed();
    }

    function origin() external returns (bool eq) {
        eq = msg.sender == tx.origin;
        lastIsOrigin = eq;
        emit Origin(msg.sender, tx.origin, eq);
    }

    function withdraw() external {
        (bool ok,) = msg.sender.call{value: address(this).balance}("");
        require(ok);
    }
}

/// @notice calls Probe.origin() from a contract: expected eq == false
contract ProbeWrapper {
    function callOrigin(Probe p) external returns (bool) {
        return p.origin();
    }
}
