import { BottomSheetModal } from "@gorhom/bottom-sheet";
import BigNumber from "bignumber.js";
import {
  EarnReviewParams,
  PreparedEarnReview,
} from "components/screens/EarnScreen/helpers/preparedReview";
import { useEarnTransaction } from "components/screens/EarnScreen/hooks/useEarnTransaction";
import { SimulateEarnSuccess } from "components/screens/EarnScreen/hooks/useSimulateEarnTransaction";
import { NATIVE_TOKEN_CODE, TransactionContext } from "config/constants";
import { Balance, Token } from "config/types";
import { XoxnoActionParams } from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { sanitizePastedAmount } from "helpers/formatAmount";
import { getNativeContractDetails } from "helpers/soroban";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import { useInitialRecommendedFee } from "hooks/useInitialRecommendedFee";
import { useNetworkFees } from "hooks/useNetworkFees";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, TextInput } from "react-native";
import { getNumberFormatSettings } from "react-native-localize";
import { assessTransactionSecurity } from "services/blockaid/helper";

/** The part of an action's params this hook already holds. */
export type EarnActionCommonParams = Pick<
  XoxnoActionParams,
  "senderAddress" | "transactionFee" | "transactionTimeout" | "amount"
>;

/**
 * Everything a withdraw and a repay do identically.
 *
 * The two screens act on one leg of a position the user already holds: take
 * an amount, simulate it, review it, submit it, and leave. Only the bounds on
 * the amount and the copy around it differ, so those stay in the screens and
 * the rest lives here.
 *
 * The deposit screen is deliberately not a caller: it also carries a swap
 * branch, an XLM fee-shortfall gate and an earnings projection, and folding
 * those in would make this the very thing it exists to avoid.
 */
export const useEarnActionScreen = <P extends EarnReviewParams>({
  assetId,
  tokenCode,
  simulate,
  buildSimulateParams,
  isSimulating,
  prepared: review,
  cancel,
  goBack,
}: {
  /** The market's asset contract address. */
  assetId: string;
  tokenCode: string;
  /** The screen's own simulate hook. */
  simulate: (params: P) => Promise<SimulateEarnSuccess | null>;
  isSimulating: boolean;
  prepared: PreparedEarnReview | null;
  cancel: () => void;
  /**
   * The action's own simulate arguments. Called with everything this hook
   * already holds — the amount included — so a screen names only what is
   * specific to it, and never has to close over state this hook owns.
   */
  buildSimulateParams: (common: EarnActionCommonParams) => P;
  /** Leaves the flow: the screens were pushed from the positions list. */
  goBack: () => void;
}) => {
  const { account } = useGetActiveAccount();
  const { network } = useAuthenticationStore();
  const { transactionFee, transactionTimeout } = useTransactionSettingsStore();
  const { recommendedFee, networkCongestion, feePresets } = useNetworkFees();

  // Withdrawals and repayments are single-operation Soroban invokes, the same
  // shape as a Send, so they take the network's recommended inclusion fee the
  // same way the deposit screen does. Without this they submitted at the
  // stored floor — the flow resets settings on every exit — and the network
  // refused them with tx_insufficient_fee whenever it wanted more than base.
  useInitialRecommendedFee(
    recommendedFee,
    TransactionContext.Send,
    1,
    networkCongestion,
    feePresets,
  );

  const reviewSheetRef = useRef<BottomSheetModal>(null);
  const amountInputRef = useRef<TextInput>(null);
  const [amount, setAmount] = useState("");

  const {
    status,
    error: submissionError,
    transactionHash,
    submittedReview,
    submit,
    reset: resetTransaction,
    abandon: abandonTransaction,
  } = useEarnTransaction({ account, network });

  // Neither flow touches the earn duck's deposit selection, so the terminal
  // screen is told what it is reporting rather than reading it from there.
  // Native is decided by the contract address, never by the code.
  const token = useMemo<Token | Balance>(
    () =>
      assetId === getNativeContractDetails(network).contract
        ? { type: "native" as const, code: NATIVE_TOKEN_CODE as "XLM" }
        : { code: tokenCode, issuer: { key: assetId } },
    [assetId, tokenCode, network],
  );

  useEffect(() => {
    cancel();
    resetTransaction();
  }, [
    amount,
    buildSimulateParams,
    transactionFee,
    transactionTimeout,
    account?.publicKey,
    network,
    cancel,
    resetTransaction,
  ]);

  const amountBn = useMemo(() => new BigNumber(amount || "0"), [amount]);

  const handleReview = useCallback(async () => {
    if (!account?.publicKey) {
      return;
    }

    // Asking for a new review clears the last attempt's failure: leaving it
    // on screen made a message about a transaction the user has since
    // changed look like a verdict on the one they are about to make.
    resetTransaction();

    const result = await simulate(
      buildSimulateParams({
        senderAddress: account.publicKey,
        transactionFee,
        transactionTimeout,
        amount,
      }),
    );

    if (result) {
      // Blurred before presenting so the keyboard cannot stay up and keep
      // editing the amount behind the sheet — the figure on the review would
      // then no longer describe the staged XDR that Confirm submits.
      amountInputRef.current?.blur();
      Keyboard.dismiss();
      reviewSheetRef.current?.present();
    }
  }, [
    account?.publicKey,
    simulate,
    buildSimulateParams,
    transactionFee,
    transactionTimeout,
    amount,
    resetTransaction,
  ]);

  const handleConfirm = useCallback(() => {
    reviewSheetRef.current?.dismiss();
    submit(review);
  }, [submit, review]);

  const handleDone = useCallback(() => {
    resetTransaction();
    // `goBack`, not `navigate`: these screens are pushed from the positions
    // list, so popping is unambiguous and — unlike navigating to a route
    // already below in the stack — actually unmounts them. Left mounted, one
    // came back later still holding the balance it was opened with, which is
    // no longer what the position holds.
    goBack();
  }, [resetTransaction, goBack]);

  // Ignore late submission results after leaving this action.
  const handleCloseWhileSubmitting = useCallback(() => {
    abandonTransaction();
    goBack();
  }, [abandonTransaction, goBack]);

  return {
    amount,
    setAmount,
    amountDisplay: amount.replace(
      ".",
      getNumberFormatSettings().decimalSeparator,
    ),
    setAmountFromInput: (value: string) => {
      const { decimalSeparator } = getNumberFormatSettings();
      const normalized = sanitizePastedAmount(value, {
        decimalSeparator,
        maxDecimals: value.length,
      });
      if (value === "" || normalized !== null)
        setAmount(normalized?.replace(decimalSeparator, ".") ?? "");
    },
    reviewAmount: review?.params.amount ?? amount,
    processingAmount: submittedReview?.params.amount ?? amount,
    reviewWithdrawAll: review?.params.withdrawAll ?? false,
    canConfirm:
      !!review &&
      !isSimulating &&
      status !== "authorizing" &&
      status !== "submitting",
    isPreparing:
      isSimulating || status === "authorizing" || status === "submitting",
    submissionError,
    amountBn,
    amountInputRef,
    reviewSheetRef,
    token,
    transactionHash,
    /**
     * Non-null exactly while the terminal screen should be showing, and
     * narrowed to what that screen accepts — a plain boolean would leave the
     * caller to assert the status itself.
     */
    processingStatus:
      status === "submitting" || status === "success" ? status : null,
    securityAssessment: assessTransactionSecurity(review?.scanResult),
    handleReview,
    handleConfirm,
    handleDone,
    handleCloseWhileSubmitting,
  };
};
