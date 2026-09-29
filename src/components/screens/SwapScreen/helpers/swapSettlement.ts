import { TransactionBuilder } from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { logger } from "config/logger";
import { PricedBalance } from "config/types";
import { XOXNO_SWAP_ROUTER } from "config/xoxnoSwap";
import { SubmitTransactionOutcome } from "ducks/transactionBuilder";
import { ConfirmationPriceSnapshot } from "helpers/confirmationPriceSnapshot";
import { getBalanceDecimals } from "helpers/formatAmount";
import { swapContractId } from "helpers/swapAssets";
import {
  findPathPaymentStrictSendIndex,
  getReceivedTokenAmountFromMeta,
  getSettledPathPaymentStrictSendAmount,
  isRouterSlippageFailure,
  isTransactionResultSuccess,
} from "helpers/transactionResult";
import {
  AssetIdentity,
  LegUsdStatus,
  computeExecutionSlippagePct,
  computeUsdSlippagePct,
  deriveLegUsd,
} from "helpers/usdVolume";
import { analytics } from "services/analytics";
import { fetchTransactionMeta } from "services/stellarExpert";

/**
 * Stellar Expert may not have indexed a transaction the moment it is
 * submitted, so a settled swap's meta is asked for up to three times in all, the
 * waits doubling from three seconds, before the amount is reported as not
 * readable.
 */
const SETTLED_META_RETRY = { retries: 2, initialDelay: 3000 };

/**
 * A rejected router swap's meta is asked for twice, two seconds apart, and the
 * whole lookup gives up after the budget, so the failure UI waits at most that
 * long for the verdict (a lookup that is still running then is left to end).
 */
const SLIPPAGE_META_RETRY = { retries: 1, initialDelay: 2000 };
const SLIPPAGE_LOOKUP_BUDGET_MS = 6000;

/** Horizon's HTTP status for a transaction it evaluated and rejected. */
const HTTP_STATUS_REJECTED = 400;
const TX_FAILED_CODE = "tx_failed";
/** Horizon's operation result code for a Soroban call that trapped. */
const FUNCTION_TRAPPED_CODE = "function_trapped";

/**
 * Reads the settled destination amount of a submitted swap, in whole units,
 * from the transaction itself, never the quote.
 *
 * A classic swap reads it from its `pathPaymentStrictSend` result. An
 * aggregator swap (an `invokeHostFunction`, so no path payment) reads it from
 * the transfers of the destination token to the account in the transaction
 * meta. The submit response's meta is decoded at once; when the response
 * carries none (Horizon leaves it out for Soroban transactions), Stellar Expert
 * is asked for it, up to three times, waiting three and then six seconds, for
 * indexing lag.
 * Returns `null` when the amount cannot be read (the transaction did not
 * succeed, no meta, unparseable XDR); it never throws, so the caller reports
 * the leg as `error` rather than failing the swap.
 */
const readSettledDestinationAmount = async ({
  outcome,
  signedXDR,
  network,
  destination,
  publicKey,
}: {
  outcome: SubmitTransactionOutcome;
  signedXDR: string;
  network: NETWORKS;
  destination: PricedBalance;
  publicKey: string;
}): Promise<BigNumber | null> => {
  try {
    const { networkPassphrase } = mapNetworkToNetworkDetails(network);
    const submittedTx = TransactionBuilder.fromXdr(
      signedXDR,
      networkPassphrase,
    );
    const opIndex = findPathPaymentStrictSendIndex(submittedTx);

    if (opIndex >= 0) {
      return outcome.resultXdr
        ? getSettledPathPaymentStrictSendAmount(outcome.resultXdr, opIndex)
        : null;
    }

    if (!outcome.resultXdr || !isTransactionResultSuccess(outcome.resultXdr)) {
      return null;
    }

    const metaXdr =
      outcome.resultMetaXdr ??
      (outcome.hash
        ? await fetchTransactionMeta(outcome.hash, network, SETTLED_META_RETRY)
        : null);
    if (!metaXdr) {
      return null;
    }

    const received = getReceivedTokenAmountFromMeta(
      metaXdr,
      swapContractId(destination, networkPassphrase),
      publicKey,
    );

    return received === null
      ? null
      : new BigNumber(received.toString()).shiftedBy(
          -getBalanceDecimals(destination),
        );
  } catch (error) {
    logger.error(
      "SwapSettlement",
      "Failed to read the settled destination amount",
      error,
    );

    return null;
  }
};

/**
 * Whether a rejected submit is a Soroban call that trapped: Horizon evaluated
 * the transaction (`400`, `tx_failed`) and an operation reports
 * `function_trapped`. Anything else (a bad sequence, an expired transaction, a
 * 5xx whose outcome is undetermined, a transport error) says nothing about the
 * router, so it is never worth a lookup.
 */
const isTrappedSorobanRejection = (
  outcome: SubmitTransactionOutcome,
): boolean =>
  outcome.isProtocolAnswer &&
  outcome.httpStatus === HTTP_STATUS_REJECTED &&
  outcome.resultCodes?.transaction === TX_FAILED_CODE &&
  !!outcome.resultCodes.operations?.includes(FUNCTION_TRAPPED_CODE);

/**
 * Asks for the failed transaction's meta within the slippage budget. A lookup
 * still running at the deadline has its result dropped.
 */
