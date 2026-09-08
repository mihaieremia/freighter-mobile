import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import BigNumber from "bignumber.js";
import { AmountCard } from "components/AmountCard";
import BottomSheet from "components/BottomSheet";
import { PercentageButtons } from "components/PercentageButtons";
import TransactionSettingsBottomSheet from "components/TransactionSettingsBottomSheet";
import { SecurityDetailBottomSheet } from "components/blockaid";
import { BaseLayout } from "components/layout/BaseLayout";
import { EarnReviewBottomSheet } from "components/screens/EarnScreen/components/EarnReviewBottomSheet";
import { HubCard } from "components/screens/EarnScreen/components/HubCard";
import { HubDetailsBottomSheet } from "components/screens/EarnScreen/components/HubDetailsBottomSheet";
import { ReceiveFundsBottomSheet } from "components/screens/EarnScreen/components/ReceiveFundsBottomSheet";
import { SpokePickerBottomSheet } from "components/screens/EarnScreen/components/SpokePickerBottomSheet";
import { XlmFeeShortfallBottomSheet } from "components/screens/EarnScreen/components/XlmFeeShortfallBottomSheet";
import {
  NATIVE_FEE_ALLOWANCE_XLM,
  getEarnCtaState,
  getPercentageDepositAmount,
  isInsufficientBalanceFailure,
  needsXlmForFee,
} from "components/screens/EarnScreen/helpers";
import { useEarnPosition } from "components/screens/EarnScreen/hooks/useEarnPosition";
import { useEarnTransaction } from "components/screens/EarnScreen/hooks/useEarnTransaction";
import { useSimulateEarnDeposit } from "components/screens/EarnScreen/hooks/useSimulateEarnTransaction";
import { EarnProcessingScreen } from "components/screens/EarnScreen/screens";
import { Button } from "components/sds/Button";
import {
  NoticeBanner,
  NoticeBannerVariants,
} from "components/sds/NoticeBanner";
import { TextButton } from "components/sds/TextButton";
import { Text } from "components/sds/Typography";
import { AnalyticsEvent } from "config/analyticsConfig";
import {
  NATIVE_TOKEN_CODE,
  TransactionContext,
  mapNetworkToNetworkDetails,
} from "config/constants";
import {
  ADD_FUNDS_ROUTES,
  EARN_ROUTES,
  EarnStackParamList,
  ROOT_NAVIGATOR_ROUTES,
  RootStackParamList,
} from "config/routes";
import { useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useDebugStore } from "ducks/debug";
import { useEarnStore } from "ducks/earn";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { isNativeBalance } from "helpers/assetIdentity";
import {
  calculateSpendableAmount,
  getBalanceByContractId,
} from "helpers/balances";
import {
  formatBalanceAmount,
  formatFiatInputDisplay,
  formatTokenForDisplay,
} from "helpers/formatAmount";
import useAppTranslation from "hooks/useAppTranslation";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import { useInitialRecommendedFee } from "hooks/useInitialRecommendedFee";
import { useNetworkFees } from "hooks/useNetworkFees";
import { useTokenFiatConverter } from "hooks/useTokenFiatConverter";
import { useToast } from "providers/ToastProvider";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { SecurityLevel } from "services/blockaid/constants";
import {
  assessTransactionSecurity,
  extractSecurityWarnings,
} from "services/blockaid/helper";

type EarnAmountScreenProps = NativeStackScreenProps<
  EarnStackParamList,
  typeof EARN_ROUTES.EARN_AMOUNT_SCREEN
>;

