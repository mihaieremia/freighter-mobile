import { SwapPathResult } from "ducks/swap";
import { SwapQuoteSource } from "services/backend";

/**
 * An aggregator transaction expires and its simulation ages, so a quote older
 * than this is refreshed when the review sheet opens.
 */
export const AGGREGATOR_QUOTE_MAX_AGE_MS = 20_000;

/** Sources whose executable quote is an unsigned Soroban envelope. */
export const isAggregatorQuoteSource = (source: SwapQuoteSource): boolean =>
  source === SwapQuoteSource.XOXNO || source === SwapQuoteSource.LIFI;

/** Aggregator quotes go stale; classic ones are built at review time and do not. */
export const isStaleAggregatorQuote = (pathResult: SwapPathResult): boolean =>
  isAggregatorQuoteSource(pathResult.source) &&
  !pathResult.requiresTrustlineFirst &&
  (Date.now() - pathResult.quotedAt > AGGREGATOR_QUOTE_MAX_AGE_MS ||
    !pathResult.aggregatorTransaction?.feeStroops ||
    !pathResult.aggregatorTransaction?.resourceFeeStroops ||
    !Number.isSafeInteger(pathResult.aggregatorTransaction?.expiresAt) ||
    (pathResult.aggregatorTransaction?.expiresAt ?? 0) <=
      Date.now() / 1000 + 20);
