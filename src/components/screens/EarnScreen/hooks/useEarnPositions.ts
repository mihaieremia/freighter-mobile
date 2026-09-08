import {
  BALANCES_FETCH_POLLING_INTERVAL,
  mapNetworkToNetworkDetails,
} from "config/constants";
import { logger } from "config/logger";
import { XoxnoPosition } from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import { useFocusedPolling } from "hooks/useFocusedPolling";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getXoxnoPositions } from "services/xoxno";

export interface UseEarnPositionsResult {
  /** Null until the first fetch resolves; empty when the account has none. */
  positions: XoxnoPosition[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Active-account positions, refreshed on focus, resume and every 30 seconds. */
export const useEarnPositions = (): UseEarnPositionsResult => {
  const { account } = useGetActiveAccount();
  const { network } = useAuthenticationStore();
  const publicKey = account?.publicKey;

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  const [positions, setPositions] = useState<XoxnoPosition[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const scope = `${publicKey}:${network}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const fetchData = useCallback(async () => {
    const id = ++generation.current;
    const current = () =>
      id === generation.current && activeScope.current === scope;
    if (!publicKey) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await getXoxnoPositions({ publicKey, networkDetails });
      if (current()) setPositions(result);
    } catch (err) {
      logger.error("useEarnPositions", "Failed to fetch positions", err);
      if (!current()) return;
      // The last good list is kept: this also runs for every background poll,
      // and dropping it there tore a rendered position list down to the
      // could-not-load page until the next poll happened to succeed. Before
      // the first success there is nothing to keep, so `positions` is still
      // null and the error page shows as it should.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [publicKey, networkDetails, scope]);

  useEffect(() => {
    setPositions(null);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [scope]);

  // `fetchData` never rejects — it reports failure through `error` — so the
  // exposed `refetch` drops its promise, letting effects and button handlers
  // call it as a plain synchronous function.
  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useFocusedPolling({
    onPoll: refetch,
    interval: BALANCES_FETCH_POLLING_INTERVAL,
    refreshOnFocus: true,
  });
  return { positions, isLoading, error, refetch };
};
