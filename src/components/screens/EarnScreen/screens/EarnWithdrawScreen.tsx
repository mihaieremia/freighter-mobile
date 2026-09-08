import { NativeStackScreenProps } from "@react-navigation/native-stack";
import BigNumber from "bignumber.js";
import BottomSheet from "components/BottomSheet";
import { PercentageButtons } from "components/PercentageButtons";
import { BaseLayout } from "components/layout/BaseLayout";
import { EarnActionReviewBottomSheet } from "components/screens/EarnScreen/components/EarnActionReviewBottomSheet";
import {
  formatRate,
  getPercentageWithdrawAmount,
  withdrawableBound,
} from "components/screens/EarnScreen/helpers";
import {
  EarnActionCommonParams,
  useEarnActionScreen,
} from "components/screens/EarnScreen/hooks/useEarnActionScreen";
import { useEarnPositions } from "components/screens/EarnScreen/hooks/useEarnPositions";
import { useSimulateEarnWithdraw } from "components/screens/EarnScreen/hooks/useSimulateEarnTransaction";
import EarnProcessingScreen from "components/screens/EarnScreen/screens/EarnProcessingScreen";
import { Button } from "components/sds/Button";
import { Input } from "components/sds/Input";
import { Text } from "components/sds/Typography";
import { EARN_ROUTES, EarnStackParamList } from "config/routes";
import { useAuthenticationStore } from "ducks/auth";
import { formatTokenForDisplay } from "helpers/formatAmount";
import useAppTranslation from "hooks/useAppTranslation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

type EarnWithdrawScreenProps = NativeStackScreenProps<
  EarnStackParamList,
  typeof EARN_ROUTES.EARN_WITHDRAW_SCREEN
>;

/**
 * Withdraws one supplied leg back to the owner's wallet.
 *
 * The shared action hook prepares, checks fees, authenticates and submits.
 * This screen applies the latest collateral withdrawal bound.
 */
