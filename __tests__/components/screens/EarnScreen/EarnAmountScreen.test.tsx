/* eslint-disable @fnando/consistent-import/consistent-import */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fireEvent } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { NATIVE_FEE_ALLOWANCE_XLM } from "components/screens/EarnScreen/helpers";
import EarnAmountScreen from "components/screens/EarnScreen/screens/EarnAmountScreen";
import { EARN_ROUTES, EarnStackParamList } from "config/routes";
import { useEarnStore } from "ducks/earn";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { renderWithProviders } from "helpers/testUtils";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import { useTokenFiatConverter } from "hooks/useTokenFiatConverter";
import React from "react";
import { Keyboard } from "react-native";

import { mockGestureHandler } from "../../../../__mocks__/gesture-handler";
import { mockUseColors } from "../../../../__mocks__/use-colors";

mockGestureHandler();
mockUseColors();

// This is the screen the final whole-branch review flagged as untested
// (FIX 3): it owns the CTA precedence, the fee-gate ordering, the
// clamp/re-simulate sequence, the inline processing gate, and the retry-
// banner lifecycle. It is also where FIX 2 (the ~5,000x-too-low fee-headroom
// gate) actually lives, so the fee-gate tests below double as FIX 2's
// coverage.
//
// Mocking approach modeled on
// __tests__/components/screens/SwapScreen/SwapAmountScreen.test.tsx: a
// stubbed <BottomSheet> that records each sheet's imperative ref (by
// declaration order) instead of rendering `customContent`, so we can assert
// which sheet was presented — and in what order relative to `simulate` —
// without needing to mount the real review/fee/security sheets.

type SheetRefSpy = {
  present: jest.Mock;
  dismiss: jest.Mock;
};
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace, vars-on-top, no-var, no-underscore-dangle, @typescript-eslint/naming-convention
  var __earnAmountMockSheetRefs: SheetRefSpy[];
}
// eslint-disable-next-line no-underscore-dangle
globalThis.__earnAmountMockSheetRefs = [];

jest.mock("components/BottomSheet", () => {
  /* eslint-disable global-require, @typescript-eslint/no-var-requires, @typescript-eslint/no-shadow */
  const ReactModule = require("react");
  const RNModule = require("react-native");
  /* eslint-enable global-require, @typescript-eslint/no-var-requires, @typescript-eslint/no-shadow */

  const NoopSheet = (props: { modalRef?: React.RefObject<unknown> }) => {
    const { modalRef } = props;
    ReactModule.useImperativeHandle(modalRef, () => {
      const spy: SheetRefSpy = { present: jest.fn(), dismiss: jest.fn() };
      // eslint-disable-next-line no-underscore-dangle
      globalThis.__earnAmountMockSheetRefs.push(spy);
      return spy;
    }, []);
    // Don't render customContent — mirrors Swap's stub. The child sheets
    // (fee/review/security) are never mounted, so they need no mocks of
    // their own.
    return ReactModule.createElement(RNModule.View);
  };
  return { __esModule: true, default: NoopSheet };
});

// EarnAmountScreen renders EarnProcessingScreen inline (not a registered
// route) whenever mockEarnTransactionStatus !== "idle". Stub it via the barrel
// it's imported through — EarnAmountScreen itself is imported by its own
// path below, so this mock only affects that one barrel import.
jest.mock("components/screens/EarnScreen/screens", () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const RNModule = require("react-native");
  return {
    EarnProcessingScreen: ({ status }: { status: string }) => (
      <RNModule.View
        testID="earn-processing-mock"
        accessibilityLabel={status}
      />
    ),
  };
});

const mockCancelPreparation = jest.fn();
const mockSimulate = jest.fn();
let mockEarnError: string | null = null;
let mockIsSimulating = false;
const mockSubmitEarnTransaction = jest.fn();
const mockResetEarnTransactionStatus = jest.fn();
const mockAbandonEarnTransaction = jest.fn();

