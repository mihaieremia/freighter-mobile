import BigNumber from "bignumber.js";

/**
 * What a percentage button commits, for any of the three Earn amounts.
 *
 * `PercentageButtons` reports whole percents — 25/50/75, and 100 for Max — so
 * the fraction is derived here. Rounds DOWN at the asset's precision, so Max
 * lands on the maximum rather than a hair above it.
 */
export const percentageOf = ({
  max,
  pct,
  decimals,
}: {
  max: BigNumber;
  pct: number;
  decimals: number;
}) =>
  max
    .multipliedBy(new BigNumber(pct).dividedBy(100))
    .decimalPlaces(decimals, BigNumber.ROUND_DOWN)
    .toFixed();

/**
 * How much of a debt-limited withdrawal bound the buttons actually offer.
 *
 * The bound holds exactly for the ledger it was read from: the debt grows with
 * its own index and the prices under it move, so an amount that just cleared
 * the contract's gates can be over them by the time the withdrawal executes.
 * Typing the bound exactly is still allowed; the simulation answers that.
 *
 * A leg with no debt behind it needs none of this: it exits through the
 * contract's own "withdraw everything" path, which is exact by construction.
 */
export const DEBT_LIMITED_MARGIN = 0.999;

/**
 * Paid on top of the debt on a full repayment.
 *
 * The debt accrues with its own index up to the executing ledger, so paying
 * the figure read here would leave dust behind. The pool refunds whatever the
 * payment does not consume, so the overpayment costs nothing.
 */
export const FULL_REPAY_MARGIN = new BigNumber("1.0001");

/**
 * XLM held back from an amount denominated in XLM, for the invoke's own fee.
 *
 * A XOXNO invoke is dominated by its resource fee — around 0.0546 XLM against
 * the live hub — and that figure is only known once simulation returns, which
 * is after the amount has to be chosen. Spending every spendable lumen on the
 * deposit or the debt therefore leaves nothing to pay the transaction carrying
 * it, and `assertEarnFeeAffordable` rejects the prepared review. Only an
 * amount in XLM can be short this way; for any other asset the fee comes out
 * of an untouched XLM balance.
 */
export const NATIVE_FEE_ALLOWANCE_XLM = new BigNumber("0.1");

/**
 * The amount a percentage button on the withdraw screen commits.
 *
 * A debt-limited bound is offered slightly short of itself; see
 * `DEBT_LIMITED_MARGIN`.
 */
export const getPercentageWithdrawAmount = ({
  available,
  pct,
  decimals,
  isLimitedByDebt,
}: {
  available: BigNumber;
  pct: number;
  decimals: number;
  isLimitedByDebt: boolean;
}) =>
  percentageOf({
    max: available.multipliedBy(isLimitedByDebt ? DEBT_LIMITED_MARGIN : 1),
    pct,
    decimals,
  });

/**
 * The amount a percentage button on the repay screen commits.
 *
 * 100% means "clear it": the margin goes out with the payment and comes
 * straight back, so the debt lands at zero instead of at dust. Anything less
 * is an ordinary part-payment. Neither may exceed what the wallet can spend.
 */
export const getPercentageRepayAmount = ({
  owed,
  spendable,
  pct,
  decimals,
  isNative,
}: {
  /** What the leg owes, in whole tokens. */
  owed: BigNumber;
  /** What the wallet can spend of the borrowed asset, in whole tokens. */
  spendable: BigNumber;
  pct: number;
  decimals: number;
  /** Is the borrowed asset XLM, which also has to pay the fee? */
  isNative: boolean;
}) => {
  const target =
    pct === 100
      ? owed
          .multipliedBy(FULL_REPAY_MARGIN)
          .decimalPlaces(decimals, BigNumber.ROUND_UP)
      : owed.multipliedBy(new BigNumber(pct).dividedBy(100));

  const affordable = isNative
    ? spendable.minus(NATIVE_FEE_ALLOWANCE_XLM)
    : spendable;

  return percentageOf({
    max: BigNumber.max(BigNumber.min(target, affordable), new BigNumber(0)),
    pct: 100,
    decimals,
  });
};

/**
 * The amount a percentage button on the deposit screen commits.
 */
export const getPercentageDepositAmount = ({
  maxDepositable,
  pct,
  decimals,
}: {
  maxDepositable: string;
  pct: number;
  decimals: number;
}) => percentageOf({ max: new BigNumber(maxDepositable), pct, decimals });
