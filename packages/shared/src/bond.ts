/**
 * Bond math. Must match contracts/src/libs/BondMath.sol.
 *   deterrence: B >= c / (p * pi) - F      fairness: B <= m / (p * fp)
 * All amounts tinybar (bigint); rates in basis points.
 */
export const NO_CEILING = (1n << 256n) - 1n;

export const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function deterrenceBond(c: bigint, fee: bigint, auditBps: number, piBps: number, minBond: bigint): bigint {
  if (auditBps <= 0 || piBps <= 0) throw new Error("auditBps and piBps must be > 0");
  const need = ceilDiv(c * 100_000_000n, BigInt(auditBps) * BigInt(piBps));
  const b = need > fee ? need - fee : 0n;
  return b > minBond ? b : minBond;
}

export function fairnessCeiling(margin: bigint, auditBps: number, fpBps: number): bigint {
  if (fpBps === 0) return NO_CEILING;
  return (margin * 100_000_000n) / (BigInt(auditBps) * BigInt(fpBps));
}

export const auditFee = (auditBps: number, arbCostEst: bigint) => ceilDiv(BigInt(auditBps) * arbCostEst, 10_000n);

export interface Cheat {
  name: string;
  /** compute saved by this cheat, tinybar */
  c: bigint;
  /** measured catch rate of this cheat, bps */
  piBps: number;
}

export interface WindowInput {
  fee: bigint;
  margin: bigint;
  fpBps: number;
  auditBps: number;
  minBond: bigint;
  cheats: Cheat[];
}

/** Worst-cheat window: the floor is the max over cheats of c'/(p*pi') - F (section 3). */
export function bondWindow(w: WindowInput) {
  if (!w.cheats.length) throw new Error("no cheats measured");
  let worst = w.cheats[0];
  let floor = 0n;
  for (const ch of w.cheats) {
    const b = deterrenceBond(ch.c, w.fee, w.auditBps, ch.piBps, w.minBond);
    if (b >= floor) {
      floor = b;
      worst = ch;
    }
  }
  const ceiling = fairnessCeiling(w.margin, w.auditBps, w.fpBps);
  return { floor, ceiling, worst, empty: floor > ceiling, costMultiplier: 1 + w.auditBps / 10_000 };
}
