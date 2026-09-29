import BigNumber from "bignumber.js";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { PricedBalance } from "config/types";
import { SwapPathResult } from "ducks/swap";
import { AggregatorSwapExpectation } from "helpers/aggregatorSwap";
import { getBalanceDecimals } from "helpers/formatAmount";
import { swapContractId } from "helpers/swapAssets";
import { SwapQuoteSource } from "services/backend";

/**
 * An aggregator transaction expires and its simulation ages, so a quote older
 * than this is refreshed when the review sheet opens.
 */
export const AGGREGATOR_QUOTE_MAX_AGE_MS = 20_000;

const toAtoms = (amount: string, decimals: number): bigint =>
  BigInt(new BigNumber(amount).shiftedBy(decimals).toFixed(0));

/**
 * What the user asked for, in the terms the aggregator transaction is checked
 * against. Tokens are identified by their contract (a classic asset by its Stellar
 * Asset Contract) and amounts are in each token's own atoms.
 */
export const buildAggregatorExpectation = ({
  network,
  sender,
  sourceBalance,
  destinationBalance,
  sourceAmount,
  pathResult,
}: {
  network: NETWORKS;
  sender: string;
  sourceBalance: PricedBalance;
  destinationBalance: PricedBalance;
  sourceAmount: string;
  pathResult: SwapPathResult;
}): AggregatorSwapExpectation => {
  const { networkPassphrase } = mapNetworkToNetworkDetails(network);

  return {
    network,
    source: pathResult.source,
    sender,
    sourceToken: swapContractId(sourceBalance, networkPassphrase),
    destinationToken: swapContractId(destinationBalance, networkPassphrase),
    sourceAmount: toAtoms(sourceAmount, getBalanceDecimals(sourceBalance)),
    minDestinationAmount: toAtoms(
      pathResult.destinationAmountMin,
      getBalanceDecimals(destinationBalance),
    ),
  };
};

/** Sources whose executable quote is an unsigned Soroban envelope. */
export const isAggregatorQuoteSource = (source: SwapQuoteSource): boolean =>
  source === SwapQuoteSource.XOXNO || source === SwapQuoteSource.LIFI;

/** Aggregator quotes go stale; classic ones are built at review time and do not. */
export const isStaleAggregatorQuote = (pathResult: SwapPathResult): boolean =>
  isAggregatorQuoteSource(pathResult.source) &&
  !pathResult.requiresTrustlineFirst &&
  Date.now() - pathResult.quotedAt > AGGREGATOR_QUOTE_MAX_AGE_MS;
