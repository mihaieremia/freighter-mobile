/* eslint-disable @fnando/consistent-import/consistent-import */
import { act, renderHook } from "@testing-library/react-hooks";
import { fireEvent } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { EarnPositionRow } from "components/screens/EarnScreen/components/EarnPositionRow";
import { PositionRiskBadge } from "components/screens/EarnScreen/components/PositionRiskBadge";
import { useEarnActionScreen } from "components/screens/EarnScreen/hooks/useEarnActionScreen";
import { EarnWithdrawScreen } from "components/screens/EarnScreen/screens/EarnWithdrawScreen";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { XoxnoPosition, XoxnoPositionLeg } from "config/xoxnoTypes";
import { renderWithProviders } from "helpers/testUtils";
import React from "react";
import { getNumberFormatSettings } from "react-native-localize";

const mockSimulate = jest.fn().mockResolvedValue(null);
const mockCancel = jest.fn();
const mockReset = jest.fn();
const mockRefetch = jest.fn();
let mockPositions: XoxnoPosition[] | null = null;
let mockError: string | null = null;
jest.mock(
  "components/screens/EarnScreen/hooks/useSimulateEarnTransaction",
  () => ({
    useSimulateEarnWithdraw: () => ({
      simulate: mockSimulate,
      isSimulating: false,
      error: null,
      cancel: mockCancel,
      prepared: null,
    }),
  }),
);
jest.mock("components/screens/EarnScreen/hooks/useEarnPositions", () => ({
  useEarnPositions: () => ({
    positions: mockPositions,
    error: mockError,
    refetch: mockRefetch,
  }),
}));
jest.mock("components/screens/EarnScreen/hooks/useEarnTransaction", () => ({
  useEarnTransaction: () => ({
    status: "idle",
    error: "repayment failed",
    reset: mockReset,
  }),
}));
jest.mock("hooks/useGetActiveAccount", () => ({
  __esModule: true,
  default: () => ({ account: { publicKey: "account" } }),
}));
jest.mock("ducks/auth", () => ({
  useAuthenticationStore: () => ({ network: "TESTNET" }),
}));
const mockReviewSheetDismiss = jest.fn();
jest.mock("components/BottomSheet", () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const ReactModule = require("react");
  // Renders nothing, but fills the caller's modal ref so the screen's own
  // present/dismiss calls are observable.
  const NoopSheet = ({ modalRef }: { modalRef?: React.RefObject<unknown> }) => {
    ReactModule.useImperativeHandle(
      modalRef,
      () => ({ present: jest.fn(), dismiss: mockReviewSheetDismiss }),
      [],
    );
    return null;
  };
  return { __esModule: true, default: NoopSheet };
});
const leg: XoxnoPositionLeg = {
  accountId: "6",
  hubId: 1,
  hubName: "Core",
  assetId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  symbol: "USDC",
  decimals: 7,
  tokens: "1000000000",
  withdrawableTokens: "500000000",
  usdValue: null,
  apy: null,
};
const screenProps = {
  navigation: { goBack: jest.fn() },
  route: {
    params: {
      accountId: leg.accountId,
      hubId: leg.hubId,
      hubName: leg.hubName,
      assetId: leg.assetId,
      tokenCode: "USDC",
      decimals: 7,
      suppliedTokens: leg.tokens,
      withdrawableTokens: leg.withdrawableTokens,
      apy: null,
    },
  },
};
const canonicalParams = (common: {
  senderAddress: string;
  transactionFee: string;
  transactionTimeout: number;
  amount: string;
}) => ({
  ...common,
  hubId: 1,
  assetId: leg.assetId,
  decimals: 7,
  network: NETWORKS.TESTNET,
});
const goBack = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockPositions = null;
  mockError = null;
});
it("separates comma-locale typing from canonical percentage amounts", () => {
  const format = jest.mocked(getNumberFormatSettings);
  format.mockReturnValue({ decimalSeparator: ",", groupingSeparator: "." });
  const { result } = renderHook(() =>
    useEarnActionScreen({
      assetId: leg.assetId,
      tokenCode: "USDC",
      simulate: mockSimulate,
      isSimulating: false,
      cancel: mockCancel,
      prepared: null,
      buildSimulateParams: canonicalParams,
      goBack,
    }),
  );
  act(() => {
    result.current.setAmount("0.125");
  });
  expect(result.current.amount).toBe("0.125");
  expect(result.current.amountDisplay).toBe("0,125");
  act(() => {
    result.current.setAmountFromInput("0,123");
  });
  expect(result.current.amount).toBe("0.123");
  expect(result.current.amountBn.eq(new BigNumber("0.123"))).toBe(true);
  expect(result.current.submissionError).toBe("repayment failed");
  format.mockReturnValue({ decimalSeparator: ".", groupingSeparator: "," });
});
it("keeps withdrawal and Max paused through a failed refresh and pending retry", () => {
  // The fetch has landed and the leg has no bound — an unpriced position,
  // not a pending one. While the fetch is still in flight the screen keeps
  // using the bound the positions list handed it, so nothing pauses.
  mockPositions = [
    {
      accountId: leg.accountId,
      spokeName: null,
      healthFactor: null,
      supply: [{ ...leg, withdrawableTokens: null }],
      borrow: [],
    },
  ] as unknown as typeof mockPositions;
  const { getByTestId, getByText, rerender } = renderWithProviders(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  fireEvent.changeText(getByTestId("earn-withdraw-input"), "1");
  expect(
    getByTestId("earn-withdraw-cta").props.accessibilityState.disabled,
  ).toBe(true);
  expect(getByText(/Withdrawal is paused/)).toBeTruthy();
  mockError = "unavailable";
  rerender(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  mockError = null;
  rerender(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  expect(
    getByTestId("earn-withdraw-cta").props.accessibilityState.disabled,
  ).toBe(true);
  expect(mockSimulate).not.toHaveBeenCalled();
  fireEvent.press(getByText("Try again"));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(getByTestId("percentage-100").props.accessibilityState.disabled).toBe(
    true,
  );
});
it("clears the previous attempt's failure when a new review starts", async () => {
  const { result } = renderHook(() =>
    useEarnActionScreen({
      assetId: leg.assetId,
      tokenCode: "USDC",
      simulate: mockSimulate,
      isSimulating: false,
      cancel: mockCancel,
      prepared: null,
      buildSimulateParams: canonicalParams,
      goBack,
    }),
  );

  // A failed confirm leaves its message on the form. Asking for a new review
  // is a new question, so the old answer is cleared before it is asked.
  expect(result.current.submissionError).toBe("repayment failed");
  mockReset.mockClear();
  await act(async () => {
    await result.current.handleReview();
  });
  expect(mockReset).toHaveBeenCalled();
});
it("shows no paused block while the position refetch is still in flight", () => {
  // Opening the screen used to render the paused block for one frame, until
  // the screen's own fetch resolved — a flash that shifted the layout under
  // the user on every open.
  mockPositions = null;

  const { queryByText, getByTestId } = renderWithProviders(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );

  expect(queryByText(/Withdrawal is paused/)).toBeNull();
  expect(getByTestId("percentage-100").props.accessibilityState.disabled).toBe(
    false,
  );
});
it("uses the same refreshed snapshot for supplied and withdrawable amounts", () => {
  mockPositions = [
    {
      accountId: "6",
      spokeName: "Core",
      healthFactor: 2,
      supply: [
        { ...leg, tokens: "2000000000", withdrawableTokens: "1500000000" },
      ],
      borrow: [],
    },
  ];
  const { getByText, getByTestId } = renderWithProviders(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  fireEvent.press(getByText("Max"));
  expect(getByTestId("earn-withdraw-input").props.value).toBe("149.85");
});
it("renders unknown debt quantity and risk without turning either into zero", () => {
  const { getByText } = renderWithProviders(
    <>
      <EarnPositionRow
        variant="borrow"
        leg={{ ...leg, tokens: null, decimals: null }}
        networkDetails={mapNetworkToNetworkDetails(NETWORKS.TESTNET)}
      />
      <PositionRiskBadge healthFactor={null} hasDebt />
    </>,
  );
  expect(getByText("Amount unavailable")).toBeTruthy();
  expect(getByText("Risk unavailable")).toBeTruthy();
});

it("invalidates Max when supply changes even if the free bound stays equal", () => {
  mockPositions = [
    {
      accountId: "6",
      spokeName: "Core",
      healthFactor: null,
      supply: [
        { ...leg, tokens: "1000000000", withdrawableTokens: "1000000000" },
      ],
      borrow: [],
    },
  ];
  const { getByText, rerender } = renderWithProviders(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  fireEvent.press(getByText("Max"));
  mockCancel.mockClear();
  mockPositions = [
    {
      ...mockPositions[0],
      supply: [
        { ...leg, tokens: "2000000000", withdrawableTokens: "1000000000" },
      ],
    },
  ];
  rerender(
    <EarnWithdrawScreen
      {...(screenProps as unknown as React.ComponentProps<
        typeof EarnWithdrawScreen
      >)}
    />,
  );
  expect(mockCancel).toHaveBeenCalled();
});

it("dismisses a presented review when the polled leg moves under it", () => {
  // Supply interest accrues per ledger, so the leg moves on its own and the
  // prepared review stops describing it. Left presented, the sheet loses its
  // fee row and its Confirm goes dead with nothing saying why.
  mockPositions = [
    {
      accountId: "6",
      spokeName: "Core",
      healthFactor: null,
      supply: [
        { ...leg, tokens: "1000000000", withdrawableTokens: "1000000000" },
      ],
      borrow: [],
    },
  ];
  const props = screenProps as unknown as React.ComponentProps<
    typeof EarnWithdrawScreen
  >;
  const { rerender } = renderWithProviders(<EarnWithdrawScreen {...props} />);
  mockReviewSheetDismiss.mockClear();

  mockPositions = [
    {
      ...mockPositions[0],
      supply: [
        { ...leg, tokens: "1000000123", withdrawableTokens: "1000000123" },
      ],
    },
  ];
  rerender(<EarnWithdrawScreen {...props} />);

  expect(mockReviewSheetDismiss).toHaveBeenCalled();
});

it("preserves Max and refreshes its amount when the whole leg accrues interest", async () => {
  mockPositions = [
    {
      accountId: "6",
      spokeName: "Core",
      healthFactor: null,
      supply: [
        { ...leg, tokens: "1000000000", withdrawableTokens: "1000000000" },
      ],
      borrow: [],
    },
  ];
  const props = screenProps as unknown as React.ComponentProps<
    typeof EarnWithdrawScreen
  >;
  const { getByText, getByTestId, rerender } = renderWithProviders(
    <EarnWithdrawScreen {...props} />,
  );
  fireEvent.press(getByText("Max"));
  mockCancel.mockClear();
  mockPositions = [
    {
      ...mockPositions[0],
      supply: [
        { ...leg, tokens: "1000000010", withdrawableTokens: "1000000010" },
      ],
    },
  ];
  rerender(<EarnWithdrawScreen {...props} />);
  expect(mockCancel).toHaveBeenCalled();
  expect(getByTestId("earn-withdraw-input").props.value).toBe("100.000001");
  // eslint-disable-next-line @typescript-eslint/require-await
  await act(async () => {
    fireEvent.press(getByTestId("earn-withdraw-cta"));
    await Promise.resolve();
  });
  expect(mockSimulate).toHaveBeenCalledWith(
    expect.objectContaining({ amount: "100.000001", withdrawAll: true }),
  );
});

it.each(["restricted", "unavailable"])(
  "requires a new amount when Max becomes %s",
  (state) => {
    mockPositions = [
      {
        accountId: "6",
        spokeName: "Core",
        healthFactor: null,
        supply: [
          { ...leg, tokens: "1000000000", withdrawableTokens: "1000000000" },
        ],
        borrow: [],
      },
    ];
    const props = screenProps as unknown as React.ComponentProps<
      typeof EarnWithdrawScreen
    >;
    const { getByText, getByTestId, rerender } = renderWithProviders(
      <EarnWithdrawScreen {...props} />,
    );
    fireEvent.press(getByText("Max"));
    mockPositions = [
      {
        ...mockPositions[0],
        supply: [
          {
            ...leg,
            tokens: "2000000000",
            withdrawableTokens: state === "restricted" ? "1000000000" : null,
          },
        ],
      },
    ];
    rerender(<EarnWithdrawScreen {...props} />);
    expect(getByTestId("earn-withdraw-input").props.value).toBe("");
    expect(
      getByTestId("earn-withdraw-cta").props.accessibilityState.disabled,
    ).toBe(true);
    expect(mockSimulate).not.toHaveBeenCalled();
  },
);

it("keeps a manually entered partial amount during ordinary accrual", async () => {
  mockPositions = [
    {
      accountId: "6",
      spokeName: "Core",
      healthFactor: null,
      supply: [
        { ...leg, tokens: "1000000000", withdrawableTokens: "1000000000" },
      ],
      borrow: [],
    },
  ];
  const props = screenProps as unknown as React.ComponentProps<
    typeof EarnWithdrawScreen
  >;
  const { getByTestId, rerender } = renderWithProviders(
    <EarnWithdrawScreen {...props} />,
  );
  fireEvent.changeText(getByTestId("earn-withdraw-input"), "25");
  mockPositions = [
    {
      ...mockPositions[0],
      supply: [
        { ...leg, tokens: "1000000010", withdrawableTokens: "1000000010" },
      ],
    },
  ];
  rerender(<EarnWithdrawScreen {...props} />);
  expect(getByTestId("earn-withdraw-input").props.value).toBe("25");
  // eslint-disable-next-line @typescript-eslint/require-await
  await act(async () => {
    fireEvent.press(getByTestId("earn-withdraw-cta"));
    await Promise.resolve();
  });
  expect(mockSimulate).toHaveBeenCalledWith(
    expect.objectContaining({ amount: "25", withdrawAll: false }),
  );
});
