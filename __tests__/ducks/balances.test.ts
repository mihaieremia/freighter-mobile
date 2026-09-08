/* eslint-disable @fnando/consistent-import/consistent-import */
import { act, renderHook } from "@testing-library/react-hooks";
import { BigNumber } from "bignumber.js";
import { NETWORKS, STORAGE_KEYS } from "config/constants";
import {
  NativeBalance,
  ClassicBalance,
  TokenPricesMap,
  TokenTypeWithCustomToken,
  BalanceMap,
} from "config/types";
import { useBalancesStore } from "ducks/balances";
import { useHistoryStore } from "ducks/history";
import { usePricesStore } from "ducks/prices";
import { useRemoteConfigStore } from "ducks/remoteConfig";
import { fetchBalances, getAccountHistory } from "services/backend";
import { dataStorage } from "services/storage/storageFactory";

import { benignTokenScan } from "../../__mocks__/blockaid-response";

// Mock the fetchBalances service and usePricesStore
jest.mock("services/backend", () => ({
  fetchBalances: jest.fn(),
  getAccountHistory: jest.fn(),
}));

jest.mock("services/storage/storageFactory", () => ({
  dataStorage: {
    getItem: jest.fn(),
  },
}));

jest.mock("ducks/prices", () => ({
  usePricesStore: {
    getState: jest.fn().mockReturnValue({
      fetchPricesForBalances: jest.fn(),
      pricesByNetwork: {},
      sourceByNetwork: {},
      error: null,
      isLoading: false,
      lastUpdated: null,
    }),
  },
}));

jest.mock("services/blockaid/api", () => ({
  scanBulkTokens: jest.fn(),
}));

