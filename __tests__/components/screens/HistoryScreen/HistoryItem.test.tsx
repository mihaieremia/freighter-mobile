import { fireEvent, render } from "@testing-library/react-native";
import HistoryItem from "components/screens/HistoryScreen/HistoryItem";
import {
  mapHistoryItemData,
  mapInstantXoxnoHistoryItem,
} from "components/screens/HistoryScreen/mappers";
import { PUBLIC_NETWORK_DETAILS } from "config/constants";
import React from "react";

jest.mock("components/screens/HistoryScreen/mappers", () => ({
  mapHistoryItemData: jest.fn(),
  mapInstantXoxnoHistoryItem: jest.fn(),
}));
jest.mock("hooks/useColors", () => ({
  __esModule: true,
  default: () => ({
    themeColors: { text: { primary: "black" }, status: { success: "green" } },
  }),
}));
jest.mock("components/screens/HistoryScreen/helpers", () => ({
  renderIconComponent: () => null,
  renderActionIcon: () => null,
}));

it("renders and opens XOXNO details immediately without starting asynchronous row mapping", () => {
  const transactionDetails = { swapDetails: { destinationAmount: "" } };
  (mapInstantXoxnoHistoryItem as jest.Mock).mockReturnValue({
    transactionDetails,
    rowText: "IN to OUT",
    amountText: "-123 base units IN",
  });
  (mapHistoryItemData as jest.Mock).mockImplementation(
    () => new Promise(() => {}),
  );
  const onOpen = jest.fn();
  const { getByText, queryByTestId } = render(
    <HistoryItem
      operation={{ id: "1" }}
      accountBalances={{}}
      publicKey="viewer"
      networkDetails={PUBLIC_NETWORK_DETAILS}
      handleTransactionDetails={onOpen}
    />,
  );
  expect(queryByTestId("spinner")).toBeNull();
  expect(getByText("-123 base units IN")).toBeTruthy();
  fireEvent.press(getByText("IN to OUT"));
  expect(onOpen).toHaveBeenCalledWith(transactionDetails);
  expect(mapHistoryItemData).not.toHaveBeenCalled();
});