let mockEarnTransactionStatus: "idle" | "submitting" | "success" | "error" =
  "idle";
let mockEarnTransactionHash: string | null = null;

// Settable per-test so the failed-simulation message-swap effect (see
// `EarnAmountScreen`'s `simulateError` useEffect) can be exercised without
// actually driving a rejected `simulate()` call through this mock.
let mockSimulateError: string | null = null;

jest.mock(
  "components/screens/EarnScreen/hooks/useSimulateEarnTransaction",
  () => ({
    useSimulateEarnDeposit: () => ({
      simulate: mockSimulate,
      isSimulating: mockIsSimulating,
      cancel: mockCancelPreparation,
      prepared: null,
      error: mockSimulateError,
      scanResult: undefined,
    }),
  }),
);

jest.mock("components/screens/EarnScreen/hooks/useEarnTransaction", () => ({
  useEarnTransaction: () => ({
    status: mockEarnTransactionStatus,
    transactionHash: mockEarnTransactionHash,
    error: mockEarnError,
    submit: mockSubmitEarnTransaction,
    reset: mockResetEarnTransactionStatus,
    abandon: mockAbandonEarnTransaction,
  }),
}));

jest.mock("components/screens/EarnScreen/hooks/useEarnPosition", () => ({
  useEarnPosition: () => ({ currentPositionTokens: "0" }),
}));

jest.mock("hooks/useGetActiveAccount");
jest.mock("hooks/useTokenFiatConverter");

jest.mock("hooks/useNetworkFees", () => ({
  useNetworkFees: () => ({
    recommendedFee: "",
    networkCongestion: "low",
    feePresets: {},
  }),
  clearNetworkFeesCache: jest.fn(),
}));

jest.mock("hooks/useInitialRecommendedFee", () => ({
  useInitialRecommendedFee: jest.fn(),
}));

const mockCalculateSpendableAmount = jest.fn();
const mockGetBalanceByContractId = jest.fn();
jest.mock("helpers/balances", () => ({
  // Real implementation for everything else — `TokenIcon`/`TokenIconWithBadge`
  // (rendered by the real, unmocked `AmountCard`) reach into this module too
  // (`isLiquidityPool`, `getTokenIdentifier`), and a full replacement would
  // silently drop those.
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  ...jest.requireActual("helpers/balances"),
  calculateSpendableAmount: (...args: unknown[]) =>
    mockCalculateSpendableAmount(...args),
  getBalanceByContractId: (...args: unknown[]) =>
    mockGetBalanceByContractId(...args),
}));

jest.mock("ducks/auth", () => ({
  useAuthenticationStore: () => ({ network: "TESTNET" }),
}));

// eslint-disable-next-line prefer-const
let mockPricedBalances: Record<string, unknown> = {};
jest.mock("ducks/balances", () => ({
  useBalancesStore: () => ({ pricedBalances: mockPricedBalances }),
}));

jest.mock("ducks/debug", () => ({
  useDebugStore: () => ({ overriddenBlockaidResponse: undefined }),
}));

jest.mock("services/blockaid/helper", () => ({
  assessTransactionSecurity: () => ({
    isMalicious: false,
    isSuspicious: false,
    isUnableToScan: false,
  }),
  extractSecurityWarnings: () => [],
}));

const mockShowToast = jest.fn();
jest.mock("providers/ToastProvider", () => {
  /* eslint-disable global-require, @typescript-eslint/no-var-requires */
  const ReactModule = require("react");
  const RNModule = require("react-native");
  /* eslint-enable global-require, @typescript-eslint/no-var-requires */
  return {
    ToastProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(RNModule.View, null, children),
    useToast: () => ({ showToast: mockShowToast }),
  };
});

// Plain-key translation, matching the established pattern in
// TransactionAmountScreen.test.tsx — assertions target the i18n key itself
// rather than locale copy.
jest.mock("hooks/useAppTranslation", () => ({
  __esModule: true,
  default: () => ({ t: (key: string) => key }),
}));

