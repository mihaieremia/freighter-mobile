/* eslint-disable @fnando/consistent-import/consistent-import */
import { userEvent } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { EarnReviewBottomSheet } from "components/screens/EarnScreen/components/EarnReviewBottomSheet";
import { useEarnStore } from "ducks/earn";
import { renderWithProviders } from "helpers/testUtils";
import React from "react";
import { SecurityLevel } from "services/blockaid/constants";
import { createSecurityAssessment } from "services/blockaid/helper";

import { mockGestureHandler } from "../../../../__mocks__/gesture-handler";
import { mockUseColors } from "../../../../__mocks__/use-colors";

mockGestureHandler();
mockUseColors();

// A `contractId` field matches `getBalanceByContractId`'s first (Soroban)
// branch by direct equality — no need to replicate its classic-asset SAC
// derivation (which calls into the real Stellar SDK) just to satisfy a mock.
const MOCK_DEPOSIT_ASSET_ID =
  "CDEPOSITTESTASSETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mockDepositBalance = {
  id: MOCK_DEPOSIT_ASSET_ID,
  contractId: MOCK_DEPOSIT_ASSET_ID,
  token: { code: "USDC", type: "" },
  total: new BigNumber("100"),
  available: new BigNumber("100"),
  tokenCode: "USDC",
  displayName: "USDC",
  imageUrl: "",
  currentPrice: new BigNumber("2"),
  percentagePriceChange24h: new BigNumber("0"),
  fiatCode: "USD",
  fiatTotal: "200",
};

jest.mock("ducks/auth", () => ({
  useAuthenticationStore: jest.fn(() => ({
    network: "TESTNET",
    verifyActionWithBiometrics: jest.fn((callback: () => void) => callback()),
  })),
}));

jest.mock("ducks/balances", () => ({
  useBalancesStore: jest.fn(() => ({
    pricedBalances: { [MOCK_DEPOSIT_ASSET_ID]: mockDepositBalance },
  })),
}));

// Selector-style mock (matches how the component reads this store) —
// mirrors the pattern in useSimulateEarnDeposit.test.ts.
jest.mock("ducks/transactionBuilder", () => ({
  useTransactionBuilderStore: (
    selector?: (state: Record<string, unknown>) => unknown,
  ) => {
    const state = {
      sorobanInclusionFeeXlm: "0.00001",
      sorobanResourceFeeXlm: "0.05463",
    };
    return selector ? selector(state) : state;
  },
}));

const safe = createSecurityAssessment(SecurityLevel.SAFE);
const malicious = createSecurityAssessment(SecurityLevel.MALICIOUS);
const suspicious = createSecurityAssessment(SecurityLevel.SUSPICIOUS);
const unableToScan = createSecurityAssessment(SecurityLevel.UNABLE_TO_SCAN);

