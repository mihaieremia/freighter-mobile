import { BottomSheetModal } from "@gorhom/bottom-sheet";
import BottomSheet from "components/BottomSheet";
import { Text } from "components/sds/Typography";
import { renderWithProviders } from "helpers/testUtils";
import React from "react";

describe("BottomSheet", () => {
  it("closes itself when the screen that owns it goes away", () => {
    // A presented sheet renders through the modal provider's portal, which
    // sits above the navigator, and the library registers no unmount handler
    // of its own. Popping the screen therefore left the sheet on screen with
    // nothing behind it, and the next one opened on top — which is how they
    // piled up and had to be closed one at a time.
    const modalRef = React.createRef<BottomSheetModal>();

    const { unmount } = renderWithProviders(
      <BottomSheet
        modalRef={modalRef}
        handleCloseModal={jest.fn()}
        customContent={<Text>content</Text>}
      />,
    );

    expect(modalRef.current).not.toBeNull();
    const dismiss = jest.spyOn(modalRef.current!, "dismiss");

    unmount();

    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
