import BigNumber from "bignumber.js";
import { DestinationTokenDescriptor } from "components/screens/SwapScreen/helpers/types";
import { NATIVE_TOKEN_CODE } from "config/constants";
import { PricedBalance, Token } from "config/types";
import {
  formatFiatInputDisplay,
  formatTokenForDisplay,
  getBalanceDecimalTotal,
} from "helpers/formatAmount";

/**
 * Sell-card secondary line.
 *
 * In token-input mode the user types a token amount, so the secondary line
 * shows the fiat equivalent. In fiat-input mode the user types a fiat
 * amount, so the secondary line shows the token equivalent ("0.123 USDC").
 *
 * Pass the converter's RAW values (dot-notation), not the locale-
 * formatted *Display fields. formatTokenForDisplay constructs a
 * BigNumber internally and would coerce a comma-decimal string to
 * NaN — same trap formatFiatInputDisplay sidesteps because it
 * normalises "," to "." up front. Mirrors the Send flow's AmountCard
 * secondary-line wiring.
 */
export const buildSellSecondaryText = ({
  showFiatAmount,
  tokenAmount,
  sourceTokenSymbol,
  fiatAmountDisplay,
}: {
  showFiatAmount: boolean;
  tokenAmount: string;
  sourceTokenSymbol: string;
  fiatAmountDisplay: string;
}): string =>
  showFiatAmount
    ? formatTokenForDisplay(tokenAmount || "0", sourceTokenSymbol)
    : formatFiatInputDisplay(fiatAmountDisplay || "0");

/**
 * Pick the most-complete token shape we can hand to AmountCard's picker chip:
 * prefer the held PricedBalance, fall back to a synthetic Token built from the
 * descriptor (issuer = classic; no issuer = native XLM), and finally
 * undefined when the user hasn't picked anything yet.
 */
export const buildDestinationPickerToken = ({
  destinationBalance,
  destinationTokenDescriptor,
}: {
  destinationBalance: PricedBalance | undefined;
  destinationTokenDescriptor: DestinationTokenDescriptor | null;
}): PricedBalance | Token | undefined => {
  if (destinationBalance) return destinationBalance;
  if (destinationTokenDescriptor?.issuer) {
    return {
      type: destinationTokenDescriptor.tokenType,
      code: destinationTokenDescriptor.tokenCode,
      issuer: { key: destinationTokenDescriptor.issuer },
    } as Token;
  }
  if (destinationTokenDescriptor) {
    return { type: "native", code: NATIVE_TOKEN_CODE } as Token;
  }
  return undefined;
};

/**
 * Sell-card right-aligned available-balance text. Returns "" when no source
 * balance is selected so the caller can render null instead of an empty
 * label.
 *
 * `formatTokenForDisplay` already produces "<amount> <code>" — don't append
 * the code a second time (caused the "123.45 USDC USDC" double-code bug).
 * `spendableAmount` is already a decimal token amount, so it is formatted as
 * is; `formatBalanceAmount` would scale a Soroban token's amount by its
 * decimals a second time.
 * The trailing " available" suffix matches the Send card's wording for
 * cross-flow consistency; pass the resolved i18n string in via
 * `availableLabel` so this helper stays pure.
 */
export const buildSourceBalanceRight = ({
  sourceBalance,
  sourceTokenSymbol,
  spendableAmount,
  availableLabel,
}: {
  sourceBalance: PricedBalance | undefined;
  sourceTokenSymbol: string;
  spendableAmount: BigNumber | null;
  availableLabel: string;
}): string => {
  if (!sourceBalance) return "";
  const amount = spendableAmount ?? getBalanceDecimalTotal(sourceBalance);
  return `${formatTokenForDisplay(
    amount,
    sourceBalance.tokenCode ?? sourceTokenSymbol,
  )} ${availableLabel}`;
};
