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

const TRANSFER_EVENT_SYMBOL = "transfer";
/** Topics of a token transfer event: symbol, from, to (a SAC adds the asset). */
const TRANSFER_EVENT_MIN_TOPICS = 3;
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

/**
 * The contract events of a transaction meta: a v3 meta keeps them on its
 * Soroban meta, a v4 meta on each operation.
 */
const contractEventsOf = (meta: xdr.TransactionMeta): xdr.ContractEvent[] => {
  switch (meta.type) {
    case "v3":
      return meta.v3.sorobanMeta?.events ?? [];
    case "v4":
      return meta.v4.operations.flatMap((operation) => operation.events);
    default:
      return [];
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
 * The amount a `transfer` event pays to the viewer, in the token's base units;
 * 0 for any other event. The event data is a bare i128 or a map with an
 * `amount` key.
 */
const transferAmountToViewer = (
  event: xdr.ContractEvent,
  tokenContractId: string,
  viewerPublicKey: string,
): bigint => {
  if (!isEventOf(event, tokenContractId, TRANSFER_EVENT_SYMBOL)) {
    return 0n;
  }

  const { topics, data } = event.body.v0;
  if (
    topics.length < TRANSFER_EVENT_MIN_TOPICS ||
    topics[2].type !== "scvAddress" ||
    scValToNative(topics[2]) !== viewerPublicKey
  ) {
    return 0n;
  }

  const payload: unknown = scValToNative(data);
  const amount =
    typeof payload === "object" && payload !== null && "amount" in payload
      ? payload.amount
      : payload;

  return typeof amount === "bigint" && amount > 0n ? amount : 0n;
};

/**
 * The amount of a Soroban token the viewer received in a transaction, in the
 * token's base units: the sum of the token's `transfer` events to the viewer
 * in the transaction meta (a plain Soroban token has no balance change to read
 * instead).
 *
 * Returns `null` when the meta cannot be decoded or holds no such transfer.
 * This never throws, so a telemetry or history caller can treat `null` as
 * "not observed".
 *
 * @param metaXdr - The base64 `TransactionMeta` XDR
 * @param tokenContractId - The contract that emitted the transfers
 * @param viewerPublicKey - The account that received the tokens
 */
export const getReceivedTokenAmountFromMeta = (
  metaXdr: string,
  tokenContractId: string,
  viewerPublicKey: string,
): bigint | null => {
  try {
    const meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");
    const received = contractEventsOf(meta).reduce(
      (total, event) =>
        total + transferAmountToViewer(event, tokenContractId, viewerPublicKey),
      0n,
    );

    return received === 0n ? null : received;
  } catch (error) {
    logger.error(
      "transactionResult",
      "Failed to read the transaction events",
      error,
    );

    return null;
  }
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

/**
 * Whether the meta of a failed transaction shows the XOXNO router rejecting the
 * swap for slippage: a diagnostic `error` event that the router itself emitted,
 * carrying its `SlippageExceeded` contract error. Only a v4 meta is read (its
 * diagnostic events are the failure's trace); any other version is unknown and
 * reads as `false`.
 *
 * Never throws: a meta that cannot be decoded reads as `false`, so a caller
 * treats "not slippage" and "cannot tell" alike and keeps its generic failure.
 *
 * @param metaXdr - The base64 `TransactionMeta` XDR of the failed transaction
 * @param routerContractId - The router contract of the network
 */
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
