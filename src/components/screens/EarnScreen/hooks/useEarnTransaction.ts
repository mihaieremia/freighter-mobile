import {
  PreparedEarnReview,
  assertEarnFeeAffordable,
} from "components/screens/EarnScreen/helpers/preparedReview";
import { NATIVE_TOKEN_CODE, NETWORKS } from "config/constants";
import { logger } from "config/logger";
import { ActiveAccount, useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { isWalletUnlocked } from "hooks/useGetActiveAccount";
import { t } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { analytics } from "services/analytics";

export type EarnTransactionStatus =
  | "idle"
  | "authorizing"
  | "submitting"
  | "success"
  | "error";

/**
 * How long to wait for the network before telling the user we do not know.
 *
 * Horizon's own submit has no deadline and retries a 504 with backoff, so a
 * stalled connection can hang indefinitely. Sixty seconds is past the point
 * where those retries would have finished, and well past a healthy submit.
 */
const SUBMIT_DEADLINE_MS = 60_000;

/** Every Earn confirmation, including warning overrides, uses this gate. */
export const useEarnTransaction = ({
  account,
  network,
}: {
  account: ActiveAccount | null;
  network: NETWORKS;
}) => {
  const [status, setStatus] = useState<EarnTransactionStatus>("idle");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [submittedReview, setSubmittedReview] =
    useState<PreparedEarnReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<symbol | null>(null);
  const busy = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRequest = useRef<string | null>(null);
  const abandon = useCallback(() => {
    active.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);
  useEffect(() => {
    abandon();
    busy.current = false;
    setStatus("idle");
    setError(null);
    setTransactionHash(null);
    return abandon;
  }, [account?.publicKey, network, abandon]);

  const submit = useCallback(
    async (review: PreparedEarnReview | null) => {
      if (
        !account ||
        !review ||
        busy.current ||
        submittedRequest.current === review.requestId
      )
        return;
      busy.current = true;
      const id = Symbol("earn-confirmation");
      active.current = id;
      const current = () => active.current === id;
      setError(null);
      setStatus("authorizing");
      try {
        if (!isWalletUnlocked()) {
          setStatus("idle");
          return;
        }
        const validate = () => {
          const auth = useAuthenticationStore.getState();
          const builder = useTransactionBuilderStore.getState();
          if (!isWalletUnlocked())
            throw new Error(t("earnSafety.walletLocked"));
          // What guarantees the user signs what they reviewed is
          // `expectedXdr` at the signing call itself. These checks only
          // catch the cases worth naming before the biometric prompt, each
          // with its own message.
          //
          // The fee and timeout are deliberately NOT among them. The
          // reviewed transaction already carries the fee it was built with,
          // so a later change to the stored settings cannot alter what gets
          // signed — and the flow prewarms a recommended fee in the
          // background, so comparing them refused perfectly good
          // transactions on the strength of a preference moving.
          if (
            auth.account?.publicKey !== review.params.senderAddress ||
            auth.network !== review.params.network
          ) {
            throw new Error(t("earnSafety.accountChanged"));
          }
          if (
            builder.isBuilding ||
            builder.requestId !== review.requestId ||
            builder.transactionXDR !== review.preparedXdr
          ) {
            throw new Error(t("earnSafety.changed"));
          }
          if (Date.now() >= review.expiresAt)
            throw new Error(t("earnSafety.expired"));
          const balances = useBalancesStore.getState();
          if (
            balances.fetchedPublicKey !== review.params.senderAddress ||
            balances.fetchedNetwork !== review.params.network
          ) {
            throw new Error(t("earnSafety.balancesUnavailable"));
          }
          assertEarnFeeAffordable(
            review,
            balances.pricedBalances[NATIVE_TOKEN_CODE],
            balances.subentryCount,
          );
          return { auth, builder, balances };
        };
        validate();
        try {
          await useAuthenticationStore
            .getState()
            .verifyActionWithBiometrics(() => Promise.resolve(undefined));
        } catch {
          if (current()) setStatus("idle");
          return; // Biometric cancellation is not a failed transaction.
        }
        if (!current()) return;
        const { auth, builder, balances } = validate();
        submittedRequest.current = review.requestId;
        setSubmittedReview(review);
        setStatus("submitting");
        const signed = builder.signTransaction({
          secretKey: auth.account!.privateKey,
          network: review.params.network,
          expectedXdr: review.preparedXdr,
        });
        if (!signed)
          throw new Error(
            useTransactionBuilderStore.getState().error ||
              t("earnSafety.signatureRejected"),
          );
        // Bounded: the submit call itself has no deadline, so a stalled
        // connection used to leave this screen spinning with no way out but
        // the close button. A timeout is NOT a failure — the transaction may
        // already be in a ledger — so the message says so.
        const hash = await Promise.race([
          builder.submitTransaction({ network: review.params.network }),
          new Promise<never>((_, reject) => {
            timeoutRef.current = setTimeout(
              () => reject(new Error(t("earnSafety.submitTimedOut"))),
              SUBMIT_DEADLINE_MS,
            );
          }),
        ]);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (!current()) return;
        if (!hash) {
          const builderState = useTransactionBuilderStore.getState();
          const codes = [
            builderState.submitErrorResultCodes?.transaction,
            ...(builderState.submitErrorResultCodes?.operations ?? []),
          ].filter(Boolean);
          // Horizon's own prose says only that something failed and points at
          // a field the user cannot see. The result codes name the reason.
          throw new Error(
            codes.length
              ? `${String(t("earnSafety.networkRejected"))} (${codes.join(", ")})`
              : builderState.error || t("earnSafety.submitFailed"),
          );
        }
        setTransactionHash(hash);
        setStatus("success");
        // Refresh errors cannot turn a confirmed transaction into a failure.
        balances
          .fetchAccountBalances({
            publicKey: review.params.senderAddress,
            network: review.params.network,
          })
          .catch((refreshError) =>
            logger.warn("Earn", "Balance refresh delayed", refreshError),
          );
        if (review.action === "deposit") {
          analytics.trackEarnDepositSuccess({
            assetCode: review.assetCode,
            hubId: String(review.params.hubId),
            apy: review.apy,
          });
        }
      } catch (err) {
        if (!current()) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("error");
        const builder = useTransactionBuilderStore.getState();
        // The funnel's failure half. Paired with trackEarnDepositSuccess
        // above: without it a deposit that fails leaves the funnel with a
        // start and no end. The reason code is Horizon's, never the message.
        if (review.action === "deposit") {
          analytics.trackEarnDepositFail({
            assetCode: review.assetCode,
            hubId: String(review.params.hubId),
            apy: review.apy,
            errorCode:
              builder.submitErrorResultCodes?.operations?.[0] ||
              builder.submitErrorResultCodes?.transaction,
          });
        }
        if (builder.requestId === review.requestId) builder.resetTransaction();
        logger.warn("Earn", "Transaction failed", err);
      } finally {
        // `busy` guards re-entry into this hook, so it clears either way:
        // an abandoned request has already stopped writing state, but the
        // slot it held is free. Clearing it only while current left a hook
        // that had been abandoned refusing every later submit.
        if (current()) {
          active.current = null;
        }
        busy.current = false;
      }
    },
    [account],
  );

  const reset = useCallback(() => {
    if (busy.current) return;
    setStatus((currentStatus) =>
      currentStatus === "success" ? "success" : "idle",
    );
    setError(null);
  }, []);
  return {
    status,
    transactionHash,
    submittedReview,
    error,
    submit,
    reset,
    abandon,
  };
};
