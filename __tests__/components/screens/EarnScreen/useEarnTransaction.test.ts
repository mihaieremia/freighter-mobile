/* eslint-disable @fnando/consistent-import/consistent-import, @typescript-eslint/require-await */
import { renderHook, act } from "@testing-library/react-hooks";
import BigNumber from "bignumber.js";
import { PreparedEarnReview } from "components/screens/EarnScreen/helpers/preparedReview";
import { useEarnTransaction } from "components/screens/EarnScreen/hooks/useEarnTransaction";
import { NETWORKS } from "config/constants";
import type { ActiveAccount } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useTransactionSettingsStore } from "ducks/transactionSettings";

const account: ActiveAccount = {
  publicKey: "GA...",
  privateKey: "SA...",
  accountName: "Account 1",
  id: "1",
  subentryCount: 0,
};
const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockVerify = jest.fn();
const mockRefresh = jest.fn();
const mockReset = jest.fn();
const mockTrack = jest.fn();
const mockTrackFail = jest.fn();
const mockUnlocked = jest.fn();
let mockAuth = {
  account,
  network: NETWORKS.TESTNET,
  verifyActionWithBiometrics: mockVerify,
};
let mockBuilder: Record<string, unknown> = {
  requestId: "request",
  transactionXDR: "reviewed-xdr",
  isBuilding: false,
  error: null as string | null,
  signTransaction: mockSign,
  submitTransaction: mockSubmit,
  resetTransaction: mockReset,
};

jest.mock("ducks/auth", () => ({
  useAuthenticationStore: { getState: () => mockAuth },
}));
jest.mock("ducks/transactionBuilder", () => ({
  useTransactionBuilderStore: { getState: () => mockBuilder },
}));
jest.mock("hooks/useGetActiveAccount", () => ({
  isWalletUnlocked: () => mockUnlocked(),
}));
jest.mock("services/analytics", () => ({
  analytics: {
    trackEarnDepositSuccess: (...args: unknown[]) => mockTrack(...args),
    trackEarnDepositFail: (...args: unknown[]) => mockTrackFail(...args),
  },
}));