const USDC_ASSET_ID =
  "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const POOL_ID = "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";

const USDC_BALANCE = {
  id: USDC_ASSET_ID,
  contractId: USDC_ASSET_ID,
  token: { code: "USDC", type: "credit_alphanum4" },
  total: new BigNumber("1000"),
  available: new BigNumber("1000"),
  currentPrice: new BigNumber("1"),
} as never;

const XLM_BALANCE = {
  id: "XLM",
  token: { type: "native", code: "XLM" },
  total: new BigNumber("10"),
  available: new BigNumber("10"),
} as never;

type Props = NativeStackScreenProps<
  EarnStackParamList,
  typeof EARN_ROUTES.EARN_AMOUNT_SCREEN
>;

const makeNavigation = () =>
  ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    reset: jest.fn(),
  }) as unknown as Props["navigation"];

const makeRoute = () =>
  ({
    key: "earn-amount",
    name: EARN_ROUTES.EARN_AMOUNT_SCREEN,
    params: { assetId: USDC_ASSET_ID, tokenCode: "USDC" },
  }) as unknown as Props["route"];

/**
 * Configures the two `calculateSpendableAmount` call sites EarnAmountScreen
 * makes: once for the deposit asset (drives `maxDepositable`) and once for
 * XLM (drives the fee-headroom check). When the deposit asset IS XLM, both
 * calls target the same balance object, so `xlm` wins for both — matching
 * production, where there is only one balance to ask.
 */
const setSpendable = ({ deposit, xlm }: { deposit: string; xlm: string }) => {
  mockCalculateSpendableAmount.mockImplementation(
    ({ balance }: { balance: unknown }) =>
      balance === XLM_BALANCE ? new BigNumber(xlm) : new BigNumber(deposit),
  );
};

const setTokenAmount = (
  tokenAmount: string,
  overrides: Record<string, unknown> = {},
) => {
  (useTokenFiatConverter as jest.Mock).mockReturnValue({
    tokenAmount,
    tokenAmountDisplay: tokenAmount,
    tokenAmountDisplayRaw: null,
    fiatAmount: "0",
    fiatAmountDisplay: "0",
    fiatAmountDisplayRaw: null,
    showFiatAmount: false,
    pasteRejectNonce: 0,
    setTokenAmount: jest.fn(),
    setFiatAmount: jest.fn(),
    setShowFiatAmount: jest.fn(),
    setDisplayAmountFromText: jest.fn(),
    updateFiatDisplay: jest.fn(),
    ...overrides,
  });
};