describe("EarnReviewBottomSheet", () => {
  const defaultProps = {
    bottomSheetModalRef: {
      current: { dismiss: jest.fn(), present: jest.fn() },
    } as never,
    tokenAmount: "10",
    canConfirm: true,
    transactionSecurityAssessment: safe,
    onSecurityWarningPress: jest.fn(),
    onConfirm: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useEarnStore.getState().resetEarn();
    useEarnStore.getState().setHub({ id: "CPOOL", name: "Fixed Hub" } as never);
    useEarnStore.getState().selectAsset({
      assetId: MOCK_DEPOSIT_ASSET_ID,
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
  });

  // The fee no longer renders on the face of the sheet (design `9448:29319`,
  // correction R7) -- it lives behind the "Transaction details" row, which
  // this test checks for instead of a face-visible fee value.
  it("renders the hub name and APY, with fee behind Transaction details", () => {
    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(getByTestId("earn-review-hub").props.children).toBe("Fixed Hub");
    expect(getByTestId("earn-review-apy").props.children).toBe("16.94%");
    expect(getByTestId("earn-review-transaction-details")).toBeTruthy();
  });

  it("renders a 0 -> n before/after for a first deposit", () => {
    // currentPositionTokens defaults to "0" after resetEarn().
    const { getByText } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(getByText(/0\.00 USDC.*10\.00 USDC/)).toBeTruthy();
  });

  it("rounds the position to the deposit's own precision", () => {
    // 562.0005101 USDC held, 5 deposited. Rendering the balance at full
    // precision beside a two-decimal deposit is noise, and it is what made
    // this row wide enough to squeeze its label onto three lines.
    useEarnStore.getState().setCurrentPositionTokens("5620005101");
    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} tokenAmount="5" />,
    );

    expect(getByTestId("earn-review-position").props.children).toMatch(
      /^562\.00 USDC.*567\.00 USDC$/,
    );
  });

  it("keeps the decimals a small deposit actually needs", () => {
    // The rule scales with the deposit rather than truncating at two: a
    // deposit smaller than a cent must still be visible in the before/after.
    useEarnStore.getState().setCurrentPositionTokens("5620005101");
    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} tokenAmount="0.0000005" />,
    );

    expect(getByTestId("earn-review-position").props.children).toMatch(
      /562\.0005101 USDC.*562\.0005106 USDC/,
    );
  });

  it("renders a non-zero before value for a top-up", () => {
    // Raw integer string at 7 decimals -> 500.00 display units.
    useEarnStore.getState().setCurrentPositionTokens("5000000000");

    const { getByText } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(getByText(/500\.00 USDC.*510\.00 USDC/)).toBeTruthy();
  });

  it("projects before/after earnings off the total position, not the deposit alone", () => {
    // 500 USDC already supplied (price $2) plus a 10 USDC top-up (also
    // price $2) at 16.94% APY: before = $1000 at the rate, after = $1020.
    // If this instead projected off the bare $20 deposit, "after" would
    // read far lower than "before" -- earnings appearing to drop after
    // depositing more would be actively misleading.
    useEarnStore.getState().setCurrentPositionTokens("5000000000");

    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(getByTestId("earn-review-monthly").props.children).toBe(
      "$14.12 → $14.40",
    );
    expect(getByTestId("earn-review-yearly").props.children).toBe(
      "$169.40 → $172.79",
    );
  });

  it("renders '--' for APY and projected earnings when the rate is unknown", () => {
    useEarnStore.getState().selectAsset({
      assetId: MOCK_DEPOSIT_ASSET_ID,
      apy: null,
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

    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(getByTestId("earn-review-apy").props.children).toBe("--");
    expect(getByTestId("earn-review-monthly").props.children).toBe("--");
    expect(getByTestId("earn-review-yearly").props.children).toBe("--");
  });

  it("shows the malicious banner and forwards a tap to onSecurityWarningPress", async () => {
    const user = userEvent.setup();
    const onSecurityWarningPress = jest.fn();

    const { getByText } = renderWithProviders(
      <EarnReviewBottomSheet
        {...defaultProps}
        transactionSecurityAssessment={malicious}
        onSecurityWarningPress={onSecurityWarningPress}
      />,
    );

    const banner = getByText("This address was flagged as malicious");
    expect(banner).toBeTruthy();

    await user.press(banner);
    expect(onSecurityWarningPress).toHaveBeenCalledTimes(1);
  });

  it("shows the suspicious banner", () => {
    const { getByText } = renderWithProviders(
      <EarnReviewBottomSheet
        {...defaultProps}
        transactionSecurityAssessment={suspicious}
      />,
    );

    expect(getByText("This address was flagged as suspicious")).toBeTruthy();
  });

  it("shows the proceed-with-caution banner when the scan was unavailable (e.g. testnet)", () => {
    const { getByText } = renderWithProviders(
      <EarnReviewBottomSheet
        {...defaultProps}
        transactionSecurityAssessment={unableToScan}
      />,
    );

    expect(getByText("Proceed with caution")).toBeTruthy();
  });

  it("does not show a banner for a safe assessment", () => {
    const { queryByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} />,
    );

    expect(queryByTestId("security-warning-banner")).toBeNull();
  });

  it("dismisses and confirms on the trusted Confirm button", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const bottomSheetModalRef = {
      current: { dismiss: jest.fn(), present: jest.fn() },
    } as never;

    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet
        {...defaultProps}
        bottomSheetModalRef={bottomSheetModalRef}
        onConfirm={onConfirm}
      />,
    );

    await user.press(getByTestId("earn-review-confirm-button"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("dismisses without confirming on Cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();

    const { getByTestId } = renderWithProviders(
      <EarnReviewBottomSheet {...defaultProps} onConfirm={onConfirm} />,
    );

    await user.press(getByTestId("earn-review-cancel-button"));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("offers a Confirm Anyway text button instead of a plain Confirm when malicious", () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <EarnReviewBottomSheet
        {...defaultProps}
        transactionSecurityAssessment={malicious}
      />,
    );

    expect(getByTestId("earn-review-confirm-anyway-button")).toBeTruthy();
    expect(queryByTestId("earn-review-confirm-button")).toBeNull();
  });
});