const EarnAmountScreen: React.FC<EarnAmountScreenProps> = ({
  route,
  navigation,
}) => {
  const { assetId, tokenCode } = route.params;
  const { t } = useAppTranslation();
  const { account } = useGetActiveAccount();
  const { network } = useAuthenticationStore();
  const { pricedBalances } = useBalancesStore();
  const { showToast } = useToast();

  // Cross-stack navigation (Buy XLM lives outside EarnStack) needs the
  // root-level param list — the screen's own `navigation` prop is typed to
  // EarnStackParamList only. Same pattern as EarnTokenPickerScreen's Buy
  // button.
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();

  const hub = useEarnStore((state) => state.hub);
  const selectedHubId = useEarnStore((state) => state.selectedHubId);
  const selectedSpokes = useEarnStore((state) => state.selectedSpokes);
  const selectedSpokeId = useEarnStore((state) => state.selectedSpokeId);
  const setSelectedSpokeId = useEarnStore((state) => state.setSelectedSpokeId);
  const selectedAssetApy = useEarnStore((state) => state.selectedAssetApy);
  const selectedAssetDecimals = useEarnStore(
    (state) => state.selectedAssetDecimals,
  );
  const resetEarn = useEarnStore((state) => state.resetEarn);
  const { overriddenBlockaidResponse } = useDebugStore();

  const { transactionFee, transactionTimeout } = useTransactionSettingsStore();
  const { recommendedFee, networkCongestion, feePresets } = useNetworkFees();

  // Earn deposits are single-operation Soroban invokes — same shape as a
  // classic Send, so this reuses the Send fee context (and its settings
  // store) rather than introducing a dedicated Earn TransactionContext.
  useInitialRecommendedFee(
    recommendedFee,
    TransactionContext.Send,
    1,
    networkCongestion,
    feePresets,
  );

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  const depositBalance = useMemo(
    () => getBalanceByContractId(assetId, pricedBalances, networkDetails),
    [assetId, pricedBalances, networkDetails],
  );

  const isXlm = useMemo(
    () => !!depositBalance && isNativeBalance(depositBalance),
    [depositBalance],
  );

  const xlmBalance = pricedBalances[NATIVE_TOKEN_CODE];

  const selectedSpoke = useMemo(
    () => selectedSpokes.find((spoke) => spoke.id === selectedSpokeId) ?? null,
    [selectedSpokes, selectedSpokeId],
  );

  const acceptingSpokeIds = useMemo(
    () => selectedSpokes.map((spoke) => spoke.id),
    [selectedSpokes],
  );

  useEarnPosition({
    hubId: selectedHubId,
    acceptingSpokeIds,
    spokeId: selectedSpokeId ?? 0,
    assetId,
    publicKey: account?.publicKey ?? "",
    networkDetails,
  });

  const amountInputRef = useRef<TextInput>(null);
  const networkFeeBottomSheetModalRef = useRef<BottomSheetModal>(null);
  const earnReviewBottomSheetModalRef = useRef<BottomSheetModal>(null);
  const transactionSecurityWarningBottomSheetModalRef =
    useRef<BottomSheetModal>(null);
  const poolDetailsBottomSheetModalRef = useRef<BottomSheetModal>(null);
  const transactionSettingsBottomSheetModalRef = useRef<BottomSheetModal>(null);
  const receiveFundsBottomSheetModalRef = useRef<BottomSheetModal>(null);
  const spokePickerBottomSheetModalRef = useRef<BottomSheetModal>(null);

  const converter = useTokenFiatConverter({
    selectedBalance: depositBalance,
    tokenDecimals: selectedAssetDecimals,
  });
  const {
    tokenAmount,
    fiatAmountDisplay,
    showFiatAmount,
    setTokenAmount,
    updateFiatDisplay,
  } = converter;

  // Max/percentage buttons and the CTA's insufficient-funds guard work off
  // this figure, so an XLM deposit has to keep the invoke's own fee back:
  // `calculateSpendableAmount` only nets out the inclusion fee, and
  // `assertEarnFeeAffordable` re-checks the whole PREPARED fee — resource fee
  // included — against what the deposit leaves behind. Offering the raw
  // spendable balance therefore made every Max XLM deposit fail at review.
  const availableBalance = useMemo(() => {
    if (!depositBalance) {
      return "0";
    }

    const spendable = calculateSpendableAmount({
      balance: depositBalance,
      subentryCount: account?.subentryCount ?? 0,
      transactionFee,
    });

    if (!isXlm) {
      return spendable.toFixed();
    }

    return BigNumber.max(
      spendable.minus(NATIVE_FEE_ALLOWANCE_XLM),
      new BigNumber(0),
    ).toFixed();
  }, [depositBalance, account?.subentryCount, transactionFee, isXlm]);

  const availableBalanceBn = useMemo(
    () => new BigNumber(availableBalance),
    [availableBalance],
  );

  // Shared between the CTA state machine and the amount card's red-text
  // treatment (design `9599:40119`) -- both must agree on exactly the same
  // "over balance" condition.
  const isAmountTooHigh = useMemo(
    () => new BigNumber(tokenAmount || "0").gt(availableBalanceBn),
    [tokenAmount, availableBalanceBn],
  );

  const ctaState = useMemo(
    () =>
      getEarnCtaState({
        availableBalanceIsZero: availableBalanceBn.lte(0),
        amountIsZero: new BigNumber(tokenAmount || "0").lte(0),
        isAmountTooHigh,
      }),
    [availableBalanceBn, tokenAmount, isAmountTooHigh],
  );

  const ctaLabelKeys: Record<typeof ctaState.labelKey, string> = {
    enter: t("earnAmount.enterAmount"),
    insufficient: t("earnAmount.insufficientFunds"),
    review: t("earnAmount.review"),
  };

  const {
    simulate,
    isSimulating,
    error: simulateError,
    scanResult,
    prepared,
    cancel: cancelPreparation,
  } = useSimulateEarnDeposit();

  // `scanResult` is undefined both before any simulation has run and when the
  // scan itself was unavailable (e.g. testnet, where Blockaid throws
  // NETWORK_NOT_SUPPORTED) — `assessTransactionSecurity` already treats both
  // the same way: "unable to scan", never a clean bill of health.
  const transactionSecurityAssessment = useMemo(
    () => assessTransactionSecurity(scanResult, overriddenBlockaidResponse),
    [scanResult, overriddenBlockaidResponse],
  );

  const securityWarnings = useMemo(
    () => extractSecurityWarnings(scanResult),
    [scanResult],
  );

  const earnSecuritySeverity = useMemo(() => {
    if (transactionSecurityAssessment.isMalicious) {
      return SecurityLevel.MALICIOUS;
    }
    if (transactionSecurityAssessment.isSuspicious) {
      return SecurityLevel.SUSPICIOUS;
    }
    if (transactionSecurityAssessment.isUnableToScan) {
      return SecurityLevel.UNABLE_TO_SCAN;
    }
    return undefined;
  }, [transactionSecurityAssessment]);

  // Surface the hub's own rejection (supply cap, frozen hub, stale oracle)
  // reactively off the hook's error state — mirrors the established
  // `transactionBuilderError` toast pattern in TransactionAmountScreen.
  // Reading `error` synchronously right after `await simulate(...)` inside
  // the CTA handler would see a stale pre-update value, since a `setState`
  // scheduled inside `simulate` isn't reflected in the handler's own closure.
  const previousSimulateErrorRef = useRef<string | null>(null);
  useEffect(() => {
    // Editing the amount cancels preparation, which clears the error — so the
    // ref has to clear with it, or a retry that fails identically is
    // suppressed as a duplicate and the user is told nothing at all.
    if (!simulateError) {
      previousSimulateErrorRef.current = null;
      return;
    }
    if (simulateError !== previousSimulateErrorRef.current) {
      previousSimulateErrorRef.current = simulateError;
      // A balance rejection on an XLM deposit is the fee, not the amount:
      // the CTA already gates anything above the spendable balance, so
      // what is left is a deposit that cannot also pay for itself. Every
      // other rejection — supply cap, frozen hub, stale oracle — is the
      // hub's own and reads better in its own words.
      const title =
        isXlm && isInsufficientBalanceFailure(simulateError)
          ? t("earnAmount.errors.insufficientBalanceForFee")
          : simulateError;
      showToast({
        variant: "error",
        title,
        toastId: "earn-simulate-failed",
        duration: 0,
      });
    }
  }, [simulateError, showToast, isXlm, t]);

  useEffect(() => {
    cancelPreparation();
  }, [tokenAmount, selectedSpokeId, selectedHubId, assetId, cancelPreparation]);

  const handlePercentagePress = useCallback(
    (percentage: number) => {
      const targetAmount = getPercentageDepositAmount({
        maxDepositable: availableBalance,
        pct: percentage,
        decimals: selectedAssetDecimals,
      });

      if (showFiatAmount && depositBalance?.currentPrice) {
        const tokenPrice = depositBalance.currentPrice;
        if (!tokenPrice.isZero()) {
          const fiatAmount = new BigNumber(targetAmount)
            .multipliedBy(tokenPrice)
            .toFixed(2);
          updateFiatDisplay(fiatAmount);
          setTokenAmount(targetAmount);
          return;
        }
      }

      setTokenAmount(targetAmount);
    },
    [
      availableBalance,
      selectedAssetDecimals,
      showFiatAmount,
      depositBalance,
      updateFiatDisplay,
      setTokenAmount,
    ],
  );

  /**
   * Opens a sheet over the amount input.
   *
   * Every sheet in this flow is presented while that input still holds focus,
   * so without blurring first the numeric keyboard stays up and keystrokes
   * keep editing the amount BEHIND the sheet — including the figure the
   * review sheet is showing, which would then no longer describe the staged
   * XDR the Confirm button submits. Blur-then-dismiss is what the Send flow's
   * review does for the same reason.
   */
  const presentSheet = useCallback(
    (ref: React.RefObject<BottomSheetModal | null>) => {
      amountInputRef.current?.blur();
      Keyboard.dismiss();
      ref.current?.present();
    },
    [],
  );

  const openReviewSheet = useCallback(() => {
    presentSheet(earnReviewBottomSheetModalRef);
  }, [presentSheet]);

  // The hub card's chevron -- design `9448:29157` -- is the only route into
  // `HubDetailsBottomSheet` now that the token picker's header info-button
  // has been removed (see that sheet's own doc comment).
  const handleOpenPoolDetails = useCallback(() => {
    presentSheet(poolDetailsBottomSheetModalRef);
  }, [presentSheet]);

  // Review sheet's footer gear (design `9448:29608`) -- same
  // `TransactionSettingsBottomSheet`/`TransactionContext.Send` reuse as the
  // fee/timeout context above, wired the same way Send/Swap's own review
  // sheets open theirs (see `TransactionAmountScreen`'s
  // `handleOpenSettingsFromReview`).
  const openTransactionSettings = useCallback(() => {
    presentSheet(transactionSettingsBottomSheetModalRef);
  }, [presentSheet]);

  const handleCancelTransactionSettings = useCallback(() => {
    transactionSettingsBottomSheetModalRef.current?.dismiss();
  }, []);

  const handleConfirmTransactionSettings = useCallback(() => {
    transactionSettingsBottomSheetModalRef.current?.dismiss();
  }, []);

  // Rebuilds the staged deposit with the just-saved fee/timeout so Review's
  // staged XDR keeps matching what Confirm will actually submit -- the same
  // rebuild Send's own `handleSettingsChange` triggers after a fee/timeout
  // save. Reads the settings store's value via `getState()` rather than the
  // `transactionFee`/`transactionTimeout` closed over above: those are still
  // the PRE-save values at the instant this fires, since
  // `TransactionSettingsBottomSheet`'s `handleConfirm` calls
  // `onSettingsChange` synchronously, before this screen re-renders with the
  // just-saved store value (same reasoning as the `getState()` read in
  // `handleCtaPress` above).
  const handleEarnSettingsChange = useCallback(async () => {
    if (isSimulating || !account?.publicKey) {
      return;
    }
    const freshSettings = useTransactionSettingsStore.getState();
    await simulate({
      hubId: selectedHubId ?? 0,
      spokeId: selectedSpokeId ?? 0,
      acceptingSpokeIds,
      assetId,
      amount: tokenAmount,
      decimals: selectedAssetDecimals,
      transactionFee: freshSettings.transactionFee,
      transactionTimeout: freshSettings.transactionTimeout,
      network,
      senderAddress: account.publicKey,
    });
  }, [
    isSimulating,
    selectedHubId,
    selectedSpokeId,
    acceptingSpokeIds,
    account?.publicKey,
    simulate,
    assetId,
    tokenAmount,
    selectedAssetDecimals,
    network,
  ]);

  // `EarnProcessingScreen` is rendered INLINE below (not a registered
  // route — there is no `EARN_ROUTES.EARN_PROCESSING_SCREEN`), gated on
  // `earnTransactionStatus` being "submitting" or "success". This
  // structurally prevents a swipe-back gesture from abandoning an in-flight
  // submit, which is stronger than a navigator's `gestureEnabled: false`.
  // "error" deliberately falls through to the normal amount screen instead
  // (see the auto-reset effect and render gate below) — the design has no
  // failure step.
  const {
    status: earnTransactionStatus,
    error: earnTransactionError,
    transactionHash: earnTransactionHash,
    submittedReview,
    submit: submitEarnTransaction,
    reset: resetEarnTransactionStatus,
    abandon: abandonEarnTransaction,
  } = useEarnTransaction({ account, network });

  /**
   * Confirms the deposit from the review sheet. `submitEarnTransaction`
   * flips `earnTransactionStatus` to "submitting" synchronously — which is
   * what gates the inline `EarnProcessingScreen` render below — so calling
   * it both sets the processing flag and kicks off the sign/submit work.
   */
  const handleConfirmDeposit = useCallback(() => {
    // Dismissed before submitting, not after: the processing screen renders
    // inline over this one, so a sheet left presented stays mounted behind it
    // and is still there when the flow returns to the amount screen.
    if (!prepared || isSimulating) return;
    earnReviewBottomSheetModalRef.current?.dismiss();
    submitEarnTransaction(prepared);
  }, [submitEarnTransaction, prepared, isSimulating]);

  // Leaving abandons local result handling for this submission.
  const handleCloseEarnProcessingWhileSubmitting = useCallback(() => {
    abandonEarnTransaction();
    navigation.popTo(EARN_ROUTES.EARN_POSITIONS_SCREEN);
  }, [navigation, abandonEarnTransaction]);

  // Success's "Done" action: clear the earn duck (hub/asset selection,
  // lastSubmitFailed) now that the flow completed, then return Home.
  const handleEarnProcessingDone = useCallback(() => {
    resetEarn();
    // Back to the positions list, not Home: the deposit just changed what is
    // on that list, and it is where the rest of the flow — withdrawing,
    // repaying, depositing again — starts from. Popping to it also unmounts
    // this screen, so a later deposit reopens with fresh figures.
    navigation.popTo(EARN_ROUTES.EARN_POSITIONS_SCREEN);
  }, [navigation, resetEarn]);

  useEffect(() => {
    resetEarnTransactionStatus();
  }, [tokenAmount, resetEarnTransactionStatus]);

  const handleCancelSecurityWarning = useCallback(() => {
    transactionSecurityWarningBottomSheetModalRef.current?.dismiss();
  }, []);

  // Reached only via the review sheet's banner -> detail sheet path (the
  // review sheet's OWN "Confirm anyway" button calls `handleConfirmDeposit`
  // directly and dismisses itself) — so this dismisses both sheets before
  // proceeding.
  const handleConfirmAnywayFromSecuritySheet = useCallback(() => {
    transactionSecurityWarningBottomSheetModalRef.current?.dismiss();
    earnReviewBottomSheetModalRef.current?.dismiss();
    handleConfirmDeposit();
  }, [handleConfirmDeposit]);

  const handleCtaPress = useCallback(async () => {
    if (ctaState.disabled) {
      return;
    }

    if (!account?.publicKey) {
      return;
    }

    // Checked AFTER the CTA's own insufficient-funds guard (above) so that
    // when the deposit asset IS XLM, an unaffordable amount reads as
    // insufficient funds on the button rather than as a fee problem. No held
    // XLM balance at all can't cover any fee, so treat that the same as
    // needing more XLM.
    const spendableXlm = xlmBalance
      ? calculateSpendableAmount({
          balance: xlmBalance,
          subentryCount: account.subentryCount,
          transactionFee,
        })
      : new BigNumber(0);

    // `transactionFee` is just the inclusion fee (~0.00001 XLM), so this gate
    // only catches "no XLM headroom at all". An XLM deposit is already held
    // back from `NATIVE_FEE_ALLOWANCE_XLM` above; for any other asset the fee
    // comes out of an XLM balance this screen never spends, and only its
    // absence is a problem worth stopping for.
    if (
      needsXlmForFee({
        spendableXlm: spendableXlm.toFixed(),
        fee: transactionFee,
      })
    ) {
      presentSheet(networkFeeBottomSheetModalRef);
      return;
    }

    const result = await simulate({
      hubId: selectedHubId ?? 0,
      spokeId: selectedSpokeId ?? 0,
      acceptingSpokeIds,
      assetId,
      amount: tokenAmount,
      decimals: selectedAssetDecimals,
      transactionFee,
      transactionTimeout,
      network,
      senderAddress: account.publicKey,
    });

    if (!result) {
      // On failure, the effect above surfaces `simulateError` as a toast —
      // nothing further to do here.
      return;
    }

    openReviewSheet();
  }, [
    ctaState.disabled,
    xlmBalance,
    account?.subentryCount,
    account?.publicKey,
    transactionFee,
    simulate,
    assetId,
    tokenAmount,
    selectedAssetDecimals,
    transactionTimeout,
    network,
    openReviewSheet,
    presentSheet,
    selectedHubId,
    selectedSpokeId,
    acceptingSpokeIds,
  ]);

  // The fee-shortfall sheet's action: send the user to buy XLM rather than
  // just telling them they need it. Same destination as
  // EarnTokenPickerScreen's NotEnoughTokenBottomSheet Buy button.
  const handleBuyXlmPress = useCallback(() => {
    networkFeeBottomSheetModalRef.current?.dismiss();
    rootNavigation.navigate(ROOT_NAVIGATOR_ROUTES.BUY_XLM_STACK, {
      screen: ADD_FUNDS_ROUTES.ADD_FUNDS_SCREEN,
      params: { isUnfunded: false },
    });
  }, [rootNavigation]);

  // The fee-shortfall sheet's second action (design node `9457:45927`): an
  // in-flow "Receive funds" QR sheet (`9457:46184`), presented ON TOP of the
  // fee sheet rather than replacing it -- the mock itself composites the
  // receive sheet directly over this one, and this mirrors the review
  // sheet's own security-detail sheet (`onSecurityWarningPress` below), the
  // established pattern in this feature for stacking a sheet without
  // dismissing the one beneath. Dismissing it leaves the fee sheet exactly
  // as it was -- the user never leaves Earn. Previously this navigated
  // cross-stack to `ROOT_NAVIGATOR_ROUTES.SCAN_RECEIVE_SCREEN`, ejecting the
  // user from the flow entirely -- same drift as
  // `EarnTokenPickerScreen`'s `NotEnoughTokenBottomSheet`.
  const handleReceiveXlmPress = useCallback(() => {
    presentSheet(receiveFundsBottomSheetModalRef);
  }, [presentSheet]);

  // "error" deliberately falls through to the normal amount screen below
  // (see the auto-reset effect above) rather than rendering
  // `EarnProcessingScreen` — the design has no failure step for it to show.
  const isProcessing =
    earnTransactionStatus === "submitting" ||
    earnTransactionStatus === "success";

  const availableBalanceText = depositBalance
    ? `${formatBalanceAmount(depositBalance, tokenCode, availableBalanceBn)} ${t(
        "common.available",
      )}`
    : null;

  const hasUsdPrice =
    !!depositBalance?.currentPrice && !depositBalance.currentPrice.isZero();

  const secondaryAmountText = showFiatAmount
    ? formatTokenForDisplay(tokenAmount || "0", tokenCode)
    : formatFiatInputDisplay(fiatAmountDisplay || "0");

  return (
    // The sheets sit OUTSIDE the swap between the form and the processing
    // view. A presented sheet renders through the modal provider's portal,
    // and unmounting it while it is closing leaves that portal on screen
    // with nothing behind it — which is how a stray sheet survived a
    // confirmed deposit. One stable place in the tree lets it finish.
    <>
      {isProcessing ? (
        <EarnProcessingScreen
          status={earnTransactionStatus}
          tokenAmount={submittedReview?.params.amount ?? tokenAmount}
          transactionHash={earnTransactionHash}
          onCloseWhileSubmitting={handleCloseEarnProcessingWhileSubmitting}
          onDone={handleEarnProcessingDone}
        />
      ) : (
        <BaseLayout useKeyboardAvoidingView insets={{ top: false }}>
          <View className="flex-1" testID="earn-amount-screen">
            {earnTransactionError && (
              <View className="mb-[12px]">
                <NoticeBanner
                  text={t("earnAmount.retryBanner")}
                  variant={NoticeBannerVariants.ERROR}
                />
              </View>
            )}

            <AmountCard
              disabled={isSimulating || earnTransactionStatus === "authorizing"}
              mode="editable"
              testID="earn-amount-card"
              label={t("earnAmount.depositLabel")}
              selectedToken={depositBalance}
              pickerLabel={tokenCode}
              onPickerPress={() => navigation.goBack()}
              pickerTestID="earn-amount-token-pill"
              inputTestID="earn-amount-input"
              focusTriggerTestID="earn-amount-focus-trigger"
              fiatToggleTestID="earn-amount-fiat-toggle"
              inputRef={amountInputRef}
              autoFocus
              accessibilityLabel={t("earnAmount.enterAmount")}
              accessibilityHint={t("earnAmount.title")}
              availableBalanceText={availableBalanceText}
              converter={converter}
              hasUsdPrice={hasUsdPrice}
              secondaryAmountText={secondaryAmountText}
              isError={isAmountTooHigh}
            />

            <View className="mt-[12px]">
              <HubCard
                hub={hub}
                apy={selectedAssetApy}
                onPress={handleOpenPoolDetails}
                testID="earn-amount-hub-card"
              />
            </View>

            {/* Which risk spoke the deposit lands in. Chosen for the user —
                every spoke accepting this asset earns the same — but named
                here, and changeable, because it decides what the deposit can
                back later. The change action is hidden when only one spoke
                accepts the asset, since there is then nothing to decide. */}
            {selectedSpoke && (
              <View className="flex-row items-center justify-between mt-[12px] px-1">
                <Text sm secondary numberOfLines={1}>
                  {selectedSpoke.name ??
                    t("earnSpoke.unnamed", { id: selectedSpoke.id })}
                </Text>
                {selectedSpokes.length > 1 && (
                  <TextButton
                    text={t("earnSpoke.change")}
                    onPress={() => {
                      if (
                        !isSimulating &&
                        earnTransactionStatus !== "authorizing"
                      )
                        presentSheet(spokePickerBottomSheetModalRef);
                    }}
                    testID="earn-amount-change-spoke"
                  />
                )}
              </View>
            )}

            <View className="items-center mt-[12px]">
              <PercentageButtons
                disabled={
                  isSimulating || earnTransactionStatus === "authorizing"
                }
                onPress={handlePercentagePress}
                testID="earn-amount-percentage-buttons"
              />
            </View>
          </View>

          <View className="w-full mt-auto mb-[8px]">
            <Button
              tertiary
              xl
              onPress={handleCtaPress}
              disabled={
                ctaState.disabled ||
                isSimulating ||
                earnTransactionStatus === "authorizing"
              }
              isLoading={isSimulating}
              testID="earn-amount-cta"
            >
              {ctaLabelKeys[ctaState.labelKey]}
            </Button>
          </View>
        </BaseLayout>
      )}

      <BottomSheet
        modalRef={networkFeeBottomSheetModalRef}
        handleCloseModal={() =>
          networkFeeBottomSheetModalRef.current?.dismiss()
        }
        customContent={
          <XlmFeeShortfallBottomSheet
            bottomSheetModalRef={networkFeeBottomSheetModalRef}
            onBuy={handleBuyXlmPress}
            onReceive={handleReceiveXlmPress}
          />
        }
      />

      <BottomSheet
        modalRef={earnReviewBottomSheetModalRef}
        handleCloseModal={() =>
          earnReviewBottomSheetModalRef.current?.dismiss()
        }
        analyticsEvent={AnalyticsEvent.VIEW_EARN_REVIEW}
        customContent={
          <EarnReviewBottomSheet
            bottomSheetModalRef={earnReviewBottomSheetModalRef}
            tokenAmount={prepared?.params.amount ?? tokenAmount}
            prepared={prepared}
            canConfirm={
              !!prepared &&
              !isSimulating &&
              earnTransactionStatus !== "authorizing" &&
              prepared.params.transactionFee === transactionFee &&
              prepared.params.transactionTimeout === transactionTimeout
            }
            transactionSecurityAssessment={transactionSecurityAssessment}
            onSecurityWarningPress={() =>
              transactionSecurityWarningBottomSheetModalRef.current?.present()
            }
            onConfirm={handleConfirmDeposit}
            onSettingsPress={openTransactionSettings}
          />
        }
      />
      <BottomSheet
        modalRef={transactionSettingsBottomSheetModalRef}
        handleCloseModal={handleCancelTransactionSettings}
        customContent={
          <TransactionSettingsBottomSheet
            context={TransactionContext.Send}
            onCancel={handleCancelTransactionSettings}
            onConfirm={handleConfirmTransactionSettings}
            onSettingsChange={() => {
              handleEarnSettingsChange();
            }}
          />
        }
      />
      <BottomSheet
        modalRef={transactionSecurityWarningBottomSheetModalRef}
        handleCloseModal={handleCancelSecurityWarning}
        customContent={
          <SecurityDetailBottomSheet
            warnings={securityWarnings}
            onCancel={handleCancelSecurityWarning}
            onProceedAnyway={handleConfirmAnywayFromSecuritySheet}
            onClose={handleCancelSecurityWarning}
            severity={earnSecuritySeverity}
            proceedAnywayText={
              transactionSecurityAssessment.isUnableToScan
                ? t("common.continue")
                : t("transactionAmountScreen.confirmAnyway")
            }
          />
        }
      />
      <BottomSheet
        modalRef={poolDetailsBottomSheetModalRef}
        handleCloseModal={() =>
          poolDetailsBottomSheetModalRef.current?.dismiss()
        }
        customContent={
          <HubDetailsBottomSheet
            hub={hub}
            bottomSheetModalRef={poolDetailsBottomSheetModalRef}
          />
        }
      />
      <BottomSheet
        modalRef={spokePickerBottomSheetModalRef}
        handleCloseModal={() =>
          spokePickerBottomSheetModalRef.current?.dismiss()
        }
        customContent={
          <SpokePickerBottomSheet
            spokes={selectedSpokes}
            selectedSpokeId={selectedSpokeId}
            onSelect={(spokeId) => {
              setSelectedSpokeId(spokeId);
              spokePickerBottomSheetModalRef.current?.dismiss();
            }}
            onClose={() => spokePickerBottomSheetModalRef.current?.dismiss()}
          />
        }
      />
      <BottomSheet
        modalRef={receiveFundsBottomSheetModalRef}
        handleCloseModal={() =>
          receiveFundsBottomSheetModalRef.current?.dismiss()
        }
        customContent={
          <ReceiveFundsBottomSheet
            bottomSheetModalRef={receiveFundsBottomSheetModalRef}
          />
        }
      />
    </>
  );
};

export default EarnAmountScreen;
