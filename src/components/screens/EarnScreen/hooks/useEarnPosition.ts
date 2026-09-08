import { NetworkDetails } from "config/constants";
import { logger } from "config/logger";
import { useEarnStore } from "ducks/earn";
import { useEffect } from "react";
import { getXoxnoDepositTarget } from "services/xoxno";

export interface UseEarnPositionParams {
  hubId: number | null;
  /** Spokes accepting this asset; a position in any of them can be topped up. */
  acceptingSpokeIds: number[];
  /** The spoke a new position would open in. */
  spokeId: number;
  assetId: string;
  publicKey: string;
  networkDetails: NetworkDetails;
}

/**
 * Fetches the account's existing XOXNO position for (hubId, assetId) and
 * writes it to the earn duck as the "before" value Review reads for its
 * before -> after row.
 *
 * A no-op until every input has resolved (e.g. before `hub` has loaded on
 * the token picker), since `getXoxnoDepositTarget` cannot answer without
 * all four.
 *
 * A failed fetch is deliberately non-fatal: it is logged and swallowed,
 * leaving `currentPositionTokens` at whatever the duck already held (its "0"
 * default on a fresh flow) rather than blocking the deposit. A stale or
 * missing before-value must never gate Review — that is explicit in the
 * spec, since the "after" value alone is still a usable review.
 */
export const useEarnPosition = ({
  hubId,
  acceptingSpokeIds,
  spokeId,
  assetId,
  publicKey,
  networkDetails,
}: UseEarnPositionParams): void => {
  const setCurrentPositionTokens = useEarnStore(
    (state) => state.setCurrentPositionTokens,
  );

  useEffect(() => {
    if (!hubId || !assetId || !publicKey) {
      return undefined;
    }

    // Guards against a slow/late response landing after a newer request has
    // superseded it (e.g. the user backed out and re-entered with a
    // different asset) — the same "only the latest write wins" shape used by
    // `transactionBuilder`'s requestId guard, minus the store field, since
    // an unmount is enough of a signal here.
    let isCancelled = false;

    (async () => {
      try {
        const target = await getXoxnoDepositTarget({
          publicKey,
          hubId,
          assetId,
          spokeId,
          acceptingSpokeIds,
          networkDetails,
        });

        if (!isCancelled) {
          setCurrentPositionTokens(target.suppliedTokens);
        }
      } catch (err) {
        // Non-fatal by design: Review renders the "after" value alone rather
        // than blocking the deposit on an unavailable before-value.
        logger.error("useEarnPosition", "Failed to fetch XOXNO position", err);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    hubId,
    assetId,
    publicKey,
    spokeId,
    acceptingSpokeIds,
    networkDetails,
    setCurrentPositionTokens,
  ]);
};
