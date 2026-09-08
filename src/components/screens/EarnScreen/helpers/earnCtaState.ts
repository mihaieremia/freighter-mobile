import BigNumber from "bignumber.js";

/**
 * Pure CTA state machine for the deposit amount screen. Precedence matters:
 * each guard short-circuits, so the label reflects the most specific blocker.
 */
export type EarnCtaLabelKey = "enter" | "insufficient" | "review";

export interface EarnCtaInputs {
  /** Spendable balance of the deposit asset, net of reserve and fee. */
  availableBalanceIsZero: boolean;
  amountIsZero: boolean;
  isAmountTooHigh: boolean;
}

export const getEarnCtaState = ({
  availableBalanceIsZero,
  amountIsZero,
  isAmountTooHigh,
}: EarnCtaInputs): { disabled: boolean; labelKey: EarnCtaLabelKey } => {
  // Nothing enterable is valid with zero spendable balance, so surface the
  // blocker directly rather than inviting an amount that cannot work.
  if (availableBalanceIsZero) {
    return { disabled: true, labelKey: "insufficient" };
  }
  if (amountIsZero) {
    return { disabled: true, labelKey: "enter" };
  }
  if (isAmountTooHigh) {
    return { disabled: true, labelKey: "insufficient" };
  }
  return { disabled: false, labelKey: "review" };
};

/**
 * Does the account lack the XLM to pay this transaction's fee?
 *
 * A Soroban invoke's fee is XLM-only and no trustline is involved, so this is
 * simply "spendable XLM < fee".
 *
 * Order this AFTER the CTA's insufficient-funds check: when the deposit asset
 * IS XLM, an unaffordable amount should read as insufficient funds on the
 * button, and this sheet should only fire for an otherwise-affordable amount
 * that leaves no fee headroom.
 */
export const needsXlmForFee = ({
  spendableXlm,
  fee,
}: {
  spendableXlm: string;
  fee: string;
}) => new BigNumber(spendableXlm).lt(new BigNumber(fee));

/**
 * Does a failed simulation read as "this account cannot cover the transfer"?
 *
 * Deliberately narrow: the Stellar Asset Contract's BalanceError (contract
 * error #10) and the classic insufficient-balance result code are the only
 * signals that mean the amount itself is the problem. Everything else —
 * supply caps, a frozen hub, a stale oracle — must keep surfacing the hub's
 * own message.
 */
export const isInsufficientBalanceFailure = (message: string): boolean =>
  /Error\(Contract, #10\)|insufficient[ _]balance/i.test(message);
