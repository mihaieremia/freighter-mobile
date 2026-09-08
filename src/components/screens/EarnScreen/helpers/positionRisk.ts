import BigNumber from "bignumber.js";

/**
 * How close a position is to liquidation, as a percentage of its limit.
 *
 * The protocol reports a health factor: liquidation-threshold-weighted
 * collateral over debt, liquidated at 1. That is a ratio most people have to
 * be taught to read, and it moves the wrong way — smaller is worse. Inverting
 * it gives the share of the position's borrowing power already used, where
 * 100% is the liquidation point and bigger is worse, which is the direction
 * every other risk number in a wallet runs.
 *
 * Null for a position with no debt: nothing is being borrowed against, so
 * there is no liquidation to be near.
 */
export const liquidationRisk = (healthFactor: number | null): number | null => {
  if (
    healthFactor === null ||
    !Number.isFinite(healthFactor) ||
    healthFactor < 0
  )
    return null;
  return healthFactor === 0
    ? Infinity
    : new BigNumber(100).dividedBy(healthFactor).toNumber();
};

export type RiskLevel = "safe" | "caution" | "danger";

/**
 * Thresholds are deliberately conservative, because the number moves on its
 * own: prices and accrued interest push it up with no action from the holder,
 * so "fine right now" and "safe to leave alone" are not the same thing.
 *
 *   - danger  (>= 90%) — a modest price move liquidates this.
 *   - caution (>= 75%) — still solvent, but not somewhere to leave a position.
 *   - safe    (< 75%)  — room to absorb a move.
 */
export const riskLevel = (risk: number): RiskLevel => {
  if (risk >= 90) {
    return "danger";
  }
  return risk >= 75 ? "caution" : "safe";
};

/** Formats the risk share for display, e.g. `92.6%`. */
export const formatRisk = (risk: number): string =>
  risk === Infinity ? "∞%" : `${new BigNumber(risk).toFormat(1)}%`;
