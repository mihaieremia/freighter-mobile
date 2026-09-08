import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SwapReviewFooter } from "components/screens/SwapScreen/components";
import React, { useCallback, useMemo } from "react";

/**
 * Builds the memoised renderer for the swap review bottom-sheet footer.
 */
export const useSwapFooter = ({
  swapReviewBottomSheetModalRef,
  onConfirm,
  isBuilding,
  isMalicious,
  isSuspicious,
  transactionXDR,
  onSettingsPress,
}: {
  swapReviewBottomSheetModalRef: React.RefObject<BottomSheetModal | null>;
  onConfirm: () => void;
  isBuilding: boolean;
  isMalicious: boolean;
  isSuspicious: boolean;
  transactionXDR: string | undefined | null;
  /** Omit to hide the settings control: Swap's settings sheet is scoped to
   * SWAP_STACK, so a flow outside that stack cannot open it. */
  onSettingsPress?: () => void;
}): { renderFooterComponent: () => React.JSX.Element } => {
  const handleCancelSwap = useCallback(() => {
    swapReviewBottomSheetModalRef.current?.dismiss();
  }, [swapReviewBottomSheetModalRef]);

  const footerProps = useMemo(
    () => ({
      onCancel: handleCancelSwap,
      onConfirm,
      isBuilding,
      isMalicious,
      isSuspicious,
      transactionXDR: transactionXDR ?? undefined,
      onSettingsPress,
    }),
    [
      handleCancelSwap,
      onConfirm,
      isBuilding,
      isMalicious,
      isSuspicious,
      transactionXDR,
      onSettingsPress,
    ],
  );

  const renderFooterComponent = useCallback(
    () => <SwapReviewFooter {...footerProps} />,
    [footerProps],
  );

  return { renderFooterComponent };
};
