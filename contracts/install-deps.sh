#!/usr/bin/env sh
# Pinned Solidity dependencies (not vendored in git).
set -e
cd "$(dirname "$0")"
forge install foundry-rs/forge-std@v1.9.4 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
