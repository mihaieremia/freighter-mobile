/* eslint-disable @fnando/consistent-import/consistent-import */
import { act, renderHook } from "@testing-library/react-native";
import {
  buildListedRecords,
  resetSwapListedTokensCacheForTests,
  useSwapListedTokens,
} from "components/screens/SwapScreen/hooks/useSwapListedTokens";
import { NETWORKS } from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { type HeldBalanceItem } from "hooks/useBalancesList";
import { SwapListedToken, SwapListedTokenKind } from "services/backend";
import { SecurityLevel } from "services/blockaid/constants";

import {
  CONTRACT,
  ISSUER,
  USDC_SAC,
  XLM_SAC,
} from "../../../../../__mocks__/swapFixtures";

const mockFetchSwapTokens = jest.fn();
const mockScanBulkWithCache = jest.fn();

jest.mock("services/backend", () => ({
  ...jest.requireActual("services/backend"),
  fetchSwapTokens: (...args: unknown[]) => mockFetchSwapTokens(...args),
}));
jest.mock("ducks/blockaidTokenScans", () => ({
  useBlockaidTokenScansStore: {
    getState: () => ({ scanBulkWithCache: mockScanBulkWithCache }),
  },
}));
jest.mock("ducks/debug", () => ({
  useDebugStore: (
    select: (state: { overriddenBlockaidResponse: null }) => unknown,
  ) => select({ overriddenBlockaidResponse: null }),
}));

const SOLV = "CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN";

const listed: Record<string, SwapListedToken> = {
  xlm: {
    id: XLM_SAC,
    kind: SwapListedTokenKind.NATIVE,
    code: "XLM",
    name: "Stellar Lumens",
    decimals: 7,
    priceUsd: 0.23,
  },
  usdc: {
    id: USDC_SAC,
    kind: SwapListedTokenKind.CLASSIC,
    asset: `USDC:${ISSUER}`,
    code: "USDC",
    name: "USD Coin",
    decimals: 7,
    iconUrl: "https://media/usdc.png",
    priceUsd: 1,
  },
  solv: {
    id: SOLV,
    kind: SwapListedTokenKind.SOROBAN,
    code: "SolvBTC",
    name: "SolvBTC",
    decimals: 8,
    iconUrl: "https://media/solv.png",
    priceUsd: 84255.6,
  },
  dejtrsy: {
    id: CONTRACT,
    kind: SwapListedTokenKind.SOROBAN,
    code: "DEJTRSY",
    name: "deJTRSY",
    decimals: 18,
    priceUsd: 1.03,
  },
};

describe("buildListedRecords", () => {
  const none = new Set<string>();
  const build = (
    tokens: SwapListedToken[],
    heldIds = none,
    heldContractIds = none,
  ) => buildListedRecords({ tokens, heldIds, heldContractIds });

  it("turns a classic token into a classic row that needs a trustline", () => {
    expect(build([listed.usdc])).toEqual([
      {
        tokenCode: "USDC",
        name: "USD Coin",
        domain: "",
        hasTrustline: false,
        iconUrl: "https://media/usdc.png",
        issuer: ISSUER,
        isNative: false,
        tokenType: TokenTypeWithCustomToken.CREDIT_ALPHANUM4,
        decimals: 7,
        price: 1,
      },
    ]);
  });

  it("sizes the classic token type by the length of its code", () => {
    const [record] = build([
      { ...listed.usdc, asset: `PYUSDLONG:${ISSUER}`, code: "PYUSDLONG" },
    ]);

    expect(record.tokenType).toBe(TokenTypeWithCustomToken.CREDIT_ALPHANUM12);
  });

  it("turns a Soroban token into a row with the contract where the issuer goes and no trustline", () => {
    expect(build([listed.solv])).toEqual([
      {
        tokenCode: "SolvBTC",
        name: "SolvBTC",
        domain: "",
        hasTrustline: true,
        iconUrl: "https://media/solv.png",
        issuer: SOLV,
        isNative: false,
        tokenType: TokenTypeWithCustomToken.CUSTOM_TOKEN,
        decimals: 8,
        price: 84255.6,
      },
    ]);
  });

  it("leaves out native XLM", () => {
    expect(build([listed.xlm])).toEqual([]);
  });

  it("leaves out a classic token with no asset", () => {
    expect(build([{ ...listed.usdc, asset: undefined }])).toEqual([]);
    expect(build([{ ...listed.usdc, asset: "USDC" }])).toEqual([]);
  });
});