describe("balances duck", () => {
  const mockFetchBalances = fetchBalances as jest.MockedFunction<
    typeof fetchBalances
  >;
  const mockGetItem = jest.fn();

  // Helper function to create a mock prices store state. The `prices` override
  // is exposed under every network so `pricesByNetwork[params.network]` resolves
  // regardless of which network a test uses.
  const createMockPricesStore = (
    overrides: Partial<{
      fetchPricesForBalances: jest.Mock;
      prices: TokenPricesMap;
      error: string | null;
      isLoading: boolean;
      lastUpdated: number | null;
    }> = {},
  ) => {
    const { prices = {}, ...rest } = overrides;
    return {
      fetchPricesForBalances: jest.fn().mockResolvedValue(undefined),
      pricesByNetwork: {
        [NETWORKS.PUBLIC]: prices,
        [NETWORKS.TESTNET]: prices,
        [NETWORKS.FUTURENET]: prices,
      },
      sourceByNetwork: {},
      error: null,
      isLoading: false,
      lastUpdated: null,
      ...rest,
    };
  };

  // Mock data
  const mockNativeBalance: NativeBalance = {
    token: {
      code: "XLM",
      type: "native" as const,
    },
    total: new BigNumber("100.5"),
    available: new BigNumber("100.5"),
    minimumBalance: new BigNumber("1"),
    buyingLiabilities: "0",
    sellingLiabilities: "0",
  };

  const mockTokenBalance: ClassicBalance = {
    token: {
      code: "USDC",
      issuer: {
        key: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      },
      type: "credit_alphanum4" as TokenTypeWithCustomToken,
    },
    total: new BigNumber("200"),
    available: new BigNumber("200"),
    limit: new BigNumber("1000"),
    buyingLiabilities: "0",
    sellingLiabilities: "0",
    blockaidData: benignTokenScan,
  };

  const mockBalances = {
    XLM: mockNativeBalance,
    "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN":
      mockTokenBalance,
  };

  const mockPrices = {
    XLM: {
      currentPrice: new BigNumber("0.5"),
      percentagePriceChange24h: new BigNumber("0.02"),
    },
    "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN": {
      currentPrice: new BigNumber("1"),
      percentagePriceChange24h: new BigNumber("-0.01"),
    },
  };

  const mockParams = {
    contractIds: [],
    publicKey: "GDNF5WJ2BEPABVBXCF4C7KZKM3XYXP27VUE3SCGPZA3VXWWZ7OFA3VPM",
    network: NETWORKS.TESTNET,
  };
  const mockParamsPubnet = {
    contractIds: [],
    publicKey: "GDNF5WJ2BEPABVBXCF4C7KZKM3XYXP27VUE3SCGPZA3VXWWZ7OFA3VPM",
    network: NETWORKS.PUBLIC,
  };

  beforeEach(() => {
    // Reset the store before each test
    act(() => {
      useBalancesStore.setState({
        balances: {},
        pricedBalances: {},
        scanResults: {},
        isLoading: false,
        error: null,
      });
      // The duck reads use_balances_v2 from the real remote-config store at
      // call time; pin it off so flag-ON tests must opt in explicitly.
      useRemoteConfigStore.setState({ use_balances_v2: false });
    });

    // Reset all mocks
    jest.clearAllMocks();
    mockFetchBalances.mockReset();
    (usePricesStore.getState as jest.Mock).mockReset();
    mockGetItem.mockReset();

    // Set up default storage mock
    jest.spyOn(dataStorage, "getItem").mockImplementation(mockGetItem);
  });

  describe("store state", () => {
    it("should have correct state values", () => {
      act(() => {
        useBalancesStore.setState({
          balances: mockBalances,
          pricedBalances: {},
          isLoading: true,
          error: "Test error",
        });
      });

      const { result } = renderHook(() => useBalancesStore());

      expect(result.current.balances).toEqual(mockBalances);
      expect(result.current.pricedBalances).toEqual({});
      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBe("Test error");
    });

    it("should have fetchAccountBalances function", async () => {
      const { result } = renderHook(() => useBalancesStore());

      expect(typeof result.current.fetchAccountBalances).toBe("function");

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(mockFetchBalances).toHaveBeenCalledWith({
        ...mockParams,
        useV2: false,
      });
    });
  });

  describe("fetchAccountBalances", () => {
    it("should update isLoading state when fetching begins", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(mockFetchBalances).toHaveBeenCalledWith({
        ...mockParams,
        useV2: false,
      });
    });

    it("passes useV2: true when the use_balances_v2 flag is on", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );

      const { result } = renderHook(() => useBalancesStore());

      // Flip the flag after render — the duck must read it at call time, not
      // capture it, so a freshly resolved Amplitude flag isn't missed.
      act(() => {
        useRemoteConfigStore.setState({ use_balances_v2: true });
      });

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(mockFetchBalances).toHaveBeenCalledWith({
        ...mockParams,
        useV2: true,
      });
    });

    it("should update balances and pricedBalances state on successful fetch", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ prices: mockPrices }),
      );

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(result.current.balances).toEqual(mockBalances);
      expect(result.current.pricedBalances).toBeDefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should record fetchedPublicKey and fetchedNetwork after a successful fetch", async () => {
      mockFetchBalances.mockResolvedValueOnce({
        balances: {},
        isFunded: false,
        subentryCount: 0,
      });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(result.current.fetchedPublicKey).toBe(mockParams.publicKey);
      expect(result.current.fetchedNetwork).toBe(mockParams.network);
    });

    it("should handle fetch with contractIds", async () => {
      // Mock custom token storage
      const mockCustomTokens = {
        [mockParams.publicKey]: {
          [mockParams.network]: [
            { contractId: "customContract1", symbol: "TOKEN1" },
            { contractId: "customContract2", symbol: "TOKEN2" },
          ],
        },
      };

      // Set up storage mock for this test
      mockGetItem.mockImplementation((key) => {
        if (key === STORAGE_KEYS.CUSTOM_TOKEN_LIST) {
          return Promise.resolve(JSON.stringify(mockCustomTokens));
        }
        return Promise.resolve(null);
      });

      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );

      const { result } = renderHook(() => useBalancesStore());

      // Provided contract IDs in params
      const providedContractIds = ["contract1", "contract2"];

      // First ensure the storage is initialized
      await mockGetItem(STORAGE_KEYS.CUSTOM_TOKEN_LIST);

      await act(async () => {
        await result.current.fetchAccountBalances({
          ...mockParams,
          contractIds: providedContractIds,
        });
      });

      // Verify balances were fetched
      expect(result.current.balances).toEqual(mockBalances);

      // Verify storage was queried with correct key
      expect(mockGetItem).toHaveBeenCalledWith(STORAGE_KEYS.CUSTOM_TOKEN_LIST);

      // Get the last call to fetchBalances
      expect(mockFetchBalances).toHaveBeenCalled();
      const lastCall =
        mockFetchBalances.mock.calls[mockFetchBalances.mock.calls.length - 1];
      expect(lastCall).toBeDefined();

      const [lastCallArgs] = lastCall;
      expect(lastCallArgs).toMatchObject({
        publicKey: mockParams.publicKey,
        network: mockParams.network,
      });

      // Verify that both custom tokens are included
      expect(lastCallArgs.contractIds).toBeDefined();
      expect(lastCallArgs.contractIds).toContain("customContract1");
      expect(lastCallArgs.contractIds).toContain("customContract2");

      // Verify that provided contract IDs are included
      expect(lastCallArgs.contractIds).toContain("contract1");
      expect(lastCallArgs.contractIds).toContain("contract2");

      // Verify total length
      expect(lastCallArgs.contractIds).toHaveLength(4);
    });

    it("should handle empty balances response", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: {} });
      (usePricesStore.getState as jest.Mock).mockReturnValue({
        fetchPricesForBalances: jest.fn().mockResolvedValue(undefined),
        pricesByNetwork: {},
        sourceByNetwork: {},
        error: null,
        isLoading: false,
        lastUpdated: null,
      });

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(result.current.balances).toEqual({});
      expect(result.current.pricedBalances).toEqual({});
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should update error state when fetch fails with Error instance", async () => {
      const errorMessage = "Network error";
      mockFetchBalances.mockRejectedValueOnce(new Error(errorMessage));

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(result.current.balances).toEqual({});
      expect(result.current.pricedBalances).toEqual({});
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(errorMessage);
      unmount();
    });

    it("should update error state when fetch fails with non-Error", async () => {
      mockFetchBalances.mockRejectedValueOnce("Some non-error rejection");

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      expect(result.current.balances).toEqual({});
      expect(result.current.pricedBalances).toEqual({});
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe("Failed to fetch balances");
      unmount();
    });

    it("should handle price fetch errors gracefully", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });

      // Mock the prices store to simulate a failed token prices fetch
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({
          prices: {},
          error: "Failed to fetch token prices",
          isLoading: false,
          lastUpdated: null,
        }),
      );

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      // Should still have balances even if price fetch failed
      expect(result.current.balances).toEqual(mockBalances);
      expect(result.current.pricedBalances).toBeDefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();

      // Additional assertions for price fetch error case
      expect(result.current.pricedBalances.XLM).toBeDefined();
      expect(result.current.pricedBalances.XLM.currentPrice).toBeUndefined();
      expect(
        result.current.pricedBalances.XLM.percentagePriceChange24h,
      ).toBeUndefined();
    });

    it("recomputes carried fiatTotals from the cached price, not verbatim", async () => {
      // Previous account's snapshot: 1000 XLM priced at $0.5 → fiatTotal 500.
      useBalancesStore.setState({
        pricedBalances: {
          XLM: {
            ...mockNativeBalance,
            tokenCode: "XLM",
            displayName: "Stellar Lumens",
            total: new BigNumber("1000"),
            currentPrice: new BigNumber("0.5"),
            fiatTotal: new BigNumber("500"),
          },
        },
      });

      // New fetch (e.g. a just-imported account) holds 100.5 XLM, and the
      // price fetch fails, so the carried map becomes state.
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({
          prices: {},
          error: "Failed to fetch token prices",
        }),
      );

      const { result } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      // fiatTotal must be THIS balance's total × the cached price — never
      // the previous balance's product carried verbatim.
      expect(result.current.pricedBalances.XLM.fiatTotal?.toString()).toBe(
        new BigNumber("100.5").multipliedBy("0.5").toString(),
      );
    });

    it("should extract scanResults from backend balance data", async () => {
      mockFetchBalances.mockResolvedValueOnce({ balances: mockBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ prices: mockPrices }),
      );

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParamsPubnet);
      });

      // Should extract scan results from blockaidData in balances
      expect(result.current.scanResults).toEqual({
        "USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN":
          benignTokenScan,
      });
      unmount();
    });

    it("should extract scan results only from mainnet balances", async () => {
      const mockBalancesWithBlockaid = {
        ...mockBalances,
        "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN":
          mockTokenBalance,
      };

      mockFetchBalances.mockResolvedValueOnce({
        balances: mockBalancesWithBlockaid,
      });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ prices: mockPrices }),
      );

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParams);
      });

      // On testnet, should not extract scan results
      expect(result.current.scanResults).toEqual({});
      unmount();
    });

    it("should not extract scan results for native tokens or liquidity pools", async () => {
      const mockNativeWithBlockaid = {
        ...mockNativeBalance,
        blockaidData: benignTokenScan,
      };

      const mockBalancesWithoutTokens = {
        XLM: mockNativeWithBlockaid,
      };

      mockFetchBalances.mockResolvedValueOnce({
        balances: mockBalancesWithoutTokens,
      });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ prices: mockPrices }),
      );

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParamsPubnet);
      });

      // Should not extract scan results for XLM (native token)
      expect(result.current.scanResults).toEqual({});
      unmount();
    });

    it("should extract scan results from multiple balances", async () => {
      const manyBalances = {} as BalanceMap;
      const expectedScanResults: Record<string, typeof benignTokenScan> = {};

      for (let i = 0; i < 5; i++) {
        const tokenId = `TOKEN${i}:ISSUER${i}`;
        manyBalances[tokenId] = {
          ...mockTokenBalance,
          token: {
            ...mockTokenBalance.token,
            code: `TOKEN${i}`,
            issuer: { key: `ISSUER${i}` },
          },
          blockaidData: benignTokenScan,
        };
        expectedScanResults[`TOKEN${i}-ISSUER${i}`] = benignTokenScan;
      }

      mockFetchBalances.mockResolvedValueOnce({ balances: manyBalances });
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ prices: {} }),
      );

      const { result, unmount } = renderHook(() => useBalancesStore());

      await act(async () => {
        await result.current.fetchAccountBalances(mockParamsPubnet);
      });

      // Should extract scan results for all tokens with blockaidData
      expect(result.current.scanResults).toEqual(expectedScanResults);
      expect(Object.keys(result.current.scanResults)).toHaveLength(5);
      unmount();
    });
  });

  describe("extractScanResultsFromBalances (via fetchAccountBalances)", () => {
    const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    // Stellar classic asset codes are case-sensitive alphanumeric, so a
    // lowercase code is legal and can contain "lp" as a substring (e.g.
    // "help") without being a liquidity pool.
    const helpBalance: ClassicBalance = {
      token: {
        code: "help",
        issuer: { key: ISSUER },
        type: "credit_alphanum4" as TokenTypeWithCustomToken,
      },
      total: new BigNumber("10"),
      available: new BigNumber("10"),
      limit: new BigNumber("1000"),
      buyingLiabilities: "0",
      sellingLiabilities: "0",
      blockaidData: benignTokenScan,
    };

    const lpBalance = {
      total: new BigNumber("1"),
      limit: new BigNumber("1"),
      liquidityPoolId:
        "4ac86c65b9f7b175ae0493da0d36cc5bc88b72677ca69fce8fe374233983d8e7",
      reserves: [],
    } as unknown as BalanceMap[string];

    beforeEach(() => {
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );
      mockFetchBalances.mockResolvedValue({
        balances: {
          XLM: mockNativeBalance,
          [`help:${ISSUER}`]: helpBalance,
          "4ac86c65b9f7b175ae0493da0d36cc5bc88b72677ca69fce8fe374233983d8e7:lp":
            lpBalance,
        } as BalanceMap,
      });
    });

    it("keeps scan results for a classic asset whose lowercase code contains 'lp'", async () => {
      const { result } = renderHook(() => useBalancesStore());
      await act(async () => {
        await result.current.fetchAccountBalances(mockParamsPubnet);
      });
      expect(result.current.scanResults[`help-${ISSUER}`]).toBeDefined();
    });

    it("skips liquidity-pool balances and the native balance", async () => {
      const { result } = renderHook(() => useBalancesStore());
      await act(async () => {
        await result.current.fetchAccountBalances(mockParamsPubnet);
      });
      const keys = Object.keys(result.current.scanResults);
      expect(keys.some((k) => k.startsWith("4ac86c65"))).toBe(false);
      expect(keys).not.toContain("XLM");
    });
  });
  it.each(["response", "prices"])(
    "keeps the new account when an older %s finishes last",
    async (stage) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pricing = jest
        .fn()
        .mockImplementationOnce(() =>
          stage === "prices" ? gate : Promise.resolve(),
        )
        .mockResolvedValue(undefined);
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore({ fetchPricesForBalances: pricing }),
      );
      const oldBalance = {
        ...mockNativeBalance,
        total: new BigNumber(10),
        available: new BigNumber(9),
      };
      const newBalance = {
        ...mockNativeBalance,
        total: new BigNumber(20),
        available: new BigNumber(19),
      };
      mockFetchBalances
        .mockImplementationOnce(async () => {
          if (stage === "response") await gate;
          return { balances: { XLM: oldBalance } };
        })
        .mockResolvedValueOnce({ balances: { XLM: newBalance } });
      let old: Promise<void>;
      await act(async () => {
        old = useBalancesStore
          .getState()
          .fetchAccountBalances({ ...mockParamsPubnet, publicKey: "old" });
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await useBalancesStore
          .getState()
          .fetchAccountBalances({ ...mockParamsPubnet, publicKey: "new" });
      });
      await act(async () => {
        release();
        await old;
      });
      expect(useBalancesStore.getState().fetchedPublicKey).toBe("new");
      expect(
        useBalancesStore.getState().pricedBalances.XLM.total.toFixed(),
      ).toBe("20");
    },
  );
  it("keeps history waiting for a matching in-flight balance refresh", async () => {
    useBalancesStore.setState({
      fetchedPublicKey: null,
      fetchedNetwork: null,
      isFunded: false,
    });
    useHistoryStore.setState({ isFetching: false, rawHistoryData: null });
    (usePricesStore.getState as jest.Mock).mockReturnValue(
      createMockPricesStore(),
    );
    const historyApi = jest.mocked(getAccountHistory).mockResolvedValue([]);
    let release: (
      value: Awaited<ReturnType<typeof fetchBalances>>,
    ) => void = () => {};
    mockFetchBalances.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let historySettled = false;
    let history: Promise<void>;
    let poll: Promise<void>;
    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      history = useHistoryStore
        .getState()
        .fetchAccountHistory(mockParamsPubnet)
        .then(() => {
          historySettled = true;
        });
      poll = useBalancesStore.getState().fetchAccountBalances(mockParamsPubnet);
      await Promise.resolve();
    });
    const settledBeforeBalance = historySettled;
    await act(async () => {
      release({
        balances: { XLM: mockNativeBalance },
        isFunded: true,
        subentryCount: 0,
      });
      await Promise.all([history, poll]);
    });
    expect(settledBeforeBalance).toBe(false);
    expect(mockFetchBalances).toHaveBeenCalledTimes(1);
    expect(historyApi).toHaveBeenCalledTimes(1);
    expect(
      useHistoryStore.getState().rawHistoryData?.balances.XLM.total.toFixed(),
    ).toBe("100.5");
  });

  it.each(["account", "network", "contractIds"])(
    "keeps newer %s requests independent and joined after old cleanup",
    async (change) => {
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );
      let releaseOld: (
        value: Awaited<ReturnType<typeof fetchBalances>>,
      ) => void = () => {};
      let releaseNew: (
        value: Awaited<ReturnType<typeof fetchBalances>>,
      ) => void = () => {};
      mockFetchBalances
        .mockReturnValueOnce(
          new Promise((resolve) => {
            releaseOld = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            releaseNew = resolve;
          }),
        );
      const newerParams = {
        ...mockParamsPubnet,
        ...(change === "account" ? { publicKey: "another-account" } : {}),
        ...(change === "network" ? { network: NETWORKS.TESTNET } : {}),
        ...(change === "contractIds"
          ? { contractIds: ["another-contract"] }
          : {}),
      };
      let old: Promise<void>;
      let current: Promise<void>;
      let joined: Promise<void>;
      // eslint-disable-next-line @typescript-eslint/require-await
      await act(async () => {
        old = useBalancesStore
          .getState()
          .fetchAccountBalances(mockParamsPubnet);
        await Promise.resolve();
      });
      // eslint-disable-next-line @typescript-eslint/require-await
      await act(async () => {
        current = useBalancesStore.getState().fetchAccountBalances(newerParams);
        await Promise.resolve();
      });
      await act(async () => {
        releaseOld({ balances: { XLM: mockNativeBalance }, isFunded: true });
        await old;
      });
      // eslint-disable-next-line @typescript-eslint/require-await
      await act(async () => {
        joined = useBalancesStore.getState().fetchAccountBalances(newerParams);
        await Promise.resolve();
      });
      const callsBeforeRelease = mockFetchBalances.mock.calls.length;
      await act(async () => {
        releaseNew({
          balances: {
            XLM: { ...mockNativeBalance, total: new BigNumber(200) },
          },
          isFunded: true,
        });
        await Promise.all([current, joined]);
      });
      expect(callsBeforeRelease).toBe(2);
      expect(useBalancesStore.getState().fetchedPublicKey).toBe(
        newerParams.publicKey,
      );
      expect(useBalancesStore.getState().fetchedNetwork).toBe(
        newerParams.network,
      );
      expect(useBalancesStore.getState().balances.XLM.total.toFixed()).toBe(
        "200",
      );
    },
  );

  it("releases a failed shared request so retry fetches again", async () => {
    (usePricesStore.getState as jest.Mock).mockReturnValue(
      createMockPricesStore(),
    );
    let rejectFetch: (error: Error) => void = () => {};
    mockFetchBalances.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    let first: Promise<void>;
    let joined: Promise<void>;
    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      first = useBalancesStore
        .getState()
        .fetchAccountBalances(mockParamsPubnet);
      joined = useBalancesStore
        .getState()
        .fetchAccountBalances(mockParamsPubnet);
      await Promise.resolve();
    });
    await act(async () => {
      rejectFetch(new Error("offline"));
      await Promise.all([first, joined]);
    });
    expect(mockFetchBalances).toHaveBeenCalledTimes(1);
    expect(useBalancesStore.getState().error).toBe("offline");
    mockFetchBalances.mockResolvedValueOnce({
      balances: { XLM: mockNativeBalance },
      isFunded: true,
    });
    await act(async () => {
      await useBalancesStore.getState().fetchAccountBalances(mockParamsPubnet);
    });
    expect(mockFetchBalances).toHaveBeenCalledTimes(2);
    expect(useBalancesStore.getState().error).toBeNull();
  });

  it("does not read another account's balances into a superseded history fetch", async () => {
    (usePricesStore.getState as jest.Mock).mockReturnValue(
      createMockPricesStore(),
    );
    useHistoryStore.setState({ isFetching: false, rawHistoryData: null });
    const historyApi = jest.mocked(getAccountHistory).mockResolvedValue([]);
    let releaseOld: (
      value: Awaited<ReturnType<typeof fetchBalances>>,
    ) => void = () => {};
    mockFetchBalances
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOld = resolve;
        }),
      )
      .mockResolvedValueOnce({
        balances: { XLM: mockNativeBalance },
        isFunded: true,
      });
    let history: Promise<void>;
    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      history = useHistoryStore
        .getState()
        .fetchAccountHistory(mockParamsPubnet);
      await Promise.resolve();
    });
    await act(async () => {
      await useBalancesStore.getState().fetchAccountBalances({
        ...mockParamsPubnet,
        publicKey: "another-account",
      });
    });
    await act(async () => {
      releaseOld({ balances: { XLM: mockNativeBalance }, isFunded: true });
      await history;
    });
    expect(historyApi).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().rawHistoryData).toBeNull();
    expect(useHistoryStore.getState().isFetching).toBe(false);
  });

  it.each(["balances", "history", "error"])(
    "keeps newer history loading when an older %s request settles",
    async (stage) => {
      (usePricesStore.getState as jest.Mock).mockReturnValue(
        createMockPricesStore(),
      );
      useHistoryStore.setState({
        isFetching: false,
        isLoading: false,
        rawHistoryData: null,
        error: null,
      });
      let started = () => {};
      const oldStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      let releaseOld = () => {};
      let releaseNew = () => {};
      const balanceResponse = {
        balances: { XLM: mockNativeBalance },
        isFunded: true,
      };
      mockFetchBalances
        .mockImplementationOnce(() => {
          if (stage !== "balances") return Promise.resolve(balanceResponse);
          return new Promise((resolve) => {
            releaseOld = () => resolve(balanceResponse);
            started();
          });
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseNew = () => resolve(balanceResponse);
            }),
        );
      const historyApi = jest.mocked(getAccountHistory).mockResolvedValue([]);
      if (stage !== "balances") {
        historyApi.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              releaseOld = () => {
                if (stage === "error") reject(new Error("old failure"));
                else resolve([]);
              };
              started();
            }),
        );
      }
      let oldHistory: Promise<void>;
      let newHistory: Promise<void>;
      await act(async () => {
        oldHistory = useHistoryStore
          .getState()
          .fetchAccountHistory(mockParamsPubnet);
        await oldStarted;
      });
      await act(async () => {
        // Account switching clears the old store before the next fetch starts.
        useHistoryStore.setState({ isFetching: false, isLoading: false });
        newHistory = useHistoryStore.getState().fetchAccountHistory({
          ...mockParamsPubnet,
          publicKey: "another-account",
        });
        await Promise.resolve();
      });
      await act(async () => {
        releaseOld();
        await oldHistory;
      });
      expect(useHistoryStore.getState()).toMatchObject({
        isFetching: true,
        isLoading: true,
        rawHistoryData: null,
        error: null,
      });
      await act(async () => {
        releaseNew();
        await newHistory;
      });
      expect(historyApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ publicKey: "another-account" }),
      );
      expect(useHistoryStore.getState()).toMatchObject({
        isFetching: false,
        isLoading: false,
        rawHistoryData: {
          balances: balanceResponse.balances,
          rawOperations: [],
        },
        error: null,
      });
    },
  );
});
