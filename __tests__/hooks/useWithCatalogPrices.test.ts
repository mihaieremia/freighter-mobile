/* eslint-disable @fnando/consistent-import/consistent-import */
import { renderHook } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { NETWORKS } from "config/constants";
import { useAuthenticationStore } from "ducks/auth";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { useWithCatalogPrices } from "hooks/useWithCatalogPrices";

import {
  CATALOG_SOROBAN_CONTRACT,
  catalogSoroban,
  catalogUnpriced,
  seedCatalog,
} from "../../__mocks__/tokenCatalog";

const XAUM_ID = `XAUM:${CATALOG_SOROBAN_CONTRACT}`;

describe("useWithCatalogPrices", () => {
  beforeEach(() => {
    useAuthenticationStore.setState({ network: NETWORKS.PUBLIC });
    useTokenCatalogStore.setState({ byNetwork: {} });
  });

  it("adds the catalog price of a token the map lacks", () => {
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);

    const { result } = renderHook(() => useWithCatalogPrices({}, [XAUM_ID]));

    expect(result.current[XAUM_ID].currentPrice?.toString()).toBe("4200");
  });

  it("fills a zero price but keeps the 24h change", () => {
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
    const change = new BigNumber("0.01");
    const prices = {
      [XAUM_ID]: {
        currentPrice: new BigNumber(0),
        percentagePriceChange24h: change,
      },
    };

    const { result } = renderHook(() =>
      useWithCatalogPrices(prices, [XAUM_ID]),
    );

    expect(result.current[XAUM_ID].currentPrice?.toString()).toBe("4200");
    expect(result.current[XAUM_ID].percentagePriceChange24h).toBe(change);
  });

  it.each([
    [
      "the map already prices the token",
      NETWORKS.PUBLIC,
      catalogSoroban,
      { [XAUM_ID]: { currentPrice: new BigNumber(1) } },
    ],
    [
      "the catalog lists the token at zero",
      NETWORKS.PUBLIC,
      catalogUnpriced,
      {},
    ],
    ["the catalog has not loaded", NETWORKS.PUBLIC, undefined, {}],
    ["the network is not mainnet", NETWORKS.TESTNET, catalogSoroban, {}],
  ])("returns the same map when %s", (_title, network, entry, prices) => {
    useAuthenticationStore.setState({ network });
    if (entry) seedCatalog(network, entry);

    const { result } = renderHook(() =>
      useWithCatalogPrices(prices, [XAUM_ID, undefined]),
    );

    expect(result.current).toBe(prices);
  });
});
