import {
  FeeBumpTransaction,
  StrKey,
  Transaction,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { logger } from "config/logger";
import { stroopToXlm } from "helpers/formatAmount";

const ERROR_EVENT_SYMBOL = "error";
/** Topics of a host `error` diagnostic event: the symbol, then the error. */
const ERROR_EVENT_MIN_TOPICS = 2;
/** `SlippageExceeded` in the XOXNO router (`contracts/swap-aggregator/src/errors.rs`). */
const ROUTER_SLIPPAGE_ERROR_CODE = 5;

/**
 * Locates a `pathPaymentStrictSend` operation's position within a built
 * transaction. Operations and their per-operation results are always
 * positionally aligned, so this index is what selects the right entry out of
 * the decoded transaction result.
 */
export const findPathPaymentStrictSendIndex = (
  transaction: Transaction | FeeBumpTransaction,
): number => {
  const operations =
    "innerTransaction" in transaction
      ? transaction.innerTransaction.operations
      : transaction.operations;
  return operations.findIndex((op) => op.type === "pathPaymentStrictSend");
};

/**
 * The result of the transaction that carries the operations. A fee-bump
 * transaction's per-operation results live one level down, in the inner
 * transaction's own result.
 */
const unwrapTransactionResult = (resultXdr: string) => {
  const { result } = xdr.TransactionResult.fromXdr(resultXdr, "base64");

  return result.type === "txFeeBumpInnerSuccess" ||
    result.type === "txFeeBumpInnerFailed"
    ? result.innerResultPair.result.result
    : result;
};

/**
 * Whether a transaction's Horizon result XDR reports the transaction as a
 * success (its operations applied). Returns `false` for a failed transaction
 * and for a result that cannot be parsed; never throws.
 */
export const isTransactionResultSuccess = (resultXdr: string): boolean => {
  try {
    return unwrapTransactionResult(resultXdr).type === "txSuccess";
  } catch {
    return false;
  }
};

/**
 * Reads the *settled* destination amount of a `pathPaymentStrictSend`
 * operation from a transaction's Horizon result XDR — never the quote.
 * Returns whole units (classic/native assets are always 7 decimals, and
 * swap legs are always native or classic).
 *
 * Returns `null` for anything that isn't a clean success read: the
 * transaction/operation didn't succeed, the operation at `operationIndex`
 * wasn't a pathPaymentStrictSend, or the XDR couldn't be parsed. Callers
 * treat `null` as `to_amount_usd_status: "error"` — this never throws out
 * of a telemetry path.
 */
export const getSettledPathPaymentStrictSendAmount = (
  resultXdr: string,
  operationIndex: number,
): BigNumber | null => {
  if (operationIndex < 0) {
    return null;
  }
  try {
    const innerTxResult = unwrapTransactionResult(resultXdr);

    // txSuccess only. A `txFailed` result still carries per-operation
    // results, and an operation that succeeded before a later one failed
    // reports its own success there — but Stellar transactions are atomic, so
    // that path payment was rolled back and nothing settled. Reading an
    // amount out of it would report volume for a swap that never happened.
    if (innerTxResult.type !== "txSuccess") {
      return null;
    }
    const opResults = innerTxResult.results;

    const opResult = opResults[operationIndex];
    if (!opResult || opResult.type !== "opInner") {
      return null;
    }
    if (opResult.tr.type !== "pathPaymentStrictSend") {
      return null;
    }

    const pathResult = opResult.tr.pathPaymentStrictSendResult;
    if (pathResult.type !== "pathPaymentStrictSendSuccess") {
      return null;
    }
    const { success } = pathResult;
    const {
      last: { amount: stroops },
    } = success;

    return stroopToXlm(new BigNumber(stroops.toString()));
  } catch {
    return null;
  }
};

/** Whether `contractId` emitted the event, and its first topic is the given symbol. */
const isEventOf = (
  event: xdr.ContractEvent,
  contractId: string,
  symbol: string,
): boolean => {
  const [topic] = event.body.v0.topics;

  return (
    !!event.contractId &&
    StrKey.encodeContract(event.contractId.toBytes()) === contractId &&
    topic?.type === "scvSymbol" &&
    scValToNative(topic) === symbol
  );
};

/**
 * Whether a diagnostic event is the host's `error` event for a contract error
 * that `contractId` raised with the router's slippage code. The emitter must
 * be the router itself: a token or pool it calls can trap with the same code,
 * and that says nothing about the router's own minimum-output check.
 */
const isRouterSlippageEvent = (
  event: xdr.ContractEvent,
  routerContractId: string,
): boolean => {
  const { topics } = event.body.v0;
  if (
    !isEventOf(event, routerContractId, ERROR_EVENT_SYMBOL) ||
    topics.length < ERROR_EVENT_MIN_TOPICS ||
    topics[1].type !== "scvError"
  ) {
    return false;
  }

  const { error } = topics[1];

  return (
    error.type === "sceContract" &&
    error.contractCode === ROUTER_SLIPPAGE_ERROR_CODE
  );
};

/** Only v4 router-emitted SlippageExceeded diagnostics classify failure; malformed metadata returns false. */
export const isRouterSlippageFailure = (
  metaXdr: string,
  routerContractId: string,
): boolean => {
  try {
    const meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");

    return (
      meta.type === "v4" &&
      meta.v4.diagnosticEvents.some(({ event }) =>
        isRouterSlippageEvent(event, routerContractId),
      )
    );
  } catch (error) {
    logger.error(
      "transactionResult",
      "Failed to read the failed transaction's events",
      error,
    );

    return false;
  }
};
