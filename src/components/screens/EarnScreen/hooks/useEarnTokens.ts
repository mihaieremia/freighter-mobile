import BigNumber from "bignumber.js";
import { displayCode } from "components/screens/EarnScreen/helpers";
import {
  DEFAULT_DECIMALS,
  BALANCES_FETCH_POLLING_INTERVAL,
  mapNetworkToNetworkDetails,
  NetworkDetails,
} from "config/constants";
import { logger } from "config/logger";
import { PricedBalance, PricedBalanceMap } from "config/types";
import {
  XoxnoEarnAssetOption,
  XoxnoEarnSpoke,
  XoxnoHub,
} from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { getBalanceByContractId } from "helpers/balances";
import { getNativeContractDetails } from "helpers/soroban";
import { useFocusedPolling } from "hooks/useFocusedPolling";
import useGetActiveAccount from "hooks/useGetActiveAccount";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { foldXoxnoHubs, getXoxnoEarnOptions } from "services/xoxno";

/** One row in the picker. */
export interface EarnTokenOption {
  /** The reserve's asset contract address (a SAC for every current reserve). */
  assetId: string;
  code: string;
  decimals: number;
  /** Raw total in display units, "0" when the account holds none. */
  total: string;
  /**
   * Headline rate as a decimal fraction (0.1694 = 16.94%), or null when the
   * hub oracle has no fresh price and the rate is genuinely unknown.
   */
  apy: number | null;
  hubId: number;
  /** The hub's display name, shown once the asset is chosen. */
  hubName: string | null;
  /**
   * Risk spokes accepting this deposit, best first. All earn the same; they
   * differ in whether the deposit can be borrowed against and on what terms.
   */
  spokes: XoxnoEarnSpoke[];
  /**
   * The catalog's canonical asset id -- "CODE:ISSUER" for classic assets,
   * null for native XLM (and for anything the catalog leaves unnamed).
   *
   * Carried because Earn's reserves are addressed by SAC contract id, but
   * swapping into one is classic-only (`pathPaymentStrictSend` rejects
   * contract-id assets), so the swap destination has to be rebuilt from the
   * issuer. `assetId` cannot supply it -- a SAC address is not decomposable
   * back into code + issuer.
   */
  canonicalId: string | null;
  /**
   * True when this reserve's contract address is the network's native SAC.
   * Decided by comparing `assetId` to the derived native contract address —
   * NEVER by `code === "XLM"` — because any issuer can mint a classic asset
   * coded "XLM" (the same trap `getBalanceByContractId` guards against).
   * Lets `EarnTokenRow` build the right `TokenIcon` input without a held
   * balance to read the real token shape from.
   */
  isNative: boolean;
  /**
   * The held balance backing this row, when any. Carries the real Token
   * shape so the row renders the exact icon instead of reconstructing one
   * from catalog data alone. Undefined for zero-balance rows.
   */
  balance?: PricedBalance;
}

/**
 * Partitions the catalog into held and zero-balance rows.
 *
 * Exported and dependency-injected (`findBalance`) so the partitioning rules
 * can be tested without a React tree or a network.
 */