describe("EarnAmountScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line no-underscore-dangle
    globalThis.__earnAmountMockSheetRefs = [];
    mockEarnTransactionStatus = "idle";
    mockEarnError = null;
    mockIsSimulating = false;
    mockEarnTransactionHash = null;
    mockSimulateError = null;
    mockPricedBalances = { XLM: XLM_BALANCE, [USDC_ASSET_ID]: USDC_BALANCE };

    useEarnStore.getState().resetEarn();
    useEarnStore.getState().setHub({ id: POOL_ID, name: "Fixed" } as never);
    useEarnStore.getState().selectAsset({
      assetId: USDC_ASSET_ID,
      apy: 0.1694,
      code: "USDC",
      decimals: 7,
      hubId: 1,
      spokes: [
        {
          id: 1,
          name: "Blue Chip",
          loanToValueBps: 7500,
          liquidationThresholdBps: 7800,
        },
      ],
    });

    useTransactionSettingsStore.getState().resetSettings();
    useTransactionBuilderStore.getState().resetTransaction();

    (useGetActiveAccount as jest.Mock).mockReturnValue({
      account: {
        publicKey: "GSENDER",
        privateKey: "SPRIVATE",
        subentryCount: 0,
      },
    });

    mockGetBalanceByContractId.mockReturnValue(USDC_BALANCE);
    // Generous defaults: enough of both assets that no guard fires unless a
    // test deliberately narrows it.
    setSpendable({ deposit: "1000", xlm: "10" });
    setTokenAmount("10");

    mockSimulate.mockResolvedValue({
      preparedXdr: "prepared-xdr",
      scanResult: undefined,
    });
  });

  const renderScreen = () =>
    renderWithProviders(
      <EarnAmountScreen navigation={makeNavigation()} route={makeRoute()} />,
    );

  describe("CTA state machine", () => {
    it("locks input and percentage controls while preparation is pending", () => {
      mockIsSimulating = true;
      const { getByTestId } = renderScreen();
      expect(getByTestId("earn-amount-input").props.editable).toBe(false);
      expect(
        getByTestId("earn-amount-cta").props.accessibilityState?.disabled,
      ).toBe(true);
    });

    it("disables the CTA with 'insufficient' when the spendable balance is zero", () => {
      setSpendable({ deposit: "0", xlm: "10" });
      setTokenAmount("0");

      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      expect(cta).toHaveTextContent("earnAmount.insufficientFunds");
      expect(cta.props.accessibilityState?.disabled).toBe(true);
    });

    it("disables the CTA with 'enter' when the amount is zero", () => {
      setTokenAmount("0");

      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      expect(cta).toHaveTextContent("earnAmount.enterAmount");
      expect(cta.props.accessibilityState?.disabled).toBe(true);
    });

    it("disables the CTA with 'insufficient' when the amount exceeds the max depositable", () => {
      setSpendable({ deposit: "10", xlm: "10" });
      setTokenAmount("9999");

      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      expect(cta).toHaveTextContent("earnAmount.insufficientFunds");
      expect(cta.props.accessibilityState?.disabled).toBe(true);
    });

    it("enables the CTA with 'review' once a valid amount is entered", () => {
      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      expect(cta).toHaveTextContent("earnAmount.review");
      expect(cta.props.accessibilityState?.disabled).toBeFalsy();
    });

    it("holds the invoke's own fee back from an XLM deposit, so Max survives review", () => {
      // `calculateSpendableAmount` only nets out the inclusion fee, but
      // `assertEarnFeeAffordable` re-checks the whole PREPARED fee -- the
      // ~0.0546 XLM resource fee included -- against what the deposit leaves.
      // Offering the raw spendable balance made every Max XLM deposit throw
      // "Not enough available XLM" after the user had waited out simulation.
      const setTokenAmountSpy = jest.fn();
      mockGetBalanceByContractId.mockReturnValue(XLM_BALANCE);
      setSpendable({ deposit: "100", xlm: "100" });
      setTokenAmount("100", { setTokenAmount: setTokenAmountSpy });

      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      // The whole spendable balance is now over the bound...
      expect(cta).toHaveTextContent("earnAmount.insufficientFunds");
      expect(cta.props.accessibilityState?.disabled).toBe(true);

      // ...and Max offers the allowance-adjusted figure instead.
      fireEvent.press(getByTestId("percentage-100"));
      expect(setTokenAmountSpy).toHaveBeenCalledWith(
        new BigNumber("100").minus(NATIVE_FEE_ALLOWANCE_XLM).toFixed(),
      );
    });

    it("holds nothing back when the deposit asset is not XLM", () => {
      // The fee comes out of an XLM balance a USDC deposit never touches, so
      // the whole spendable balance stays depositable.
      setSpendable({ deposit: "1000", xlm: "10" });
      setTokenAmount("1000");

      const { getByTestId } = renderScreen();
      const cta = getByTestId("earn-amount-cta");

      expect(cta).toHaveTextContent("earnAmount.review");
      expect(cta.props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  describe("fee-headroom gate", () => {
    it("opens the fee sheet BEFORE calling simulate when the account has no spendable XLM at all", async () => {
      // The 0.5 XLM buffer is gone, so this pre-simulation gate now only
      // needs to catch a zero-XLM account -- anything else clears it and is
      // caught post-simulation instead (see "post-simulation fee shortfall"
      // below), once the real resource fee is known.
      setSpendable({ deposit: "1000", xlm: "0" });
      setTokenAmount("10");

      const { getByTestId } = renderScreen();

      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();

      // eslint-disable-next-line no-underscore-dangle
      const [feeSheet] = globalThis.__earnAmountMockSheetRefs;
      expect(feeSheet.present).toHaveBeenCalledTimes(1);
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("does not trip the gate once there is any spendable XLM, even far less than a XOXNO supply's resource fee", async () => {
      // A USDC deposit spends no XLM, so the gate only has to establish that
      // SOME XLM is there; whether it covers the real fee is settled by the
      // final check on the prepared transaction.
      setSpendable({ deposit: "1000", xlm: "0.01" });
      setTokenAmount("10");

      useTransactionBuilderStore.setState({ sorobanResourceFeeXlm: "0.01" });

      const { getByTestId } = renderScreen();

      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();
      await Promise.resolve();

      // eslint-disable-next-line no-underscore-dangle
      const [feeSheet] = globalThis.__earnAmountMockSheetRefs;
      expect(feeSheet.present).not.toHaveBeenCalled();
      expect(mockSimulate).toHaveBeenCalledTimes(1);
    });
  });

  describe("post-simulation fee shortfall", () => {
    it("does not open review when the shared final-fee check rejects preparation", async () => {
      mockSimulate.mockResolvedValue(null);
      const { getByTestId } = renderScreen();
      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();
      // eslint-disable-next-line no-underscore-dangle
      const [, reviewSheet] = globalThis.__earnAmountMockSheetRefs;
      expect(reviewSheet.present).not.toHaveBeenCalled();
    });

    it("drops the keyboard before the review opens, so it cannot edit the amount behind it", async () => {
      // The amount input still holds focus when Review is presented. Left
      // focused, the numeric keyboard stays up over the sheet and every
      // keystroke keeps editing the amount BEHIND it — including the figure
      // the sheet is showing, which then no longer describes the staged XDR
      // that Confirm submits.
      const dismissSpy = jest.spyOn(Keyboard, "dismiss");
      mockGetBalanceByContractId.mockReturnValue(XLM_BALANCE);
      setSpendable({ deposit: "100", xlm: "100" });
      setTokenAmount("10");

      const { getByTestId } = renderScreen();

      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();
      await Promise.resolve();

      expect(dismissSpy).toHaveBeenCalled();
      dismissSpy.mockRestore();
    });
  });

  describe("failed-simulation message", () => {
    it("replaces a balance rejection on an XLM deposit with the fee-specific message", () => {
      mockGetBalanceByContractId.mockReturnValue(XLM_BALANCE);
      setSpendable({ deposit: "100", xlm: "100" });
      mockSimulateError =
        "host invocation failed: HostError: Error(Contract, #10)";

      renderScreen();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "earnAmount.errors.insufficientBalanceForFee",
        }),
      );
    });

    it("keeps the hub's own rejection for a non-balance failure on an XLM deposit", () => {
      mockGetBalanceByContractId.mockReturnValue(XLM_BALANCE);
      setSpendable({ deposit: "100", xlm: "100" });
      mockSimulateError = "hub is frozen";

      renderScreen();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "hub is frozen" }),
      );
    });

    it("toasts an identical failure again once the error has cleared in between", () => {
      // Editing the amount cancels preparation, which clears `simulateError`.
      // A retry that fails the same way -- a hub still over its supply cap --
      // must toast again: the screen shows no inline simulate error, so a
      // suppressed duplicate leaves the CTA spinning and nothing else.
      mockSimulateError = "supply cap exceeded";
      const props = {
        navigation: makeNavigation(),
        route: makeRoute(),
      };
      const { rerender } = renderWithProviders(<EarnAmountScreen {...props} />);
      expect(mockShowToast).toHaveBeenCalledTimes(1);

      mockSimulateError = null;
      rerender(<EarnAmountScreen {...props} />);

      mockSimulateError = "supply cap exceeded";
      rerender(<EarnAmountScreen {...props} />);

      expect(mockShowToast).toHaveBeenCalledTimes(2);
    });

    it("keeps the hub's own rejection for a non-XLM deposit even on a balance-shaped message", () => {
      // USDC is this suite's default deposit asset -- a fee-specific reword
      // would be wrong here since the fee comes from a separate XLM balance.
      mockSimulateError = "Error(Contract, #10)";

      renderScreen();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error(Contract, #10)" }),
      );
    });
  });

  describe("simulate -> Review ordering", () => {
    it("opens Review only after simulate resolves successfully", async () => {
      mockSimulate.mockResolvedValue({
        preparedXdr: "prepared-xdr",
        scanResult: undefined,
      });
      useTransactionBuilderStore.setState({ sorobanResourceFeeXlm: "0.01" });

      const { getByTestId } = renderScreen();

      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSimulate).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line no-underscore-dangle
      const [, reviewSheet] = globalThis.__earnAmountMockSheetRefs;
      expect(reviewSheet.present).toHaveBeenCalledTimes(1);
    });

    it("does not open Review when simulate fails", async () => {
      mockSimulate.mockResolvedValue(null);

      const { getByTestId } = renderScreen();

      await fireEvent.press(getByTestId("earn-amount-cta"));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSimulate).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line no-underscore-dangle
      const [, reviewSheet] = globalThis.__earnAmountMockSheetRefs;
      expect(reviewSheet.present).not.toHaveBeenCalled();
    });
  });

  describe("inline processing gate", () => {
    it("renders the processing screen inline while status is submitting", () => {
      mockEarnTransactionStatus = "submitting";

      const { getByTestId, queryByTestId } = renderScreen();

      expect(getByTestId("earn-processing-mock")).toBeTruthy();
      expect(queryByTestId("earn-amount-screen")).toBeNull();
    });

    it("renders the processing screen inline while status is success", () => {
      mockEarnTransactionStatus = "success";

      const { getByTestId, queryByTestId } = renderScreen();

      expect(getByTestId("earn-processing-mock")).toBeTruthy();
      expect(queryByTestId("earn-amount-screen")).toBeNull();
    });

    it("renders the normal amount screen while status is idle", () => {
      const { getByTestId, queryByTestId } = renderScreen();

      expect(getByTestId("earn-amount-screen")).toBeTruthy();
      expect(queryByTestId("earn-processing-mock")).toBeNull();
    });

    // Design node `9599:40192` has no dedicated failure screen: on failure
    // the user lands directly back on the amount screen, where the retry
    // banner (driven by `lastSubmitFailed`, not by this local status) takes
    // over. `handleEarnProcessingBackToAmount` used to be wired to a button
    // on the now-removed failure screen; it is called automatically instead.
    it("renders the normal amount screen (not the processing screen) when status is error", () => {
      mockEarnTransactionStatus = "error";

      const { getByTestId, queryByTestId } = renderScreen();

      expect(getByTestId("earn-amount-screen")).toBeTruthy();
      expect(queryByTestId("earn-processing-mock")).toBeNull();
      expect(mockResetEarnTransactionStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry banner lifecycle", () => {
    it("shows the originating error and resets it on an amount edit", () => {
      mockEarnError = "op_underfunded";

      const { getByText, rerender } = renderScreen();

      expect(getByText("earnAmount.retryBanner")).toBeTruthy();

      // Simulate the user editing the amount: the tokenAmount the screen
      // reads changes across a re-render of the SAME mounted instance.
      setTokenAmount("5");
      rerender(
        <EarnAmountScreen navigation={makeNavigation()} route={makeRoute()} />,
      );

      expect(mockResetEarnTransactionStatus).toHaveBeenCalled();
    });

    it("does not show an unrelated retry banner", () => {
      const { queryByText } = renderScreen();

      expect(queryByText("earnAmount.retryBanner")).toBeNull();
    });
  });
});
