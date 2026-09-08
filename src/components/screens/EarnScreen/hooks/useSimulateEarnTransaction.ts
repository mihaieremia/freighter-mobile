import { useFocusEffect } from "@react-navigation/native";
import {
  EARN_CALLS,
  EarnAction,
  EarnReviewParams,
  PreparedEarnReview,
  prepareEarnReview,
  assertEarnFeeAffordable,
} from "components/screens/EarnScreen/helpers/preparedReview";
import { NATIVE_TOKEN_CODE } from "config/constants";
import { logger } from "config/logger";
import { XoxnoActionParams } from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useEarnStore } from "ducks/earn";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { useBlockaidTransaction } from "hooks/blockaid/useBlockaidTransaction";
import { t } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SimulateEarnDepositParams extends XoxnoActionParams {
  hubId: number;
  spokeId: number;
  acceptingSpokeIds: number[];
}

export interface SimulateEarnWithdrawParams extends XoxnoActionParams {
  accountId: string;
  hubId: number;
  /** True when the user asked for the whole leg — see the builder's docs. */
  withdrawAll: boolean;
}

export interface SimulateEarnRepayParams extends XoxnoActionParams {
  accountId: string;
  hubId: number;
}

export type SimulateEarnSuccess = PreparedEarnReview;

/** Builds one immutable review; obsolete builds and scans never reach the UI. */
const useSimulateEarnTransaction = <TParams extends EarnReviewParams>(
  build: (params: TParams) => Promise<string | null>,
  action: EarnAction,
) => {
  const { scanTransaction } = useBlockaidTransaction();
  const { account, network } = useAuthenticationStore();
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedEarnReview | null>(null);
  const generation = useRef(0);
  const intent = useRef<TParams | null>(null);
  const ownedRequest = useRef<string | null>(null);

  const invalidate = useCallback(() => {
    generation.current += 1;
    const store = useTransactionBuilderStore.getState();
    if (ownedRequest.current && store.requestId === ownedRequest.current) {
      store.resetTransaction();
    }
    ownedRequest.current = null;
  }, []);
  const cancel = useCallback(() => {
    invalidate();
    intent.current = null;
    setPrepared(null);
    setError(null);
    setIsSimulating(false);
  }, [invalidate]);
  useEffect(() => {
    cancel();
    return invalidate;
  }, [account?.publicKey, network, cancel, invalidate]);

  useFocusEffect(useCallback(() => cancel, [cancel]));
  useEffect(
    () =>
      useTransactionSettingsStore.subscribe((settings) => {
        if (
          intent.current &&
          (settings.transactionFee !== intent.current.transactionFee ||
            settings.transactionTimeout !== intent.current.transactionTimeout)
        )
          cancel();
      }),
    [cancel],
  );

  const simulate = useCallback(
    async (params: TParams): Promise<PreparedEarnReview | null> => {
      invalidate();
      const id = generation.current;
      intent.current = { ...params };
      setIsSimulating(true);
      setError(null);
      setPrepared(null);
      const current = () => id === generation.current;
      try {
        const pending = build(params);
        const { requestId } = useTransactionBuilderStore.getState();
        ownedRequest.current = requestId;
        const preparedXdr = await pending;
        if (!current()) return null;
        if (!preparedXdr || !requestId) {
          throw new Error(
            useTransactionBuilderStore.getState().error ||
              t("earnAmount.errors.simulationFailed"),
          );
        }
        const verified = prepareEarnReview(
          action,
          params,
          preparedXdr,
          requestId,
        );
        const balances = useBalancesStore.getState();
        if (
          balances.fetchedPublicKey !== params.senderAddress ||
          balances.fetchedNetwork !== params.network
        ) {
          throw new Error(t("earnSafety.balancesUnavailable"));
        }
        assertEarnFeeAffordable(
          verified,
          balances.pricedBalances[NATIVE_TOKEN_CODE],
          balances.subentryCount,
        );
        let positionBeforeTokens = "0";
        if (EARN_CALLS[action].usesDepositTarget) {
          const target =
            useTransactionBuilderStore.getState().xoxnoDepositTarget;
          if (
            !target ||
            target.accountId !== verified.accountId ||
            target.spokeId !== params.spokeId
          )
            throw new Error(t("earnSafety.positionChanged"));
          positionBeforeTokens = target.suppliedTokens;
        }
        let scanResult: PreparedEarnReview["scanResult"];
        try {
          scanResult = await scanTransaction(preparedXdr, "internal");
        } catch (scanError) {
          logger.warn("Earn", "Transaction scan unavailable", scanError);
        }
        if (!current()) return null;
        if (useTransactionBuilderStore.getState().requestId !== requestId)
          throw new Error(t("earnSafety.superseded"));
        const review: PreparedEarnReview = {
          ...verified,
          assetCode: useEarnStore.getState().selectedAssetCode,
          apy: useEarnStore.getState().selectedAssetApy,
          positionBeforeTokens,
          scanResult,
        };
        Object.freeze(review.params);
        Object.freeze(review);
        setPrepared(review);
        return review;
      } catch (err) {
        if (current()) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          invalidate();
          setIsSimulating(false);
        }
        return null;
      } finally {
        if (current()) setIsSimulating(false);
      }
    },
    [action, build, scanTransaction, invalidate],
  );

  return {
    simulate,
    isSimulating,
    error,
    prepared,
    cancel,
    scanResult: prepared?.scanResult,
  };
};

export const useSimulateEarnDeposit = () =>
  useSimulateEarnTransaction<SimulateEarnDepositParams>(
    useTransactionBuilderStore((state) => state.buildXoxnoDepositTransaction),
    "deposit",
  );
export const useSimulateEarnWithdraw = () =>
  useSimulateEarnTransaction<SimulateEarnWithdrawParams>(
    useTransactionBuilderStore((state) => state.buildXoxnoWithdrawTransaction),
    "withdraw",
  );
export const useSimulateEarnRepay = () =>
  useSimulateEarnTransaction<SimulateEarnRepayParams>(
    useTransactionBuilderStore((state) => state.buildXoxnoRepayTransaction),
    "repay",
  );