describe("useSwapListedTokens", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSwapListedTokensCacheForTests();
    mockFetchSwapTokens.mockReset();
    mockFetchSwapTokens.mockResolvedValue(Object.values(listed));
    mockScanBulkWithCache.mockResolvedValue({ results: {} });
  });

  // Lets the list request and the scan resolve and the hook apply them.
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

  const render = (
    balanceItems: HeldBalanceItem[] = [],
    network = NETWORKS.PUBLIC,
  ) => renderHook(() => useSwapListedTokens({ network, balanceItems }));

  it("offers the listed tokens and the contracts of its Soroban ones", async () => {
    const { result } = render();
    await flush();

    expect(mockFetchSwapTokens).toHaveBeenCalledWith(NETWORKS.PUBLIC);
    expect(result.current.listedRecords.map((r) => r.tokenCode)).toEqual([
      "USDC",
      "SolvBTC",
      "DEJTRSY",
    ]);
    expect([...result.current.routableIds].sort()).toEqual(
      [CONTRACT, SOLV].sort(),
    );
  });

  it("does not offer a token the user holds", async () => {
    const held = [
      { id: `USDC:${ISSUER}` },
      {
        id: `SolvBTC:${SOLV}`,
        token: { type: "custom_token", code: "SolvBTC", issuer: { key: SOLV } },
      },
    ] as unknown as HeldBalanceItem[];

    const { result } = render(held);
    await flush();

    expect(result.current.listedRecords.map((r) => r.tokenCode)).toEqual([
      "DEJTRSY",
    ]);
    expect(result.current.routableIds.has(SOLV)).toBe(true);
  });

  it("scans the classic rows only and marks each with what came back", async () => {
    mockScanBulkWithCache.mockResolvedValue({
      results: { [`USDC-${ISSUER}`]: { result_type: "Benign", features: [] } },
    });

    const { result } = render();
    await flush();

    expect(mockScanBulkWithCache).toHaveBeenCalledWith(
      expect.objectContaining({
        addressList: [`USDC-${ISSUER}`],
        network: NETWORKS.PUBLIC,
      }),
    );
    const usdc = result.current.listedRecords.find(
      (r) => r.tokenCode === "USDC",
    );
    expect(usdc?.securityLevel).toBe(SecurityLevel.SAFE);
    const solv = result.current.listedRecords.find(
      (r) => r.tokenCode === "SolvBTC",
    );
    expect(solv?.securityLevel).toBeUndefined();
  });

  it("keeps the rows, unscanned, when the scan fails", async () => {
    mockScanBulkWithCache.mockRejectedValue(new Error("blockaid down"));

    const { result } = render();
    await flush();

    expect(result.current.listedRecords).toHaveLength(3);
  });

  it("does not scan on a network Blockaid does not cover", async () => {
    render([], NETWORKS.TESTNET);
    await flush();

    expect(mockScanBulkWithCache).not.toHaveBeenCalled();
  });

  it("reuses the list within the session instead of asking again", async () => {
    const first = render();
    await flush();
    first.unmount();

    const second = render();
    await flush();

    expect(mockFetchSwapTokens).toHaveBeenCalledTimes(1);
    expect(second.result.current.listedRecords.map((r) => r.tokenCode)).toEqual(
      ["USDC", "SolvBTC", "DEJTRSY"],
    );
  });

  it("asks again when the network changes and shows the list of the new network", async () => {
    mockFetchSwapTokens
      .mockResolvedValueOnce([listed.usdc])
      .mockResolvedValueOnce([listed.dejtrsy]);
    const { result, rerender } = renderHook<
      ReturnType<typeof useSwapListedTokens>,
      { network: NETWORKS }
    >(({ network }) => useSwapListedTokens({ network, balanceItems: [] }), {
      initialProps: { network: NETWORKS.PUBLIC },
    });
    await flush();
    expect(result.current.listedRecords.map((r) => r.tokenCode)).toEqual([
      "USDC",
    ]);

    rerender({ network: NETWORKS.TESTNET });
    await flush();

    expect(mockFetchSwapTokens).toHaveBeenNthCalledWith(1, NETWORKS.PUBLIC);
    expect(mockFetchSwapTokens).toHaveBeenNthCalledWith(2, NETWORKS.TESTNET);
    expect(result.current.listedRecords.map((r) => r.tokenCode)).toEqual([
      "DEJTRSY",
    ]);
  });

  it("does not share the session cache across networks", async () => {
    mockFetchSwapTokens
      .mockResolvedValueOnce([listed.usdc])
      .mockResolvedValueOnce([listed.dejtrsy]);
    const publicNetwork = render();
    await flush();
    publicNetwork.unmount();

    const testnet = render([], NETWORKS.TESTNET);

    expect(testnet.result.current.listedRecords).toEqual([]);
    await flush();
    expect(mockFetchSwapTokens).toHaveBeenCalledTimes(2);
    expect(
      testnet.result.current.listedRecords.map((r) => r.tokenCode),
    ).toEqual(["DEJTRSY"]);

    const publicAgain = render();
    await flush();

    expect(mockFetchSwapTokens).toHaveBeenCalledTimes(2);
    expect(
      publicAgain.result.current.listedRecords.map((r) => r.tokenCode),
    ).toEqual(["USDC"]);
  });

  it("offers nothing, and does not throw, when the backend cannot list tokens", async () => {
    mockFetchSwapTokens.mockRejectedValue(new Error("down"));

    const { result } = render();
    await flush();

    expect(result.current.routableIds.size).toBe(0);
    expect(result.current.listedRecords).toEqual([]);
  });
});