const review = (): PreparedEarnReview => ({
  action: "deposit",
  assetCode: "USDC",
  accountId: "6",
  amountUnits: "10000000",
  preparedXdr: "reviewed-xdr",
  requestId: "request",
  expiresAt: Date.now() + 30000,
  feeXlm: "0.06",
  positionBeforeTokens: "0",
  apy: 0.05,
  scanResult: undefined,
  params: {
    senderAddress: account.publicKey,
    network: NETWORKS.TESTNET,
    assetId: "CASSET",
    amount: "1",
    decimals: 7,
    hubId: 1,
    spokeId: 1,
    transactionFee: "0.00001",
    transactionTimeout: 30,
  },
});
const setup = () =>
  renderHook(() => useEarnTransaction({ account, network: NETWORKS.TESTNET }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    account,
    network: NETWORKS.TESTNET,
    verifyActionWithBiometrics: mockVerify,
  };
  mockBuilder = {
    requestId: "request",
    transactionXDR: "reviewed-xdr",
    isBuilding: false,
    error: null,
    signTransaction: mockSign,
    submitTransaction: mockSubmit,
    resetTransaction: mockReset,
  };
  mockUnlocked.mockReturnValue(true);
  mockVerify.mockResolvedValue(undefined);
  mockSign.mockReturnValue("signed-reviewed-xdr");
  mockSubmit.mockResolvedValue("tx-hash");
  mockRefresh.mockResolvedValue(undefined);
  useTransactionSettingsStore.setState({
    transactionFee: "0.00001",
    transactionTimeout: 30,
  });
  useBalancesStore.setState({
    fetchedPublicKey: account.publicKey,
    fetchedNetwork: NETWORKS.TESTNET,
    subentryCount: 0,
    fetchAccountBalances: mockRefresh,
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

describe("Earn authorization", () => {
  it.each(["deposit", "withdraw", "repay"] as const)(
    "authenticates and signs the reviewed XDR for %s",
    async (action) => {
      const { result } = setup();
      const captured = { ...review(), action };
      await act(async () => {
        await result.current.submit(captured);
      });
      expect(mockVerify).toHaveBeenCalledTimes(1);
      expect(mockSign).toHaveBeenCalledWith({
        secretKey: account.privateKey,
        network: NETWORKS.TESTNET,
        expectedXdr: captured.preparedXdr,
      });
      expect(result.current.status).toBe("success");
      expect(result.current.transactionHash).toBe("tx-hash");
      expect(mockRefresh).toHaveBeenCalledWith({
        publicKey: account.publicKey,
        network: NETWORKS.TESTNET,
      });
      expect(mockTrack).toHaveBeenCalledTimes(action === "deposit" ? 1 : 0);
    },
  );
  it.each(["deposit", "withdraw", "repay"] as const)(
    "cancels %s biometrics without signing or a failure banner",
    async (action) => {
      mockVerify.mockRejectedValue(new Error("cancelled"));
      const { result } = setup();
      await act(async () => {
        await result.current.submit({ ...review(), action });
      });
      expect(mockSign).not.toHaveBeenCalled();
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
    },
  );
  it.each([
    "xdr",
    "building",
    "request",
    "account",
    "network",
    "expiry",
    "balances",
  ])("rejects changed %s before authorization", async (change) => {
    const captured = review();
    if (change === "xdr") mockBuilder.transactionXDR = "another-xdr";
    if (change === "building") mockBuilder.isBuilding = true;
    if (change === "request") mockBuilder.requestId = "new";
    if (change === "account")
      mockAuth.account = { ...account, publicKey: "GB..." };
    if (change === "network") mockAuth.network = NETWORKS.PUBLIC;
    if (change === "expiry") captured.expiresAt = Date.now() - 1;
    if (change === "balances")
      useBalancesStore.setState({ fetchedPublicKey: "GB..." });
    const { result } = setup();
    await act(async () => {
      await result.current.submit(captured);
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });
  it.each(["xdr", "account", "network", "expiry", "cancel"])(
    "rechecks %s after delayed biometrics",
    async (change) => {
      let unlock = () => {};
      mockVerify.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            unlock = resolve;
          }),
      );
      const captured = review();
      const { result } = setup();
      let pending: Promise<void>;
      act(() => {
        pending = result.current.submit(captured);
      });
      if (change === "xdr") mockBuilder.transactionXDR = "another-xdr";
      if (change === "account")
        mockAuth.account = { ...account, publicKey: "GB..." };
      if (change === "network") mockAuth.network = NETWORKS.PUBLIC;
      if (change === "expiry") captured.expiresAt = Date.now() - 1;
      if (change === "cancel") act(() => result.current.abandon());
      await act(async () => {
        unlock();
        await pending;
      });
      expect(mockSign).not.toHaveBeenCalled();
      expect(mockSubmit).not.toHaveBeenCalled();
    },
  );
  // The reviewed transaction already carries the fee it was built with, so a
  // recommended fee arriving from the background prewarm cannot change what
  // is signed. Refusing on it turned a preference moving into a failed
  // confirmation.
  it("submits when the stored fee changes after the review", async () => {
    const captured = review();
    const { result } = setup();

    useTransactionSettingsStore.setState({
      transactionFee: "0.5",
      transactionTimeout: 45,
    });

    await act(async () => {
      await result.current.submit(captured);
    });

    expect(mockSign).toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalled();
    expect(result.current.status).toBe("success");
  });

  // Horizon answers a rejection with prose that names a field the user cannot
  // see. The result codes are the reason, so they are what the message says.
  it("reports the network's result codes rather than Horizon's prose", async () => {
    mockSubmit.mockResolvedValue(null);
    mockBuilder = {
      ...mockBuilder,
      error: "The transaction failed when submitted to the stellar network.",
      submitErrorResultCodes: {
        transaction: "tx_failed",
        operations: ["op_underfunded"],
      },
    };

    const { result } = setup();
    await act(async () => {
      await result.current.submit(review());
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("tx_failed");
    expect(result.current.error).toContain("op_underfunded");
  });

  it("allows only one confirmation while authorizing or submitting", async () => {
    let unlock = () => {};
    mockVerify.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
    );
    const { result } = setup();
    let pending: Promise<void>;
    act(() => {
      pending = result.current.submit(review());
    });
    await act(async () => {
      await result.current.submit(review());
      unlock();
      await pending;
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
  it("preserves confirmed success and its reviewed amount across input resets", async () => {
    const { result } = setup();
    const captured = review();
    await act(async () => {
      await result.current.submit(captured);
    });
    act(() => result.current.reset());
    expect(result.current.status).toBe("success");
    expect(result.current.transactionHash).toBe("tx-hash");
    expect(result.current.submittedReview).toBe(captured);
    await act(async () => {
      await result.current.submit(captured);
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("preserves submission errors locally and invalidates preparation", async () => {
    mockSubmit.mockResolvedValue(null);
    mockBuilder.error = "op_underfunded";
    const { result } = setup();
    await act(async () => {
      await result.current.submit({ ...review(), action: "repay" });
    });
    expect(result.current.error).toBe("op_underfunded");
    expect(mockReset).toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });
  it("does not turn delayed balance-refresh failure into transaction failure", async () => {
    mockRefresh.mockImplementation(async () => {
      useBalancesStore.setState({ error: "indexing" });
    });
    const { result } = setup();
    await act(async () => {
      await result.current.submit(review());
    });
    expect(result.current.status).toBe("success");
    expect(result.current.transactionHash).toBe("tx-hash");
  });
  it("discards a late submission response after navigation", async () => {
    let resolveSubmit: (value: string) => void = () => {};
    mockSubmit.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { result, unmount } = setup();
    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.submit(review());
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      resolveSubmit("late-hash");
      await pending;
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("reports a failed deposit to the funnel with Horizon's reason code", async () => {
    mockTrackFail.mockClear();
    mockBuilder = {
      ...mockBuilder,
      submitErrorResultCodes: { operations: ["op_underfunded"] },
    };
    mockSubmit.mockResolvedValue(null);

    const { result } = setup();
    await act(async () => {
      await result.current.submit(review());
    });

    expect(result.current.status).toBe("error");
    expect(mockTrackFail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "op_underfunded" }),
    );
  });
});