const fetchFailedMeta = (
  hash: string,
  network: NETWORKS,
): Promise<string | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SLIPPAGE_LOOKUP_BUDGET_MS);
  });

  return Promise.race([
    fetchTransactionMeta(hash, network, SLIPPAGE_META_RETRY),
    deadline,
  ]).finally(() => clearTimeout(timer));
};

/**
 * Whether a rejected router swap was rejected for slippage: the router's own
 * `SlippageExceeded` contract error. Horizon reports every trapped Soroban call
 * as `function_trapped`, so the reason is only in the failed transaction's
 * diagnostic events, which Stellar Expert serves.
 *
 * The cheap gate needs no network: only a `400 tx_failed` with a
 * `function_trapped` operation on a network with a router qualifies. Only then
 * is the meta fetched, at most `SLIPPAGE_LOOKUP_BUDGET_MS` of waiting in all.
 * Never throws: any doubt (no meta, undecodable meta, another error or
 * contract) is `false`, and the caller keeps its generic failure.
 */
export const isAggregatorSlippageRejection = async ({
  outcome,
  signedXDR,
  network,
}: {
  outcome: SubmitTransactionOutcome;
  signedXDR: string;
  network: NETWORKS;
}): Promise<boolean> => {
  const routerContractId = XOXNO_SWAP_ROUTER[network];
  if (!routerContractId || !isTrappedSorobanRejection(outcome)) {
    return false;
  }

  try {
    const { networkPassphrase } = mapNetworkToNetworkDetails(network);
    // `hash()` is a Uint8Array, whose own `toString` is not hex.
    const hash = Buffer.from(
      TransactionBuilder.fromXdr(signedXDR, networkPassphrase).hash(),
    ).toString("hex");
    const metaXdr = await fetchFailedMeta(hash, network);

    return metaXdr ? isRouterSlippageFailure(metaXdr, routerContractId) : false;
  } catch (error) {
    logger.error(
      "SwapSettlement",
      "Failed to tell whether the router rejected the swap for slippage",
      error,
    );

    return false;
  }
};

/**
 * Everything `reportSettledSwap` needs, captured before the swap screen can go
 * away: the report outlives the hook that started it.
 */
interface SettledSwapReport {
  outcome: SubmitTransactionOutcome;
  signedXDR: string;
  network: NETWORKS;
  destination: PricedBalance;
  publicKey: string;
  snapshot: ConfirmationPriceSnapshot;
  sourceAmount: string;
  sourceCanonicalId: string;
  destCanonicalId: string;
  sourceIdentity: AssetIdentity;
  destIdentity: AssetIdentity;
  sourceToken: string;
  destToken: string;
  /** The destination amount the signed swap quoted. */
  quotedDestinationAmount: string | undefined;
  allowedSlippage: string | undefined;
}

/**
 * Reads the settled destination amount and emits `swap.completed` with the
 * volume figures. Started without being awaited after a swap settled, so the
 * user-visible flow never waits for the read; it holds no hook or component
 * state and never throws.
 *
 * When Stellar Expert cannot supply the meta the event still fires, with
 * `to_amount_usd_status: "error"` and no `to_amount`.
 */
export const reportSettledSwap = async (
  report: SettledSwapReport,
): Promise<void> => {
  try {
    const {
      snapshot,
      sourceAmount,
      sourceCanonicalId,
      destCanonicalId,
      quotedDestinationAmount,
    } = report;
    const settledDestAmount = await readSettledDestinationAmount(report);

    const sourceLeg = deriveLegUsd(
      sourceAmount,
      snapshot.pricesById?.[sourceCanonicalId]?.currentPrice,
    );
    const destLeg =
      settledDestAmount !== null
        ? deriveLegUsd(
            settledDestAmount,
            snapshot.pricesById?.[destCanonicalId]?.currentPrice,
          )
        : null;

    const executionSlippagePct =
      settledDestAmount !== null
        ? computeExecutionSlippagePct(
            quotedDestinationAmount,
            settledDestAmount,
          )
        : undefined;
    const usdSlippagePct =
      sourceLeg.status === LegUsdStatus.OK &&
      destLeg?.status === LegUsdStatus.OK &&
      sourceLeg.value !== 0
        ? computeUsdSlippagePct(sourceLeg.unrounded, destLeg.unrounded)
        : undefined;

    analytics.trackSwapSuccess({
      sourceToken: report.sourceToken,
      destToken: report.destToken,
      sourceAmount,
      destAmount: quotedDestinationAmount,
      allowedSlippage: report.allowedSlippage,
      isSwap: true,
      volume: {
        identity: report.sourceIdentity,
        toIdentity: report.destIdentity,
        amount: new BigNumber(sourceAmount || 0).toNumber(),
        sourceLeg,
        priceSource: snapshot.source,
        priceFreshness: snapshot.freshness,
        ...(quotedDestinationAmount
          ? {
              toAmountQuoted: new BigNumber(quotedDestinationAmount).toNumber(),
            }
          : {}),
        ...(settledDestAmount !== null
          ? { toAmount: settledDestAmount.toNumber() }
          : {}),
        toAmountUsdStatus: destLeg?.status ?? LegUsdStatus.ERROR,
        ...(destLeg?.status === LegUsdStatus.OK
          ? { toAmountUsd: destLeg.value, toAmountUsdRate: destLeg.rate }
          : {}),
        ...(usdSlippagePct !== undefined ? { usdSlippagePct } : {}),
        ...(executionSlippagePct !== undefined ? { executionSlippagePct } : {}),
      },
    });
  } catch (error) {
    logger.error("SwapSettlement", "Failed to report the settled swap", error);
  }
};
