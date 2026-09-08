import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { fireEvent } from "@testing-library/react-native";
import { HubDetailsBottomSheet } from "components/screens/EarnScreen/components/HubDetailsBottomSheet";
import { XoxnoHub, XoxnoHubReserve } from "config/xoxnoTypes";
import { renderWithProviders } from "helpers/testUtils";
import React from "react";

const buildReserve = (assetId: string, symbol: string): XoxnoHubReserve => ({
  assetId,
  symbol,
  name: symbol,
  decimals: 7,
  supplyApy: null,
  suppliedUsd: null,
});

// A hub with nulls across every unpriced field — the COMMON case for a hub
// whose markets have no fresh oracle price, not an edge case. Its id has no
// description entry either.
const nullHeavyHub: XoxnoHub = {
  id: 9,
  name: "XOXNO Hub 9",
  suppliedUsd: null,
  interestApy: null,
  reserves: [],
};

// A hub with a genuine zero, which must never collapse into the same "--" as
// an unpriced null.
const zeroHub: XoxnoHub = {
  ...nullHeavyHub,
  suppliedUsd: 0,
};

// The pinned hub — has a description entry and fully priced figures,
// including a supply-side rate that legitimately exceeds 1 (a decimal
// fraction, not a pre-multiplied percentage).
const mainHub: XoxnoHub = {
  id: 1,
  name: "XOXNO Hub 1",
  suppliedUsd: 40385476.30883376,
  interestApy: 3.9199825260259216,
  reserves: [],
};

describe("HubDetailsBottomSheet", () => {
  it("renders nothing when the hub hasn't resolved yet", () => {
    const { queryByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={null} />,
    );
    expect(queryByTestId("hub-details-close")).toBeNull();
  });

  it("renders '--' for every unpriced figure", () => {
    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={nullHeavyHub} />,
    );
    expect(getByTestId("hub-details-lendingInterest")).toHaveTextContent("--");
    expect(getByTestId("hub-details-supplied")).toHaveTextContent("--");
  });

  it("renders a real zero as $0.00, distinctly from unpriced", () => {
    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={zeroHub} />,
    );
    expect(getByTestId("hub-details-supplied")).toHaveTextContent("$0.00");
  });

  it("renders no description for a hub with no catalog entry", () => {
    const { queryByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={nullHeavyHub} />,
    );
    expect(queryByTestId("hub-details-description")).toBeNull();
  });

  it("renders the hub name and formatted figures for a fully-priced hub", () => {
    const { getByText, getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} />,
    );
    expect(getByText("XOXNO Hub 1")).toBeTruthy();
    expect(getByTestId("hub-details-lendingInterest")).toHaveTextContent(
      "392.00%",
    );
    expect(getByTestId("hub-details-supplied")).toHaveTextContent("$40.39M");
  });

  it("renders the hub's own name directly in the header, and a separate 'Hub Details' eyebrow above the stat cards", () => {
    // Updated for the design correction (`9448:18518`): the header itself
    // still has no eyebrow stacked directly above the hub name -- but
    // unlike before, the sheet now has a "Hub Details" eyebrow of its own,
    // positioned above the two stat cards rather than the header.
    const { getByText } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} />,
    );
    expect(getByText("XOXNO Hub 1").props.children).toBe("XOXNO Hub 1");
    expect(getByText("Hub Details")).toBeTruthy();
    expect(getByText("by XOXNO")).toBeTruthy();
  });

  it("renders the hub description for a hub id present in the catalog", () => {
    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} />,
    );
    expect(getByTestId("hub-details-description")).toHaveTextContent(
      /isolated liquidity hub/i,
    );
  });

  it("renders '--' for Accepted tokens when the reserve list is empty", () => {
    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} />,
    );
    expect(getByTestId("hub-details-acceptedTokens")).toHaveTextContent("--");
  });

  it("renders an icon stack (no '+N' trailer) for a reserve list at or under the visible cap", () => {
    const hubWithReserves: XoxnoHub = {
      ...mainHub,
      reserves: [
        buildReserve("CUSDC...", "USDC"),
        buildReserve("CEURC...", "EURC"),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={hubWithReserves} />,
    );
    expect(getByTestId("hub-details-acceptedTokens")).toBeTruthy();
    expect(queryByTestId("hub-details-acceptedTokens-overflow")).toBeNull();
  });

  it("collapses reserves beyond the visible cap into a '+N' trailer", () => {
    const hubWithManyReserves: XoxnoHub = {
      ...mainHub,
      reserves: [
        buildReserve("C1...", "AAA"),
        buildReserve("C2...", "BBB"),
        buildReserve("C3...", "CCC"),
        buildReserve("C4...", "DDD"),
        buildReserve("C5...", "EEE"),
        buildReserve("C6...", "FFF"),
      ],
    };
    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={hubWithManyReserves} />,
    );
    // 6 reserves, 4 visible -> "+2".
    expect(
      getByTestId("hub-details-acceptedTokens-overflow"),
    ).toHaveTextContent("+2");
  });

  it("the close button dismisses the sheet via the forwarded ref", () => {
    const dismissMock = jest.fn();
    const ref = React.createRef<BottomSheetModal>();
    Object.defineProperty(ref, "current", {
      value: { dismiss: dismissMock },
      writable: true,
    });

    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} bottomSheetModalRef={ref} />,
    );
    fireEvent.press(getByTestId("hub-details-close"));
    expect(dismissMock).toHaveBeenCalled();
  });

  it("the bottom 'Close' CTA also dismisses the sheet via the forwarded ref", () => {
    const dismissMock = jest.fn();
    const ref = React.createRef<BottomSheetModal>();
    Object.defineProperty(ref, "current", {
      value: { dismiss: dismissMock },
      writable: true,
    });

    const { getByTestId } = renderWithProviders(
      <HubDetailsBottomSheet hub={mainHub} bottomSheetModalRef={ref} />,
    );
    fireEvent.press(getByTestId("hub-details-close-cta"));
    expect(dismissMock).toHaveBeenCalled();
  });
});
