/* eslint-disable @fnando/consistent-import/consistent-import */
import { isStaleAggregatorQuote } from "components/screens/SwapScreen/helpers";
import { AGGREGATOR_QUOTE_MAX_AGE_MS } from "components/screens/SwapScreen/helpers/swapAggregator";
import { SwapPathResult } from "ducks/swap";
import { SwapQuoteSource } from "services/backend";

const path = (over: Partial<SwapPathResult> = {}): SwapPathResult => ({
  sourceAmount: "10",
  destinationAmount: "2.3",
  destinationAmountMin: "2.277",
  path: [],
  conversionRate: "0.23",
  source: SwapQuoteSource.XOXNO,
  quotedAt: 1_000,
  aggregatorTransaction: {
    envelopeXdr: "xdr",
    feeStroops: "100",
    resourceFeeStroops: "0",
    expiresAt: Math.floor(Date.now() / 1000) + 180,
  },
  ...over,
});

describe("isStaleAggregatorQuote", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [
      "an aggregator quote past the limit",
      true,
      {},
      AGGREGATOR_QUOTE_MAX_AGE_MS + 1,
    ],
    [
      "an aggregator quote exactly at the limit",
      false,
      {},
      AGGREGATOR_QUOTE_MAX_AGE_MS,
    ],
    ["a fresh aggregator quote", false, {}, 5_000],
    ["an old LI.FI quote", true, { source: SwapQuoteSource.LIFI }, 60_000],
    [
      "a classic quote of any age",
      false,
      { source: SwapQuoteSource.HORIZON },
      60_000,
    ],
    [
      "an aggregator quote that only asks for the trustline",
      false,
      { requiresTrustlineFirst: true },
      60_000,
    ],
  ])("%s: stale is %s", (_name, isStale, over, ageMs) => {
    jest.setSystemTime(1_000 + ageMs);

    expect(isStaleAggregatorQuote(path(over))).toBe(isStale);
  });
  it.each(["feeStroops", "resourceFeeStroops"])(
    "refreshes a quote missing %s despite valid expiry",
    (field) => {
      jest.setSystemTime(1_000);
      const quote = path();
      if (!quote.aggregatorTransaction) throw new Error("Transaction missing");
      quote.aggregatorTransaction = {
        ...quote.aggregatorTransaction,
        [field]: undefined,
      };
      expect(isStaleAggregatorQuote(quote)).toBe(true);
    },
  );

  it("keeps a fresh quote with zero resource fee", () => {
    jest.setSystemTime(1_000);
    expect(isStaleAggregatorQuote(path())).toBe(false);
  });
});
