/* eslint-disable @fnando/consistent-import/consistent-import */
import { act } from "@testing-library/react-native";
import SwapProcessingScreen from "components/screens/SwapScreen/screens/SwapProcessingScreen";
import { AnalyticsEvent } from "config/analyticsConfig";
import { NETWORKS } from "config/constants";
import { NativeToken } from "config/types";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { renderWithProviders } from "helpers/testUtils";
import React from "react";
import { track } from "services/analytics/core";
import * as stellarServices from "services/stellar";

import { mockUseColors } from "../../../../__mocks__/use-colors";

mockUseColors();

jest.mock("ducks/auth", () => ({
  useAuthenticationStore: jest.fn(() => ({ network: "TESTNET" })),
}));
jest.mock("services/stellar", () => ({
  submitTx: jest.fn(),
  getTransactionDetails: jest.fn().mockResolvedValue(null),
  signTransaction: jest.fn(),
  isHorizonError: jest.fn(() => false),
}));
jest.mock("hooks/useAppTranslation", () => () => ({
  t: (key: string) => key,
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock("components/BottomSheet", () => () => null);
jest.mock(
  "components/screens/SwapScreen/components/SwapTransactionDetailsBottomSheet",
  () => () => null,
);
jest.mock("components/TokenIcon", () => ({ TokenIcon: () => null }));
jest.mock("components/Spinner", () => () => null);
jest.mock("components/layout/BaseLayout", () => ({
  BaseLayout: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("components/sds/Button", () => ({ Button: () => null }));
jest.mock("components/sds/Typography", () => ({
  Display: () => null,
  Text: () => null,
}));
jest.mock("components/sds/Icon", () => ({
  __esModule: true,
  default: new Proxy({}, { get: () => "View" }),
}));

const store = useTransactionBuilderStore;

const token = { type: "native", code: "XLM" } as NativeToken;

/** Every VIEW_SWAP_SUCCESS the screen has reported. */
const successViews = () =>
  (track as jest.Mock).mock.calls.filter(
    ([event, props]) =>
      event === AnalyticsEvent.SCREEN_VIEWED &&
      (props as { screen_name?: string }).screen_name ===
        AnalyticsEvent.VIEW_SWAP_SUCCESS,
  );

const submitStep = (isIntermediate?: boolean) =>
  act(async () => {
    await store
      .getState()
      .submitTransaction({ network: NETWORKS.TESTNET, isIntermediate });
  });

describe("SwapProcessingScreen success reporting when a trustline is sent first", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      store.getState().resetTransaction();
      store.setState({ signedTransactionXDR: "signed-xdr" });
    });
    renderWithProviders(
      <SwapProcessingScreen
        sourceAmount="1"
        sourceToken={token}
        destinationAmount="2"
        destinationToken={token}
      />,
    );
  });

  it("reports no swap success when the swap fails after the trustline landed", async () => {
    (stellarServices.submitTx as jest.Mock).mockResolvedValueOnce({
      hash: "trustline-hash",
      result_xdr: "r",
    });
    await submitStep(true);

    (stellarServices.submitTx as jest.Mock).mockRejectedValueOnce(
      new Error("swap rejected"),
    );
    await submitStep();

    expect(successViews()).toHaveLength(0);
    expect(stellarServices.getTransactionDetails).not.toHaveBeenCalled();
  });

  it("reports the success once, for the swap's own hash", async () => {
    (stellarServices.submitTx as jest.Mock).mockResolvedValueOnce({
      hash: "trustline-hash",
      result_xdr: "r",
    });
    await submitStep(true);
    expect(successViews()).toHaveLength(0);
    (stellarServices.submitTx as jest.Mock).mockResolvedValueOnce({
      hash: "swap-hash",
      result_xdr: "r",
    });
    await submitStep();

    expect(successViews()).toHaveLength(1);
    expect(stellarServices.getTransactionDetails).toHaveBeenCalledTimes(1);
    expect(stellarServices.getTransactionDetails).toHaveBeenCalledWith(
      "swap-hash",
      expect.anything(),
    );
  });
});
