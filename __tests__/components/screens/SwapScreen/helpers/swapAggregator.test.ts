/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  buildAggregatorExpectation,
  isStaleAggregatorQuote,
} from "components/screens/SwapScreen/helpers";
import { AGGREGATOR_QUOTE_MAX_AGE_MS } from "components/screens/SwapScreen/helpers/swapAggregator";
import { NETWORKS } from "config/constants";
import { SwapPathResult } from "ducks/swap";
import { SwapQuoteSource } from "services/backend";

import {
  CONTRACT,
  SENDER,
  USDC_SAC,
  XLM_SAC,
  soroban,
  usdc,
  xlm,
} from "../../../../../__mocks__/swapFixtures";

const path = (over: Partial<SwapPathResult> = {}): SwapPathResult => ({
  sourceAmount: "10",
  destinationAmount: "2.3",
  destinationAmountMin: "2.277",
  path: [],
  conversionRate: "0.23",
  source: SwapQuoteSource.XOXNO,
  quotedAt: 1_000,
  ...over,
});

describe("buildAggregatorExpectation", () => {
  const base = { network: NETWORKS.PUBLIC, sender: SENDER, sourceAmount: "10" };

  it("expects a classic pair as Stellar Asset Contracts in stroops", () => {
    expect(
      buildAggregatorExpectation({
        ...base,
        sourceBalance: xlm,
        destinationBalance: usdc,
        pathResult: path(),
      }),
    ).toEqual({
      network: NETWORKS.PUBLIC,
      source: SwapQuoteSource.XOXNO,
      sender: SENDER,
      sourceToken: XLM_SAC,
      destinationToken: USDC_SAC,
      sourceAmount: 100000000n,
      minDestinationAmount: 22770000n,
    });
  });

  it("expects a bought Soroban token by its own contract and in its own atoms", () => {
    const expectation = buildAggregatorExpectation({
      ...base,
      sourceBalance: xlm,
      destinationBalance: soroban(18),
      pathResult: path({
        destinationAmountMin: "22.248129322452320083",
      }),
    });

    expect(expectation.destinationToken).toBe(CONTRACT);
    expect(expectation.minDestinationAmount).toBe(22248129322452320083n);
    expect(expectation.sourceAmount).toBe(100000000n);
  });

  it("expects a sold Soroban token by its own contract and decimals", () => {
    const expectation = buildAggregatorExpectation({
      ...base,
      sourceAmount: "2.5",
      sourceBalance: soroban(18),
      destinationBalance: xlm,
      pathResult: path(),
    });

    expect(expectation.sourceToken).toBe(CONTRACT);
    expect(expectation.sourceAmount).toBe(2500000000000000000n);
  });
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
});
