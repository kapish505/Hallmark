/**
 * HBAR units. Inside Solidity on Hedera, msg.value and balances are TINYBAR.
 * On the JSON-RPC wire (ethers `value`, eth_getBalance) the relay uses WEIBAR = tinybar * 1e10.
 * Convert only at the wire boundary, and never truncate (E26).
 */
export const TINYBAR_PER_HBAR = 100_000_000n;
export const WEIBAR_PER_TINYBAR = 10_000_000_000n;

export class UnitError extends Error {}

export function tinybarToWeibar(tinybar: bigint): bigint {
  if (tinybar < 0n) throw new UnitError(`negative amount: ${tinybar}`);
  return tinybar * WEIBAR_PER_TINYBAR;
}

/** Throws if `weibar` is not a whole number of tinybar. */
export function weibarToTinybar(weibar: bigint): bigint {
  if (weibar < 0n) throw new UnitError(`negative amount: ${weibar}`);
  if (weibar % WEIBAR_PER_TINYBAR !== 0n) {
    throw new UnitError(`${weibar} weibar is not a whole number of tinybar`);
  }
  return weibar / WEIBAR_PER_TINYBAR;
}

/** Exact decimal HBAR string ("1.5") -> tinybar. Throws on more than 8 decimals. */
export function hbarToTinybar(hbar: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(hbar.trim());
  if (!m) throw new UnitError(`not a decimal HBAR amount: "${hbar}"`);
  const frac = m[2] ?? "";
  if (frac.length > 8) throw new UnitError(`"${hbar}" has more than 8 decimals (finer than 1 tinybar)`);
  return BigInt(m[1]) * TINYBAR_PER_HBAR + BigInt(frac.padEnd(8, "0") || "0");
}

export function formatHbar(tinybar: bigint): string {
  const neg = tinybar < 0n;
  const t = neg ? -tinybar : tinybar;
  const whole = t / TINYBAR_PER_HBAR;
  const frac = (t % TINYBAR_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""} HBAR`;
}

/**
 * Value units the chain uses on the wire. Hedera relay: weibar. A plain EVM (local anvil): the
 * contract amount is the wire amount, so the identity is used.
 */
export type WireUnits = "hedera" | "evm";
export function toWire(tinybar: bigint, units: WireUnits): bigint {
  return units === "hedera" ? tinybarToWeibar(tinybar) : tinybar;
}
export function fromWire(wire: bigint, units: WireUnits): bigint {
  return units === "hedera" ? weibarToTinybar(wire) : wire;
}
export function wireUnitsForChain(chainId: number): WireUnits {
  return chainId === 295 || chainId === 296 || chainId === 297 ? "hedera" : "evm";
}
