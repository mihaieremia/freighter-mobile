/* eslint-disable @fnando/consistent-import/consistent-import, @typescript-eslint/require-await */
import { act, renderHook } from "@testing-library/react-hooks";
import { useEarnPositions } from "components/screens/EarnScreen/hooks/useEarnPositions";
import { useEarnTokens } from "components/screens/EarnScreen/hooks/useEarnTokens";
import { NETWORKS } from "config/constants";

let mockAccount = { publicKey: "account-a" };
let mockNetwork = NETWORKS.TESTNET;
const mockPositions = jest.fn();
const mockCatalog = jest.fn();
jest.mock("hooks/useGetActiveAccount", () => ({
  __esModule: true,
  default: () => ({ account: mockAccount }),
}));
jest.mock("ducks/auth", () => ({
  useAuthenticationStore: () => ({ network: mockNetwork }),
}));
jest.mock("ducks/balances", () => ({
  useBalancesStore: () => ({ pricedBalances: {} }),
}));
jest.mock("services/xoxno", () => ({
  getXoxnoPositions: (...args: unknown[]) => mockPositions(...args),
  getXoxnoEarnOptions: (...args: unknown[]) => mockCatalog(...args),
  foldXoxnoHubs: () => [],
}));
jest.mock("hooks/useFocusedPolling", () => ({
  useFocusedPolling: ({ onPoll }: { onPoll: () => void }) => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    require("react").useEffect(() => {
      onPoll();
    }, [onPoll]);
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { publicKey: "account-a" };
  mockNetwork = NETWORKS.TESTNET;
  mockPositions.mockResolvedValue([]);
  mockCatalog.mockResolvedValue([]);
});
it.each(["account", "network"])(
  "clears and rejects a late position response after %s changes",
  async (change) => {
    let old: (value: unknown) => void = () => {};
    mockPositions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    );
    const { result, rerender } = renderHook(() => useEarnPositions());
    await act(async () => {
      if (change === "account") mockAccount = { publicKey: "account-b" };
      else mockNetwork = NETWORKS.PUBLIC;
      rerender();
    });
    await act(async () => {
      old([{ accountId: "old-account" }]);
    });
    expect(result.current.positions).toEqual([]);
  },
);
it("does not mistake an unavailable position response for no positions", async () => {
  mockPositions.mockRejectedValue(new Error("incomplete indexes"));
  const { result } = renderHook(() => useEarnPositions());
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.positions).toBeNull();
  expect(result.current.error).toBe("incomplete indexes");
  mockPositions.mockResolvedValue([]);
  await act(async () => {
    result.current.refetch();
  });
  expect(result.current.positions).toEqual([]);
  expect(result.current.error).toBeNull();
});
it("keeps the rendered positions when a background poll fails", async () => {
  // The 30s poll runs under a list the user is already looking at. Dropping
  // the positions on its failure replaced that list with the could-not-load
  // page until the next poll happened to succeed.
  mockPositions.mockResolvedValue([{ accountId: "account-a" }]);
  const { result } = renderHook(() => useEarnPositions());
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.positions).toEqual([{ accountId: "account-a" }]);

  mockPositions.mockRejectedValue(new Error("bad gateway"));
  await act(async () => {
    result.current.refetch();
  });
  expect(result.current.positions).toEqual([{ accountId: "account-a" }]);
  expect(result.current.error).toBe("bad gateway");
});
it("ignores an older catalog response after the network changed", async () => {
  let old: (value: unknown) => void = () => {};
  mockCatalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve;
      }),
  );
  const { result, rerender } = renderHook(() => useEarnTokens());
  await act(async () => {
    mockNetwork = NETWORKS.PUBLIC;
    rerender();
  });
  await act(async () => {
    old([
      {
        assetId: "OLD",
        offers: [{ hubId: 1, supplyApy: 1, spokes: [{ id: 1 }] }],
      },
    ]);
  });
  expect(result.current.supported).toEqual([]);
});
it("does not replace newer positions when refreshes complete in reverse order", async () => {
  let first: (value: unknown) => void = () => {};
  mockPositions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        first = resolve;
      }),
  );
  mockPositions.mockResolvedValueOnce([{ accountId: "new" }]);
  const { result } = renderHook(() => useEarnPositions());
  await act(async () => {
    result.current.refetch();
  });
  await act(async () => {
    first([{ accountId: "old" }]);
  });
  expect(result.current.positions).toEqual([{ accountId: "new" }]);
});
