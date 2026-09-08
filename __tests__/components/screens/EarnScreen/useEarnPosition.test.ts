/* eslint-disable @fnando/consistent-import/consistent-import */
import { renderHook, waitFor } from "@testing-library/react-native";
import { useEarnPosition } from "components/screens/EarnScreen/hooks/useEarnPosition";
import { NETWORKS } from "config/constants";
import { useEarnStore } from "ducks/earn";

const mockGetDepositTarget = jest.fn();
const mockLoggerError = jest.fn();

jest.mock("services/xoxno", () => ({
  getXoxnoDepositTarget: (...args: unknown[]) => mockGetDepositTarget(...args),
}));

jest.mock("config/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

const baseParams = {
  hubId: 1,
  acceptingSpokeIds: [1],
  spokeId: 1,
  assetId: "CASSET",
  publicKey: "GSENDER",
  networkDetails: { network: NETWORKS.TESTNET } as never,
};

describe("useEarnPosition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEarnStore.getState().resetEarn();
  });

  it("writes the fetched position to the earn duck on success", async () => {
    mockGetDepositTarget.mockResolvedValue({
      accountId: "6",
      spokeId: 1,
      suppliedTokens: "5000000000",
    });

    renderHook(() => useEarnPosition(baseParams));

    await waitFor(() => {
      expect(useEarnStore.getState().currentPositionTokens).toBe("5000000000");
    });

    expect(mockGetDepositTarget).toHaveBeenCalledWith({
      publicKey: baseParams.publicKey,
      hubId: baseParams.hubId,
      assetId: baseParams.assetId,
      // The resolver is told which spokes accept the asset — a position in
      // any of them can be topped up — and which one a new position opens in.
      spokeId: 1,
      acceptingSpokeIds: [1],
      networkDetails: baseParams.networkDetails,
    });
  });

  // Load-bearing regression test: a rejected fetch (network error, backend
  // outage, unknown address) must be swallowed, not surfaced as a blocker.
  // Review renders the "after" value alone off whatever `currentPositionTokens`
  // already is — which must stay at its "0" default here, not be corrupted by
  // the failed attempt.
  it("is non-fatal on a rejected fetch: leaves currentPositionTokens at its default and logs instead of throwing", async () => {
    mockGetDepositTarget.mockRejectedValue(new Error("network down"));

    renderHook(() => useEarnPosition(baseParams));

    await waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith(
        "useEarnPosition",
        "Failed to fetch XOXNO position",
        expect.any(Error),
      );
    });

    expect(useEarnStore.getState().currentPositionTokens).toBe("0");
  });

  it("does not fetch until hubId, assetId, and publicKey are all known", () => {
    renderHook(() => useEarnPosition({ ...baseParams, hubId: 0 }));

    expect(mockGetDepositTarget).not.toHaveBeenCalled();
  });

  it("re-fetches when the asset changes", async () => {
    mockGetDepositTarget.mockResolvedValue("1000000000");

    const { rerender } = renderHook(
      (props: typeof baseParams) => useEarnPosition(props),
      { initialProps: baseParams },
    );

    await waitFor(() => {
      expect(mockGetDepositTarget).toHaveBeenCalledTimes(1);
    });

    mockGetDepositTarget.mockResolvedValue("2000000000");
    rerender({ ...baseParams, assetId: "CASSET_OTHER" });

    await waitFor(() => {
      expect(mockGetDepositTarget).toHaveBeenCalledTimes(2);
    });

    expect(mockGetDepositTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ assetId: "CASSET_OTHER" }),
    );
  });
});
