import BigNumber from "bignumber.js";
import { TransactionDetails } from "components/screens/HistoryScreen/types";
import { NETWORKS } from "config/constants";
import { useCallback, useEffect, useState } from "react";
import {
  fetchSwapReceipt,
  getTokenDetails,
  SwapReceiptResponse,
} from "services/backend";

export type HistoryReceiptStatus = "loading" | "confirmed" | "unavailable";
const confirmedReceipts = new Map<string, SwapReceiptResponse>();
const MAX_CACHED_RECEIPTS = 100;
const keyOf = (receipt: NonNullable<TransactionDetails["xoxnoReceipt"]>) =>
  `${receipt.network}:${receipt.transactionHash}:${receipt.operationIndex}:${receipt.viewer}`;

export const useHistorySwapReceipt = (
  details: TransactionDetails | null,
  network: NETWORKS,
  viewer: string,
) => {
  const [retryCount, setRetryCount] = useState(0);
  const [resolved, setResolved] = useState<{
    original: TransactionDetails;
    details: TransactionDetails;
    status: HistoryReceiptStatus;
  } | null>(null);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    const receipt = details?.xoxnoReceipt;
    if (
      !details ||
      !receipt ||
      receipt.network !== network ||
      receipt.viewer !== viewer
    )
      return undefined;
    const controller = new AbortController();
    let current = true;
    setResolved({ original: details, details, status: "loading" });
    const load = async () => {
      try {
        const key = keyOf(receipt);
        const metadata = Promise.all([
          receipt.sourceDecimals === undefined
            ? getTokenDetails({
                contractId: receipt.tokenIn,
                publicKey: viewer,
                network,
                signal: controller.signal,
              })
            : Promise.resolve(null),
          receipt.destinationDecimals === undefined
            ? getTokenDetails({
                contractId: receipt.tokenOut,
                publicKey: viewer,
                network,
                signal: controller.signal,
              })
            : Promise.resolve(null),
        ]).catch(() => [null, null] as const);
        const cached = confirmedReceipts.get(key);
        const result =
          cached?.tokenOut === receipt.tokenOut
            ? cached
            : await fetchSwapReceipt(
                receipt,
                receipt.tokenOut,
                controller.signal,
              );
        if (!current || controller.signal.aborted) return;
        if (result.status === "confirmed") {
          if (
            !confirmedReceipts.has(key) &&
            confirmedReceipts.size >= MAX_CACHED_RECEIPTS
          )
            confirmedReceipts.delete(confirmedReceipts.keys().next().value!);
          confirmedReceipts.set(key, result);
        }
        const enrich = (
          sourceMeta: Awaited<ReturnType<typeof getTokenDetails>>,
          destinationMeta: Awaited<ReturnType<typeof getTokenDetails>>,
        ) => {
          const validDecimals = (decimals?: number) =>
            decimals !== undefined &&
            Number.isInteger(decimals) &&
            decimals >= 0 &&
            decimals <= 255
              ? decimals
              : undefined;
          const sourceDecimals = validDecimals(
            receipt.sourceDecimals ?? sourceMeta?.decimals,
          );
          const destinationDecimals = validDecimals(
            receipt.destinationDecimals ?? destinationMeta?.decimals,
          );
          const destinationAmount =
            result.status === "confirmed" && result.receivedAtoms
              ? new BigNumber(result.receivedAtoms)
                  .shiftedBy(-(destinationDecimals ?? 0))
                  .toFixed()
              : "";
          const enriched: TransactionDetails = {
            ...details,
            xoxnoReceipt: { ...receipt, sourceDecimals, destinationDecimals },
            swapDetails: details.swapDetails && {
              ...details.swapDetails,
              sourceTokenCode:
                sourceMeta?.symbol || details.swapDetails.sourceTokenCode,
              destinationTokenCode:
                destinationMeta?.symbol ||
                details.swapDetails.destinationTokenCode,
              sourceAmount: new BigNumber(receipt.sourceAtoms)
                .shiftedBy(-(sourceDecimals ?? 0))
                .toFixed(),
              destinationAmount,
            },
          };
          setResolved({
            original: details,
            details: enriched,
            status: result.status,
          });
        };
        enrich(null, null);
        const [sourceMeta, destinationMeta] = await metadata;
        if (current && !controller.signal.aborted)
          enrich(sourceMeta, destinationMeta);
      } catch {
        if (current && !controller.signal.aborted)
          setResolved({ original: details, details, status: "unavailable" });
      }
    };
    load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [details, network, viewer, retryCount]);

  const applicable = details?.xoxnoReceipt
    ? details.xoxnoReceipt.network === network &&
      details.xoxnoReceipt.viewer === viewer
    : true;
  const activeDetails =
    resolved?.original === details ? resolved.details : details;
  return {
    details: applicable ? activeDetails : null,
    status:
      resolved?.original === details
        ? resolved.status
        : ("loading" as HistoryReceiptStatus),
    retry,
  };
};
