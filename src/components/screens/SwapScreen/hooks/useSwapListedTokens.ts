import { canonicalId } from "components/screens/SwapScreen/helpers/canonicalId";
import { mergeBlockaidScans } from "components/screens/SwapScreen/helpers/mergeBlockaidScans";
import { MINUTE_IN_MS, NETWORKS } from "config/constants";
import { logger } from "config/logger";
import {
  FormattedSearchTokenRecord,
  TokenTypeWithCustomToken,
} from "config/types";
import { useBlockaidTokenScansStore } from "ducks/blockaidTokenScans";
import { useDebugStore } from "ducks/debug";
import { getTokenType } from "helpers/balances";
import { isMainnet } from "helpers/networks";
import { getSorobanContractId } from "helpers/swapAssets";
import { type HeldBalanceItem } from "hooks/useBalancesList";
import { useEffect, useMemo, useState } from "react";
import {
  SwapListedToken,
  SwapListedTokenKind,
  fetchSwapTokens,
} from "services/backend";

const LIST_TTL_MS = 5 * MINUTE_IN_MS;

// The list changes slowly and every visit to the swap pickers asks for it, so it
// is kept for the app session.
const listCache = new Map<
  NETWORKS,
  { tokens: SwapListedToken[]; fetchedAt: number }
>();

export const resetSwapListedTokensCacheForTests = (): void => listCache.clear();

/**
 * The listed tokens the user does not hold yet, as picker rows. A classic asset
 * is a row like any other classic one (it needs a trustline); a Soroban token
 * carries its contract where the issuer goes and needs none. Native XLM is always
 * a held token, so it is left out.
 */
export const buildListedRecords = ({
  tokens,
  heldIds,
  heldContractIds,
}: {
  tokens: SwapListedToken[];
  heldIds: ReadonlySet<string>;
  heldContractIds: ReadonlySet<string>;
}): FormattedSearchTokenRecord[] =>
  tokens.flatMap((token) => {
    const isClassic = token.kind === SwapListedTokenKind.CLASSIC;
    // Native XLM is neither; it is always a held token.
    if (!isClassic && token.kind !== SwapListedTokenKind.SOROBAN) return [];
    const [code, issuer] = isClassic
      ? (token.asset ?? "").split(":")
      : [token.code, token.id];
    if (!code || !issuer) return [];
    const id = canonicalId(code, issuer);
    if (isClassic ? heldIds.has(id) : heldContractIds.has(token.id)) return [];

    return [
      {
        tokenCode: code,
        name: token.name,
        domain: "",
        hasTrustline: !isClassic,
        iconUrl: token.iconUrl,
        issuer,
        isNative: false,
        tokenType: isClassic
          ? getTokenType(id)
          : TokenTypeWithCustomToken.CUSTOM_TOKEN,
        decimals: token.decimals,
        price: token.priceUsd,
      },
    ];
  });

/**
 * The tokens the swap pickers can offer from XOXNO's swap list:
 * `routableIds`, the contracts of its Soroban tokens (a held Soroban token is
 * swappable only if it is in there), and `listedRecords`, its tokens the user does
 * not hold yet. Classic ones carry a Blockaid scan like the other classic rows;
 * a Soroban token is not scanned here and is shown as unable to scan.
 */
export const useSwapListedTokens = ({
  network,
  balanceItems,
}: {
  network: NETWORKS;
  balanceItems: HeldBalanceItem[];
}): {
  routableIds: ReadonlySet<string>;
  listedRecords: FormattedSearchTokenRecord[];
} => {
  const [tokens, setTokens] = useState<SwapListedToken[]>(
    () => listCache.get(network)?.tokens ?? [],
  );
  const [scans, setScans] = useState<Parameters<typeof mergeBlockaidScans>[1]>(
    {},
  );
  const overriddenBlockaidResponse = useDebugStore(
    (state) => state.overriddenBlockaidResponse,
  );

  useEffect(() => {
    let cancelled = false;
    const cached = listCache.get(network);
    setTokens(cached?.tokens ?? []);
    if (cached && Date.now() - cached.fetchedAt <= LIST_TTL_MS)
      return undefined;

    fetchSwapTokens(network)
      .then((list) => {
        listCache.set(network, { tokens: list, fetchedAt: Date.now() });
        if (!cancelled) setTokens(list);
      })
      .catch((error) =>
        logger.warn("SwapListedTokens", "Could not load swap tokens", error),
      );

    return () => {
      cancelled = true;
    };
  }, [network]);

  const routableIds = useMemo(
    () =>
      new Set(
        tokens
          .filter((token) => token.kind === SwapListedTokenKind.SOROBAN)
          .map((t) => t.id),
      ),
    [tokens],
  );

  const heldIds = useMemo(
    () => new Set(balanceItems.map((item) => item.id)),
    [balanceItems],
  );
  const heldContractIds = useMemo(
    () =>
      new Set(
        balanceItems
          .map((item) => getSorobanContractId(item))
          .filter((id): id is string => !!id),
      ),
    [balanceItems],
  );

  const records = useMemo(
    () => buildListedRecords({ tokens, heldIds, heldContractIds }),
    [tokens, heldIds, heldContractIds],
  );

  // A Soroban token has a contract where a classic one has an issuer, and the bulk
  // scan is asked about classic assets only.
  const classicAddresses = useMemo(
    () =>
      records
        .filter((r) => r.tokenType !== TokenTypeWithCustomToken.CUSTOM_TOKEN)
        .map((r) => `${r.tokenCode}-${r.issuer}`),
    [records],
  );
  useEffect(() => {
    if (!isMainnet(network) || classicAddresses.length === 0) return undefined;
    const controller = new AbortController();
    useBlockaidTokenScansStore
      .getState()
      .scanBulkWithCache({
        addressList: classicAddresses,
        network,
        signal: controller.signal,
      })
      .then(({ results }) => {
        if (!controller.signal.aborted) setScans(results ?? {});
      })
      // Best-effort security metadata: rows stay, unscanned.
      .catch((error) => {
        if (!controller.signal.aborted) {
          logger.warn(
            "SwapListedTokens",
            "Could not scan listed tokens",
            error,
          );
        }
      });

    return () => controller.abort();
  }, [network, classicAddresses]);

  const listedRecords = useMemo(
    () =>
      records.map((record) =>
        record.tokenType === TokenTypeWithCustomToken.CUSTOM_TOKEN
          ? record
          : mergeBlockaidScans([record], scans, overriddenBlockaidResponse)[0],
      ),
    [records, scans, overriddenBlockaidResponse],
  );

  return { routableIds, listedRecords };
};
