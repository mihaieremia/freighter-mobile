import { NativeStackScreenProps } from "@react-navigation/native-stack";
import BigNumber from "bignumber.js";
import BottomSheet from "components/BottomSheet";
import { PercentageButtons } from "components/PercentageButtons";
import { BaseLayout } from "components/layout/BaseLayout";
import { EarnActionReviewBottomSheet } from "components/screens/EarnScreen/components/EarnActionReviewBottomSheet";
import {
  FULL_REPAY_MARGIN,
  getPercentageRepayAmount,
} from "components/screens/EarnScreen/helpers";
import {
  EarnActionCommonParams,
  useEarnActionScreen,
} from "components/screens/EarnScreen/hooks/useEarnActionScreen";
import { useSimulateEarnRepay } from "components/screens/EarnScreen/hooks/useSimulateEarnTransaction";
import EarnProcessingScreen from "components/screens/EarnScreen/screens/EarnProcessingScreen";
import { Button } from "components/sds/Button";
import { Input } from "components/sds/Input";
import { Text } from "components/sds/Typography";
import { mapNetworkToNetworkDetails } from "config/constants";
import { EARN_ROUTES, EarnStackParamList } from "config/routes";
import { useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { isNativeBalance } from "helpers/assetIdentity";
import {
  calculateSpendableAmount,
  getBalanceByContractId,
} from "helpers/balances";
import { formatTokenForDisplay } from "helpers/formatAmount";
import useAppTranslation from "hooks/useAppTranslation";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import React, { useCallback, useMemo } from "react";
import { View } from "react-native";

type EarnRepayScreenProps = NativeStackScreenProps<
  EarnStackParamList,
  typeof EARN_ROUTES.EARN_REPAY_SCREEN
>;

/**
 * Repays one debt leg of a position from the wallet's own balance.
 *
 * The mirror of the withdraw screen, and shares its plumbing through
 * `useEarnActionScreen`: what differs is that the amount is bounded by two
 * things at once, the debt and what the wallet can spend.
 */
export const EarnRepayScreen: React.FC<EarnRepayScreenProps> = ({
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
    borrowedTokens,
  } = route.params;
  const { t } = useAppTranslation();
  const { account } = useGetActiveAccount();
  const { network } = useAuthenticationStore();
  const { pricedBalances } = useBalancesStore();
  const { transactionFee } = useTransactionSettingsStore();

  const {
    simulate,
    isSimulating,
    prepared,
    cancel,
    error: simulationError,
  } = useSimulateEarnRepay();

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  const owed = useMemo(
    () => new BigNumber(borrowedTokens).shiftedBy(-decimals),
    [borrowedTokens, decimals],
  );

  const walletBalance = useMemo(
    () => getBalanceByContractId(assetId, pricedBalances, networkDetails),
    [assetId, pricedBalances, networkDetails],
  );

  const isNative = useMemo(
    () => !!walletBalance && isNativeBalance(walletBalance),
    [walletBalance],
  );

  /**
   * What the wallet can actually put towards the debt, which for XLM is less
   * than it holds: the account has to keep its base reserve and the inclusion
   * fee. Offering the raw balance is what made a full XLM repayment fail at
   * simulation while the same repayment in any other asset went through.
   */
  const held = useMemo(() => {
    if (!walletBalance) {
      return new BigNumber(0);
    }
    return calculateSpendableAmount({
      balance: walletBalance,
      subentryCount: account?.subentryCount ?? 0,
      transactionFee,
    });
  }, [walletBalance, account?.subentryCount, transactionFee]);

  const buildSimulateParams = useCallback(
    (common: EarnActionCommonParams) => ({
      ...common,
      accountId,
      hubId,
      assetId,
      decimals,
      network,
    }),
    [accountId, hubId, assetId, decimals, network],
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

  const exceedsWallet = amountBn.gt(held);
  const exceedsDebt = amountBn.gt(
    owed
      .multipliedBy(FULL_REPAY_MARGIN)
      .decimalPlaces(decimals, BigNumber.ROUND_UP),
  );
  const canReview = amountBn.gt(0) && !exceedsWallet && !exceedsDebt;
  /** True once the wallet cannot cover the whole debt. */
  const isCappedByWallet = held.lt(
    owed
      .multipliedBy(FULL_REPAY_MARGIN)
      .decimalPlaces(decimals, BigNumber.ROUND_UP),
  );

  const handlePercentagePress = useCallback(
    (percentage: number) => {
      setAmount(
        getPercentageRepayAmount({
          owed,
          spendable: held,
          pct: percentage,
          decimals,
          isNative,
        }),
      );
    },
    [owed, held, decimals, isNative, setAmount],
  );

  const inputError = (() => {
    if (exceedsWallet) {
      return t("earnRepay.notEnough", { tokenCode });
    }
    return exceedsDebt ? t("earnRepay.amountTooHigh") : undefined;
  })();

  return (
    // The review sheet sits OUTSIDE the swap between the form and the
    // processing view. A presented sheet renders through the modal
    // provider's portal, and unmounting it while it is closing leaves that
    // portal on screen with nothing behind it; keeping one stable place in
    // the tree lets the dismissal finish.
    <>
      {processingStatus ? (
        <EarnProcessingScreen
          variant="repay"
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
          <View className="flex-1" testID="earn-repay-screen">
            <Input
              editable={!isPreparing}
              ref={amountInputRef}
              autoFocus
              fieldSize="lg"
              keyboardType="decimal-pad"
              label={t("earnRepay.label")}
              placeholder="0"
              value={amountDisplay}
              onChangeText={setAmountFromInput}
              error={inputError}
              note={`${t("earnRepay.owed")}: ${formatTokenForDisplay(
                owed,
                tokenCode,
              )} · ${t("earnRepay.inWallet")}: ${formatTokenForDisplay(
                held,
                tokenCode,
              )}`}
              testID="earn-repay-input"
            />

            <View className="items-center mt-3">
              <PercentageButtons
                disabled={isPreparing}
                onPress={handlePercentagePress}
                testID="earn-repay-percentage-buttons"
              />
            </View>

            {isCappedByWallet && (
              <Text sm secondary testID="earn-repay-capped">
                {t("earnSafety.partialRepayment")}
              </Text>
            )}

            {(submissionError || simulationError) && (
              <Text sm color="red" testID="earn-repay-error">
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
              testID="earn-repay-cta"
            >
              {t("earnRepay.review")}
            </Button>
          </View>
        </BaseLayout>
      )}

      <BottomSheet
        modalRef={reviewSheetRef}
        handleCloseModal={() => reviewSheetRef.current?.dismiss()}
        customContent={
          <EarnActionReviewBottomSheet
            variant="repay"
            token={token}
            contextName={hubName}
            feeXlm={prepared?.feeXlm}
            amount={reviewAmount}
            canConfirm={canConfirm}
            tokenCode={tokenCode}
            note={
              new BigNumber(reviewAmount).gte(
                owed
                  .multipliedBy(FULL_REPAY_MARGIN)
                  .decimalPlaces(decimals, BigNumber.ROUND_UP),
              )
                ? t("earnRepay.clearsDebt")
                : t("earnSafety.partialRepayment")
            }
            securityAssessment={securityAssessment}
            onCancel={() => reviewSheetRef.current?.dismiss()}
            onConfirm={handleConfirm}
          />
        }
      />
    </>
  );
};

export default EarnRepayScreen;
