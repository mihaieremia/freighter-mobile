/* eslint-disable @fnando/consistent-import/consistent-import */
import { NavigationContainer } from "@react-navigation/native";
import { act } from "@testing-library/react-native";
import { MIN_TRANSACTION_FEE } from "config/constants";
import { EARN_ROUTES } from "config/routes";
import { useEarnStore } from "ducks/earn";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { renderWithProviders } from "helpers/testUtils";
import { EarnStackNavigator } from "navigators/EarnNavigator";
import React from "react";

const mockClearNetworkFeesCache = jest.fn();

// A stable Screen mock (the global one in jest.setup.js is re-created on
// every `createNativeStackNavigator()` call, so it cannot be reached from
// here) lets the route options be read back after a render. It is built
// inside the factory because the mocked module is required while this file's
// own imports are still evaluating.
jest.mock("@react-navigation/native-stack", () => {
  const screen = jest.fn(() => null);
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: jest.fn(
        ({ children }: { children: React.ReactNode }) => children,
      ),
      Screen: screen,
      Group: jest.fn(),
    }),
    __screen: screen,
  };
});

const { __screen: mockScreen } = jest.requireMock<{ __screen: jest.Mock }>(
  "@react-navigation/native-stack",
);

// The real hook fetches network fees over the network — stub it out so the
// test only exercises the navigator's own mount/unmount wiring, and so we
// can assert on `clearNetworkFeesCache` directly.
jest.mock("hooks/useNetworkFees", () => ({
  useNetworkFees: () => ({
    recommendedFee: "",
    networkCongestion: "low",
    feePresets: {},
  }),
  clearNetworkFeesCache: () => mockClearNetworkFeesCache(),
}));

// `@react-navigation/native-stack` is globally mocked in jest.setup.js
// (Navigator renders children as-is, Screen is a bare jest.fn()), so neither
// EarnTokenPickerScreen nor EarnAmountScreen actually mounts here — this
// test exercises only EarnStackNavigator's own effects.
describe("EarnStackNavigator teardown", () => {
  beforeEach(() => {
    mockClearNetworkFeesCache.mockClear();
    act(() => {
      useTransactionSettingsStore.getState().resetSettings();
      useTransactionBuilderStore.getState().resetTransaction();
      useEarnStore.getState().resetEarn();
    });
  });

  it("resets the shared transaction-settings + builder stores and clears the network-fee cache on unmount", () => {
    // Simulate a fee the user manually customized in a DIFFERENT flow
    // (Send) that shares this same global store — this is exactly the leak
    // scenario the teardown guards against: without it, Earn would silently
    // inherit Send's stale custom inclusion fee.
    act(() => {
      useTransactionSettingsStore.getState().saveTransactionFee("5");
      useTransactionSettingsStore.getState().markFeeManuallyChanged();
      useTransactionBuilderStore.setState({
        transactionXDR: "stale-xdr-from-another-flow",
      });
    });

    const { unmount } = renderWithProviders(
      <NavigationContainer>
        <EarnStackNavigator />
      </NavigationContainer>,
    );

    // Not reset merely by mounting — only on unmount.
    expect(useTransactionSettingsStore.getState().transactionFee).toBe("5");
    expect(useTransactionBuilderStore.getState().transactionXDR).toBe(
      "stale-xdr-from-another-flow",
    );
    expect(mockClearNetworkFeesCache).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(useTransactionSettingsStore.getState().transactionFee).toBe(
      MIN_TRANSACTION_FEE,
    );
    expect(useTransactionSettingsStore.getState().feeManuallyChanged).toBe(
      false,
    );
    expect(useTransactionBuilderStore.getState().transactionXDR).toBeNull();
    expect(mockClearNetworkFeesCache).toHaveBeenCalledTimes(1);
  });

  // FIX 1: prior to this fix, `resetEarn()` was only ever called from the
  // success-Done handler — every other exit (back from the picker, back
  // from Amount, close-while-submitting, error -> back -> out) left the
  // earn duck populated, which meant a stale `lastSubmitFailed` retry banner
  // and (worse) a stale `currentPositionTokens` "before" value could leak
  // into a later, unrelated Earn session. Verifies the teardown clears the
  // duck on every unmount, matching the other two stores above.
  it("resets the earn duck on unmount", () => {
    act(() => {
      useEarnStore.getState().setHub({ id: "CPOOL", name: "Fixed" } as never);
      useEarnStore.getState().selectAsset({
        assetId: "CASSET",
        apy: 0.05,
        code: "USDC",
        decimals: 7,
        hubId: 1,
        spokes: [],
      });
      useEarnStore.getState().setCurrentPositionTokens("5000000000");
    });

    const { unmount } = renderWithProviders(
      <NavigationContainer>
        <EarnStackNavigator />
      </NavigationContainer>,
    );

    // Not reset merely by mounting — only on unmount, same as the stores above.
    expect(useEarnStore.getState().hub).toEqual({
      id: "CPOOL",
      name: "Fixed",
    });
    expect(useEarnStore.getState().currentPositionTokens).toBe("5000000000");

    act(() => {
      unmount();
    });

    const state = useEarnStore.getState();
    expect(state.hub).toBeNull();
    expect(state.selectedAssetId).toBe("");
    expect(state.currentPositionTokens).toBe("0");
  });

  // Every amount screen is reached with the asset in its route params, so
  // each header names it ("Deposit USDC") instead of repeating the flow's
  // own name.
  it.each([
    [EARN_ROUTES.EARN_AMOUNT_SCREEN, "Deposit USDC"],
    [EARN_ROUTES.EARN_WITHDRAW_SCREEN, "Withdraw USDC"],
    [EARN_ROUTES.EARN_REPAY_SCREEN, "Repay USDC"],
  ])("titles %s with the asset it was opened for", (route, expected) => {
    renderWithProviders(
      <NavigationContainer>
        <EarnStackNavigator />
      </NavigationContainer>,
    );

    const screen = mockScreen.mock.calls
      .map(([props]) => props as unknown as Record<string, unknown>)
      .find((props) => props.name === route);

    const options = (
      screen!.options as (arg: {
        route: { params: { tokenCode: string } };
      }) => { headerTitle: string }
    )({ route: { params: { tokenCode: "USDC" } } });

    expect(options.headerTitle).toBe(expected);
  });
});
