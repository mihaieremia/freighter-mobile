/* eslint-disable @fnando/consistent-import/consistent-import, @typescript-eslint/require-await */
import { Account, TransactionBuilder } from "@stellar/stellar-sdk";
import { renderHook, act } from "@testing-library/react-hooks";
import BigNumber from "bignumber.js";
import {
  useSimulateEarnDeposit,
  SimulateEarnDepositParams,
} from "components/screens/EarnScreen/hooks/useSimulateEarnTransaction";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { getXoxnoControllerId } from "config/xoxno";
import { useBalancesStore } from "ducks/balances";
import { useEarnStore } from "ducks/earn";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { buildXoxnoSupplyOp } from "helpers/xoxno";

const mockScan = jest.fn();
const mockBuildResult = jest.fn();
const senderAddress =
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
let mockAuth = {
  account: { publicKey: senderAddress },
  network: NETWORKS.TESTNET,
};
jest.mock("ducks/auth", () => ({ useAuthenticationStore: () => mockAuth }));
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void) => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    require("react").useEffect(fn, [fn]);
  },
}));
jest.mock("hooks/blockaid/useBlockaidTransaction", () => ({
  useBlockaidTransaction: () => ({ scanTransaction: mockScan }),
}));

const params: SimulateEarnDepositParams = {
  senderAddress,
  assetId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  hubId: 1,
  spokeId: 2,
  acceptingSpokeIds: [2],
  amount: "1",
  decimals: 7,
  network: NETWORKS.TESTNET,
  transactionFee: "0.00001",
  transactionTimeout: 30,
};
const envelope = () =>
  new TransactionBuilder(new Account(senderAddress, "1"), {
    networkPassphrase: mapNetworkToNetworkDetails(params.network)
      .networkPassphrase,
    fee: "600000",
  })
    .addOperation(
      buildXoxnoSupplyOp({
        publicKey: senderAddress,
        controllerId: getXoxnoControllerId(
          mapNetworkToNetworkDetails(params.network),
        )!,
        accountId: "6",
        spokeId: 2,
        hubId: 1,
        assetId: params.assetId,
        amount: "10000000",
      }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
let request = 0;
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    account: { publicKey: senderAddress },
    network: NETWORKS.TESTNET,
  };
  useTransactionSettingsStore.setState({
    transactionFee: params.transactionFee,
    transactionTimeout: params.transactionTimeout,
  });
  useTransactionBuilderStore.getState().resetTransaction();
  mockScan.mockResolvedValue({ scanned: true });
  mockBuildResult.mockImplementation(async () => envelope());
  useTransactionBuilderStore.setState({
    buildXoxnoDepositTransaction: async () => {
      const id = String(++request);
      useTransactionBuilderStore.setState({
        requestId: id,
        transactionXDR: null,
        isBuilding: true,
      });
      const xdr = await mockBuildResult();
      if (useTransactionBuilderStore.getState().requestId !== id) return null;
      useTransactionBuilderStore.setState({
        isBuilding: false,
        transactionXDR: xdr,
        xoxnoDepositTarget: {
          accountId: "6",
          spokeId: 2,
          suppliedTokens: "20000000",
        },
      });
      return xdr;
    },
  });
  useBalancesStore.setState({
    fetchedPublicKey: senderAddress,
    fetchedNetwork: NETWORKS.TESTNET,
    subentryCount: 0,
    pricedBalances: {
      XLM: {
        token: { code: "XLM", type: "native" },
        total: new BigNumber(10),
        available: new BigNumber(9),
        minimumBalance: new BigNumber(1),
        buyingLiabilities: "0",
        sellingLiabilities: "0",
      },
    },
  });
});

it("captures the built position, amount and scan, independent of the old preview", async () => {
  useEarnStore.setState({ currentPositionTokens: "99999999999" });
  const { result } = renderHook(() => useSimulateEarnDeposit());
  await act(async () => {
    await result.current.simulate(params);
  });
  expect(result.current.prepared).toMatchObject({
    accountId: "6",
    amountUnits: "10000000",
    positionBeforeTokens: "20000000",
    scanResult: { scanned: true },
  });
  expect(result.current.isSimulating).toBe(false);
  expect(Object.isFrozen(result.current.prepared)).toBe(true);
});
it("keeps unavailable scanning explicit without treating it as a build failure", async () => {
  mockScan.mockRejectedValue(new Error("NETWORK_NOT_SUPPORTED"));
  const { result } = renderHook(() => useSimulateEarnDeposit());
  await act(async () => {
    await result.current.simulate(params);
  });
  expect(result.current.prepared?.scanResult).toBeUndefined();
  expect(result.current.prepared).not.toBeNull();
  expect(result.current.error).toBeNull();
});
it.each(["cancel", "account", "network", "settings", "unmount"])(
  "discards a scan resolving after %s",
  async (change) => {
    let finish = () => {};
    mockScan.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender, unmount } = renderHook(() =>
      useSimulateEarnDeposit(),
    );
    let pending: Promise<unknown>;
    await act(async () => {
      pending = result.current.simulate(params);
      await Promise.resolve();
    });
    expect(result.current.isSimulating).toBe(true);
    act(() => {
      if (change === "cancel") result.current.cancel();
      if (change === "settings")
        useTransactionSettingsStore.setState({ transactionTimeout: 90 });
      if (change === "account") {
        mockAuth = { ...mockAuth, account: { publicKey: "other" } };
        rerender();
      }
      if (change === "network") {
        mockAuth = { ...mockAuth, network: NETWORKS.PUBLIC };
        rerender();
      }
      if (change === "unmount") unmount();
    });
    await act(async () => {
      finish();
      expect(await pending).toBeNull();
    });
    expect(useTransactionBuilderStore.getState().transactionXDR).toBeNull();
  },
);
it("never revives an older scan after a newer request completes", async () => {
  let oldScan = () => {};
  mockScan.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        oldScan = resolve;
      }),
  );
  const { result } = renderHook(() => useSimulateEarnDeposit());
  let pending: Promise<unknown>;
  await act(async () => {
    pending = result.current.simulate(params);
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.simulate(params);
  });
  const latest = result.current.prepared;
  await act(async () => {
    oldScan();
    expect(await pending).toBeNull();
  });
  expect(result.current.prepared).toBe(latest);
});
it("clears the old XDR before a failed settings rebuild", async () => {
  const { result } = renderHook(() => useSimulateEarnDeposit());
  await act(async () => {
    await result.current.simulate(params);
  });
  mockBuildResult.mockRejectedValueOnce(new Error("rebuild failed"));
  await act(async () => {
    await result.current.simulate(params);
  });
  expect(result.current.prepared).toBeNull();
  expect(useTransactionBuilderStore.getState().transactionXDR).toBeNull();
  expect(result.current.error).toBe("rebuild failed");
  expect(result.current.isSimulating).toBe(false);
});
it("rejects incomplete balances before scanning", async () => {
  useBalancesStore.setState({ fetchedPublicKey: null });
  const { result } = renderHook(() => useSimulateEarnDeposit());
  await act(async () => {
    await result.current.simulate(params);
  });
  expect(result.current.prepared).toBeNull();
  expect(mockScan).not.toHaveBeenCalled();
});