export const buildEarnTokenRows = ({
  options,
  balances,
  networkDetails,
  findBalance = getBalanceByContractId,
}: {
  options: XoxnoEarnAssetOption[];
  balances: PricedBalanceMap;
  networkDetails: NetworkDetails;
  findBalance?: (
    contractId: string,
    balances: PricedBalanceMap,
    networkDetails: NetworkDetails,
  ) => PricedBalance | undefined;
}) => {
  const held: EarnTokenOption[] = [];
  const supported: EarnTokenOption[] = [];

  const nativeContractId = getNativeContractDetails(
    networkDetails.network,
  ).contract;

  options.forEach((option) => {
    // Every asset is listed in exactly one hub, so picking the token settles
    // the hub. An asset with no spoke accepting a deposit is skipped: the
    // catalog would still list it, but nothing could be supplied to it.
    const [offer] = option.offers;
    if (!offer || offer.spokes.length === 0) {
      return;
    }

    const balance = findBalance(option.assetId, balances, networkDetails);
    const total = balance?.total ? new BigNumber(balance.total) : null;

    // `symbol` is null for native XLM on the live catalog, so it cannot be the
    // only source of the display code — taking it alone renders the row with no
    // token code at all. `name` is deliberately NOT a candidate: for classic
    // assets the catalog returns the canonical there ("USDC:GA5ZSEJY…"), not a
    // friendly name.
    const balanceCode = balance && "token" in balance ? balance.token.code : "";
    const code = balanceCode || displayCode(option.symbol, option.assetId);

    const row: EarnTokenOption = {
      assetId: option.assetId,
      code,
      decimals: option.decimals ?? DEFAULT_DECIMALS,
      total: total ? total.toFixed() : "0",
      // XOXNO runs no emissions programme, so the supply rate is the whole
      // headline; a null means no fresh oracle price and an unknown rate.
      apy: offer.supplyApy,
      hubId: offer.hubId,
      hubName: offer.name,
      spokes: offer.spokes,
      canonicalId: option.name,
      isNative: option.assetId === nativeContractId,
      balance,
    };

    if (total && total.gt(0)) {
      held.push(row);
    } else {
      supported.push(row);
    }
  });

  // Best return first in both sections. An unknown rate sorts last rather
  // than as zero: it is missing, not bad, and putting it among the genuine
  // zeros would state something the catalog did not.
  const byApyDescending = (a: EarnTokenOption, b: EarnTokenOption) => {
    if (a.apy === b.apy) {
      return 0;
    }
    if (a.apy === null) {
      return 1;
    }
    return b.apy === null ? -1 : b.apy - a.apy;
  };

  return {
    held: held.sort(byApyDescending),
    supported: supported.sort(byApyDescending),
  };
};

export const useEarnTokens = () => {
  const { account } = useGetActiveAccount();
  const { network } = useAuthenticationStore();
  const { pricedBalances } = useBalancesStore();

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  /**
   * The fetched catalog, kept RAW.
   *
   * Rows are derived from it separately (below) rather than being built here,
   * because they also depend on `pricedBalances` -- which the balances store
   * repolls every 30s. Folding that into the fetch made `fetchData` a new
   * callback on every poll, re-running the effect, flipping `isLoading` back
   * to true, and unmounting this screen (and every bottom sheet mounted under
   * it) on a 30-second cadence. Deriving instead keeps the network call tied
   * to the account/network only.
   */
  const [catalog, setCatalog] = useState<{
    options: XoxnoEarnAssetOption[];
    hubs: XoxnoHub[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const scope = `${account?.publicKey}:${network}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const fetchData = useCallback(async () => {
    const id = ++generation.current;
    const current = () =>
      id === generation.current && activeScope.current === scope;
    setIsLoading(true);
    setError(null);

    try {
      const earnOptions = await getXoxnoEarnOptions({ networkDetails });

      // Every hub the protocol runs, not one pinned to: an asset belongs to
      // exactly one hub, so the token the person picks settles which. The
      // folded hubs are kept so the amount screen can describe whichever one
      // the chosen asset lives in.
      if (current())
        setCatalog({ options: earnOptions, hubs: foldXoxnoHubs(earnOptions) });
    } catch (err) {
      logger.error("useEarnTokens", "Failed to fetch earn tokens", err);
      if (!current()) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [networkDetails, scope]);

  useEffect(() => {
    setCatalog(null);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [scope]);
  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);
  useFocusedPolling({
    onPoll: refetch,
    interval: BALANCES_FETCH_POLLING_INTERVAL,
    refreshOnFocus: true,
  });

  // Re-derived whenever balances change, so a deposit or swap moves a row
  // between sections immediately -- with no refetch and no remount.
  const { held, supported } = useMemo(() => {
    if (!catalog) {
      return { held: [], supported: [] };
    }
    return buildEarnTokenRows({
      options: catalog.options,
      balances: pricedBalances,
      networkDetails,
    });
  }, [catalog, pricedBalances, networkDetails]);

  return {
    isLoading: isLoading && catalog === null,
    error,
    held,
    supported,
    /** Every hub, so a chosen asset's hub can be described by id. */
    hubs: catalog?.hubs ?? [],
    refetch,
  };
};
