import { TransactionBuilder } from "@stellar/stellar-sdk";
import { decodeSwapEnvelope, getSwapRouter } from "@xoxno/stellar-swap";
import BigNumber from "bignumber.js";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { logger } from "config/logger";
import { PricedBalance } from "config/types";
import { SubmitTransactionOutcome } from "ducks/transactionBuilder";
import { ConfirmationPriceSnapshot } from "helpers/confirmationPriceSnapshot";
import { getBalanceDecimals } from "helpers/formatAmount";
import { swapContractId } from "helpers/swapAssets";
import {
  findPathPaymentStrictSendIndex,
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
import { fetchSwapReceipt } from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

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

/** Actual confirmed output; enrichment failures never fail a successful swap. */
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

    if (!outcome.hash) return null;
    const call = decodeSwapEnvelope({
      envelopeXdr: signedXDR,
      networkPassphrase,
      viewer: publicKey,
    });
    if (!call) return null;
    const receipt = await fetchSwapReceipt(
      {
        network,
        transactionHash: outcome.hash,
        viewer: publicKey,
        operationIndex: call.operationIndex,
      },
      swapContractId(destination, networkPassphrase),
    );
    return receipt.status === "confirmed" && receipt.receivedAtoms
      ? new BigNumber(receipt.receivedAtoms).shiftedBy(
          -getBalanceDecimals(destination),
        )
      : null;
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

/** Only a 400 tx_failed/function_trapped triggers bounded router-specific diagnostic lookup. */
export const isAggregatorSlippageRejection = async ({
  outcome,
  signedXDR,
  network,
}: {
  outcome: SubmitTransactionOutcome;
  signedXDR: string;
  network: NETWORKS;
}): Promise<boolean> => {
  const routerContractId = getSwapRouter(
    mapNetworkToNetworkDetails(network).networkPassphrase,
    "xoxno",
  );
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
