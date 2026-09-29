/* eslint-disable @fnando/consistent-import/consistent-import */
import { renderHook } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { useReviewTokens } from "components/screens/SwapScreen/hooks/useReviewTokens";
import { NETWORKS } from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { useTokenCatalogStore } from "ducks/tokenCatalog";

import { CONTRACT } from "../../../../../__mocks__/swapFixtures";
import {
  catalogSoroban,
  seedCatalog,
} from "../../../../../__mocks__/tokenCatalog";

let mockStorePrices: Record<string, unknown> = {};

jest.mock("ducks/auth", () => ({
  useAuthenticationStore: (selector: (s: { network: string }) => unknown) =>
    selector({ network: "PUBLIC" }),
}));
jest.mock("ducks/prices", () => ({
  usePricesForNetwork: () => mockStorePrices,
}));

const descriptor = (priceUsd?: number) => ({
  id: `deJTRSY:${CONTRACT}`,
  tokenCode: "deJTRSY",
  issuer: CONTRACT,
  decimals: 18,
  tokenType: TokenTypeWithCustomToken.CUSTOM_TOKEN,
  requiresTrustline: false,
  priceUsd,
});

const render = (priceUsd?: number, overrides: Record<string, unknown> = {}) =>
  renderHook(() =>
    useReviewTokens({
      balanceItems: [],
      sourceTokenId: "",
      sourceAmount: "10",
      destinationAmount: "5",
      destinationTokenDescriptor: descriptor(priceUsd),
      pathResult: null,
      ...overrides,
    } as never),
  );

describe("useReviewTokens — a bought Soroban token the wallet does not hold", () => {
  beforeEach(() => {
    mockStorePrices = {};
  });

  it("builds the token from the descriptor, with the contract in the issuer's place", () => {
    const { result } = render(1.02);

    expect(result.current.destinationToken).toEqual({
      type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
      code: "deJTRSY",
      issuer: { key: CONTRACT },
    });
  });

  it("values it at the picker's price when the prices store has none", () => {
    const { result } = render(1.02);

    expect(result.current.destinationTokenFiatAmount).toBe("$5.10");
  });

  it("prefers a price the prices store does have", () => {
    mockStorePrices = {
      [`deJTRSY:${CONTRACT}`]: { currentPrice: 2 },
    };

    const { result } = render(1.02);

    expect(result.current.destinationTokenFiatAmount).toBe("$10.00");
  });

  it("shows no value when nothing prices it", () => {
    const { result } = render(undefined);

    expect(result.current.destinationTokenFiatAmount).toBe("--");
  });
});

describe("useReviewTokens — a token only the XOXNO catalog prices", () => {
  beforeEach(() => {
    mockStorePrices = {};
    useTokenCatalogStore.setState({ byNetwork: {} });
  });

  it("values a 9-decimal destination at the catalog's price", () => {
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);

    const { result } = render(undefined, { destinationAmount: "0.123456789" });

    expect(result.current.destinationTokenFiatAmount).toBe("$518.52");
  });

  it("prefers the prices store, then the picker's price, over the catalog", () => {
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
    mockStorePrices = {
      [`deJTRSY:${CONTRACT}`]: { currentPrice: new BigNumber(2) },
    };

    expect(render(1.02).result.current.destinationTokenFiatAmount).toBe(
      "$10.00",
    );

    mockStorePrices = {};

    expect(render(1.02).result.current.destinationTokenFiatAmount).toBe(
      "$5.10",
    );
  });

  it("values a held source the balances leave unpriced at the catalog's price", () => {
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
    const sourceId = `deJTRSY:${CONTRACT}`;

    const { result } = render(undefined, {
      balanceItems: [
        {
          id: sourceId,
          token: {
            type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
            code: "deJTRSY",
            issuer: { key: CONTRACT },
          },
        },
      ],
      sourceTokenId: sourceId,
      sourceAmount: "2",
      destinationAmount: "0",
      destinationTokenDescriptor: null,
    });

    expect(result.current.sourceTokenFiatAmount).toBe("$8,400.00");
  });
});