export const EarnWithdrawScreen: React.FC<EarnWithdrawScreenProps> = ({
  navigation,
  route,
}) => {
  const {
    accountId,
    hubId,
    hubName,
    assetId,
    tokenCode,
    decimals,
    suppliedTokens,
    withdrawableTokens: routeWithdrawableTokens,
    apy,
  } = route.params;
  const { t } = useAppTranslation();
  const { network } = useAuthenticationStore();
  const { positions, error: positionsError, refetch } = useEarnPositions();
  const latestLeg = positions
    ?.find((position) => position.accountId === accountId)
    ?.supply.find((leg) => leg.hubId === hubId && leg.assetId === assetId);
  const withdrawableTokens = withdrawableBound({
    positions,
    positionsError,
    routeBound: routeWithdrawableTokens,
    legBound: latestLeg?.withdrawableTokens ?? null,
  });

  /**
   * True once the user asks for the whole leg. Carried separately from the
   * amount because the contract takes 0 to mean "all", and only that empties
   * a leg exactly: the balance accrues with the index between this screen and
   * the ledger that executes the withdrawal, so the figure shown here is
   * already stale by the time it lands.
   */
  const [withdrawAll, setWithdrawAll] = useState(false);

  const {
    simulate,
    isSimulating,
    prepared,
    cancel,
    error: simulationError,
  } = useSimulateEarnWithdraw();

  const supplied = useMemo(
    () =>
      new BigNumber(latestLeg?.tokens ?? suppliedTokens).shiftedBy(-decimals),
    [latestLeg?.tokens, suppliedTokens, decimals],
  );

  /**
   * What this leg can actually release, which is not always what it holds: a
   * position carrying debt must keep enough collateral to cover it, so the
   * rest is locked until the debt is repaid.
   *
   * Null means the position could not be priced. Withdrawals stay paused.
   */
  const available = useMemo(
    () =>
      withdrawableTokens === null
        ? new BigNumber(0)
        : new BigNumber(withdrawableTokens).shiftedBy(-decimals),
    [withdrawableTokens, decimals],
  );
  const isLimitedByDebt = available.lt(supplied);

  const buildSimulateParams = useCallback(
    (common: EarnActionCommonParams) => ({
      ...common,
      accountId,
      hubId,
      assetId,
      decimals,
      withdrawAll,
      network,
    }),
    [accountId, hubId, assetId, decimals, withdrawAll, network],
  );

  const {
    amountDisplay,
    setAmount,
    setAmountFromInput,
    processingAmount,
    amountBn,
    amountInputRef,
    reviewSheetRef,
    token,
    transactionHash,
    processingStatus,
    reviewAmount,
    reviewWithdrawAll,
    canConfirm,
    isPreparing,
    submissionError,
    securityAssessment,
    handleReview,
    handleConfirm,
    handleDone,
    handleCloseWhileSubmitting,
  } = useEarnActionScreen({
    assetId,
    tokenCode,
    simulate,
    isSimulating,
    prepared,
    cancel,
    buildSimulateParams,
    goBack: navigation.goBack,
  });

  // Supply interest accrues per ledger, so the polled leg moves on its own and
  // the prepared review stops describing it. The sheet is dismissed with it:
  // left presented it has no fee row and a dead Confirm, with nothing saying
  // why.
  useEffect(() => {
    cancel();
    reviewSheetRef.current?.dismiss();
  }, [withdrawableTokens, latestLeg?.tokens, cancel, reviewSheetRef]);

  // Refresh the displayed Max amount without changing the user's full-exit intent.
  // A restricted or unavailable bound requires an explicit new choice.
  useEffect(() => {
    if (!withdrawAll) return;
    if (withdrawableTokens === null || isLimitedByDebt || available.lte(0)) {
      setWithdrawAll(false);
      setAmount("");
      return;
    }
    setAmount(available.toFixed());
  }, [withdrawAll, withdrawableTokens, isLimitedByDebt, available, setAmount]);

  const isAmountTooHigh = amountBn.gt(available);
  const canReview =
    withdrawableTokens !== null && amountBn.gt(0) && !isAmountTooHigh;

  const handleAmountChange = useCallback(
    (value: string) => {
      setAmountFromInput(value);
      setWithdrawAll(false);
    },
    [setAmountFromInput],
  );

  const handlePercentagePress = useCallback(
    (percentage: number) => {
      setAmount(
        getPercentageWithdrawAmount({
          available,
          pct: percentage,
          decimals,
          isLimitedByDebt,
        }),
      );
      // Only a full exit takes the contract's "all" path, and only when the
      // whole leg is actually free: with debt in the way, 100% of what is
      // available is still a partial withdrawal, and sending 0 would ask the
      // contract to empty a leg it cannot empty.
      setWithdrawAll(percentage === 100 && !isLimitedByDebt);
    },
    [available, decimals, isLimitedByDebt, setAmount],
  );

  return (
    // The review sheet sits OUTSIDE the swap between the form and the
    // processing view. A presented sheet renders through the modal
    // provider's portal, and unmounting it while it is closing leaves that
    // portal on screen with nothing behind it; keeping one stable place in
    // the tree lets the dismissal finish.
    <>
      {processingStatus ? (
        <EarnProcessingScreen
          variant="withdraw"
          status={processingStatus}
          tokenAmount={processingAmount}
          tokenCode={tokenCode}
          contextName={hubName}
          token={token}
          transactionHash={transactionHash}
          onCloseWhileSubmitting={handleCloseWhileSubmitting}
          onDone={handleDone}
        />
      ) : (
        <BaseLayout useKeyboardAvoidingView insets={{ top: false }}>
          <View className="flex-1" testID="earn-withdraw-screen">
            <Input
              editable={!isPreparing}
              ref={amountInputRef}
              autoFocus
              fieldSize="lg"
              keyboardType="decimal-pad"
              label={t("earnWithdraw.label")}
              placeholder="0"
              value={amountDisplay}
              onChangeText={handleAmountChange}
              error={
                isAmountTooHigh ? t("earnWithdraw.amountTooHigh") : undefined
              }
              note={
                isLimitedByDebt
                  ? `${t("earnWithdraw.available")}: ${formatTokenForDisplay(
                      available,
                      tokenCode,
                    )} ${t("earnWithdraw.of")} ${formatTokenForDisplay(
                      supplied,
                      tokenCode,
                    )} · ${t("earnWithdraw.limitedByDebt")}`
                  : `${t("earnWithdraw.supplied")}: ${formatTokenForDisplay(
                      supplied,
                      tokenCode,
                    )}${apy !== null ? ` · ${formatRate(apy)}` : ""}`
              }
              testID="earn-withdraw-input"
            />

            <View className="items-center mt-3">
              <PercentageButtons
                disabled={isPreparing || withdrawableTokens === null}
                onPress={handlePercentagePress}
                testID="earn-withdraw-percentage-buttons"
              />
            </View>

            {withdrawableTokens === null && (
              <View className="gap-2">
                <Text sm secondary>
                  {t("earnSafety.withdrawalUnavailable")}
                </Text>
                <Button secondary onPress={refetch}>
                  {t("earnPositions.error.retry")}
                </Button>
              </View>
            )}
            {(submissionError || simulationError) && (
              <Text sm color="red" testID="earn-withdraw-error">
                {submissionError || simulationError}
              </Text>
            )}
          </View>

          <View className="w-full mt-auto mb-2">
            <Button
              tertiary
              xl
              onPress={handleReview}
              disabled={!canReview || isPreparing}
              isLoading={isSimulating}
              testID="earn-withdraw-cta"
            >
              {t("earnWithdraw.review")}
            </Button>
          </View>
        </BaseLayout>
      )}

      <BottomSheet
        modalRef={reviewSheetRef}
        handleCloseModal={() => reviewSheetRef.current?.dismiss()}
        customContent={
          <EarnActionReviewBottomSheet
            variant="withdraw"
            token={token}
            contextName={hubName}
            feeXlm={prepared?.feeXlm}
            amount={reviewAmount}
            canConfirm={canConfirm}
            tokenCode={tokenCode}
            note={reviewWithdrawAll ? t("earnWithdraw.all") : undefined}
            securityAssessment={securityAssessment}
            onCancel={() => reviewSheetRef.current?.dismiss()}
            onConfirm={handleConfirm}
          />
        }
      />
    </>
  );
};

export default EarnWithdrawScreen;
