import BigNumber from "bignumber.js";
import { NATIVE_TOKEN_CODE, NetworkDetails } from "config/constants";
import { logger } from "config/logger";
import {
  ApiAccountPositions,
  ApiXoxnoLegRow,
  ApiXoxnoEarnAssetOption,
  ApiXoxnoEarnOptionsCatalog,
  ApiXoxnoEarnPool,
  XoxnoDepositTarget,
  XoxnoEarnAssetOption,
  XoxnoEarnOffer,
  XoxnoHub,
  XoxnoHubReserve,
  XoxnoPosition,
  XoxnoPositionLeg,
} from "config/xoxnoTypes";
import { isNativeAssetId } from "helpers/assetIdentity";
import { t } from "i18next";
import { freighterBackendV2 } from "services/backend";

/**
 * Clients for freighter-backend-v2's XOXNO lending endpoints.
 *
 * `networkDetails.network` is already exactly "PUBLIC" / "TESTNET" (the NETWORKS
 * enum), which is what the handler validates against. Networks outside those two
 * are rejected with a 400 — callers should gate on `isEarnSupportedNetwork`
 * rather than relying on the error.
 */

/**
 * Catalog pool ids are `"<hubId>:<asset>"`. Only the hub half identifies the
 * market to the contract, and the contract's hub id is a u32, so it is split
 * off and parsed once, here, rather than at every call site.
 */
const mapEarnOffer = (pool: ApiXoxnoEarnPool): XoxnoEarnOffer => ({
  hubId: Number(pool.id.split(":")[0]),
  name: pool.name,
  supplyApy: pool.supply_apy,
  suppliedUsd: pool.supplied_usd,
  spokes: (pool.spokes || []).map((spoke) => ({
    id: spoke.id,
    name: spoke.name,
    loanToValueBps: spoke.loan_to_value_bps,
    liquidationThresholdBps: spoke.liquidation_threshold_bps,
  })),
});

const mapEarnAssetOption = (
  option: ApiXoxnoEarnAssetOption,
): XoxnoEarnAssetOption => ({
  assetId: option.asset_id,
  // The market registry names the XLM contract "native"; nulling it lets the
  // row fall back to the held balance's own code ("XLM"), the same fallback an
  // asset with no registry symbol at all gets.
  symbol: isNativeAssetId(option.symbol) ? null : option.symbol,
  name: option.name,
  decimals: option.decimals,
  offers: (option.pools || []).map(mapEarnOffer),
});

/**
 * Assets that can be supplied to XOXNO, with each hub's headline rate.
 *
 * Auth-signing note: this call passes `network` via axios's `params` option
 * rather than folding it into the URL string. That is safe with this app's
 * interceptor — `attachAuth.ts`'s `deriveServerPath` signs
 * `instance.getUri(config)`, which is axios's own baseURL+url+params join, i.e.
 * pathname *plus* query string. So the signed `methodAndPath` already includes
 * `?network=...` by construction; a `params` object cannot produce a
 * signature/wire-path mismatch here.
 */
export const getXoxnoEarnOptions = async ({
  networkDetails,
}: {
  networkDetails: NetworkDetails;
}): Promise<XoxnoEarnAssetOption[]> => {
  const { data } = await freighterBackendV2.get<{
    data?: ApiXoxnoEarnOptionsCatalog;
  }>("/protocols/xoxno/earn-options", {
    params: { network: networkDetails.network },
  });

  // A 200 without a `data` payload is still a failure — returning undefined
  // would violate the return contract.
  if (!data?.data) {
    logger.error("getXoxnoEarnOptions", "Missing data envelope", data);
    throw new Error(t("transaction.errors.fetchEarnOptionsFailed"));
  }

  return (data.data.options || []).map(mapEarnAssetOption);
};

/** Incomplete market values cannot produce a complete hub total. */
const sumSupplied = (reserves: XoxnoHubReserve[]): number | null =>
  reserves.length === 0 || reserves.some((r) => r.suppliedUsd === null)
    ? null
    : reserves.reduce((sum, r) => sum + r.suppliedUsd!, 0);

/** Weight each known market rate by its supplied value. */
const weightedSupplyApy = (reserves: XoxnoHubReserve[]): number | null => {
  const total = sumSupplied(reserves);
  if (
    total === null ||
    total <= 0 ||
    reserves.some((r) => r.suppliedUsd! > 0 && r.supplyApy === null)
  ) {
    return null;
  }
  return (
    reserves.reduce((sum, r) => sum + (r.supplyApy ?? 0) * r.suppliedUsd!, 0) /
    total
  );
};

/**
 * The hubs behind the catalog: one per hub, its reserves being the assets that
 * hub lists.
 *
 * Folded from the earn catalog rather than fetched separately, because the
 * catalog is already the whole market list — every asset carries an offer per
 * hub it is listed in. That also means a hub can only report what the catalog
 * knows: supplied value and supply rates, not borrow-side figures.
 */
export const foldXoxnoHubs = (options: XoxnoEarnAssetOption[]): XoxnoHub[] => {
  const hubs = new Map<number, XoxnoHub>();

  options.forEach((option) => {
    option.offers.forEach((offer) => {
      const hub = hubs.get(offer.hubId) ?? {
        id: offer.hubId,
        name: offer.name,
        suppliedUsd: null,
        interestApy: null,
        reserves: [] as XoxnoHubReserve[],
      };

      hub.reserves.push({
        assetId: option.assetId,
        symbol: option.symbol,
        name: option.name,
        decimals: option.decimals,
        supplyApy: offer.supplyApy,
        suppliedUsd: offer.suppliedUsd,
      });
      hubs.set(offer.hubId, hub);
    });
  });

  return [...hubs.values()].map((hub) => ({
    ...hub,
    suppliedUsd: sumSupplied(hub.reserves),
    interestApy: weightedSupplyApy(hub.reserves),
  }));
};

/**
 * The XOXNO details of every position NFT the account holds.
 *
 * The endpoint is a batch, so `data` carries one entry per requested address
 * and this unwraps the requested address, rejecting incomplete XOXNO rows.
 */
const fetchXoxnoPositionDetails = async ({
  publicKey,
  networkDetails,
  caller,
}: {
  publicKey: string;
  networkDetails: NetworkDetails;
  /** Names the caller in the failure log. */
  caller: string;
}) => {
  const { data } = await freighterBackendV2.post<{
    data?: ApiAccountPositions[];
  }>(
    "/accounts/positions",
    { addresses: [publicKey] },
    { params: { network: networkDetails.network } },
  );

  if (!data?.data) {
    logger.error(caller, "Missing data envelope", data);
    throw new Error(t("transaction.errors.fetchPositionsFailed"));
  }

  const account = data.data.find((row) => row.address === publicKey);
  if (
    !account ||
    !Array.isArray(account.positions) ||
    account.positions.some(
      (position) =>
        position.protocol === "xoxno" &&
        (!position.xoxno ||
          !Array.isArray(position.xoxno.borrow) ||
          !Array.isArray(position.xoxno.supply)),
    )
  ) {
    throw new Error(t("transaction.errors.fetchPositionsFailed"));
  }
  return account.positions.flatMap((position) =>
    position.xoxno ? [position.xoxno] : [],
  );
};

/**
 * Where a deposit of `assetId` into `hubId` should land for this account.
 *
 * A XOXNO position is an NFT that lives in exactly one risk spoke, and one
 * address can hold several. Picking the wrong one would be rejected by the
 * contract, so the choice is narrowed in order:
 *
 *   1. a debt-free position in the selected spoke supplying this `(hub, asset)`;
 *   2. any debt-free position in that same selected spoke;
 *   3. `"0"`, which opens a fresh position in `spokeId`.
 *
 * The selected spoke must still accept the asset when preparing the deposit.
 *
 * Positions carrying debt are skipped at every step. A position opened
 * elsewhere may be borrowing against its collateral, and supplying into it
 * would silently turn this deposit into cover for that debt — locking it up
 * behind a solvency check the depositor never agreed to, and never made. A
 * deposit made here therefore always lands somewhere it can be withdrawn from
 * freely.
 *
 * Also returns the account's current supply of the asset, which the Review
 * screen renders as the "before" side of `0.00 -> 500.00`. That is "0" for an
 * account with no position, indistinguishable by design from an account the
 * indexer has not seen.
 */
export const getXoxnoDepositTarget = async ({
  publicKey,
  hubId,
  assetId,
  spokeId,
  acceptingSpokeIds,
  networkDetails,
}: {
  publicKey: string;
  hubId: number;
  assetId: string;
  /** The spoke a new position would open in. */
  spokeId: number;
  /** Every spoke that accepts this asset, including `spokeId`. */
  acceptingSpokeIds: number[];
  networkDetails: NetworkDetails;
}): Promise<XoxnoDepositTarget> => {
  const positions = await fetchXoxnoPositionDetails({
    publicKey,
    networkDetails,
    caller: "getXoxnoDepositTarget",
  });

  const supplyOf = (detail: (typeof positions)[number]) => {
    const legs = detail.supply.filter(
      (leg) => leg.hub_id === hubId && leg.asset_id === assetId,
    );
    if (legs.some((leg) => leg.tokens === null))
      throw new Error(t("transaction.errors.fetchPositionsFailed"));
    return legs.reduce((sum, leg) => sum.plus(leg.tokens!), new BigNumber(0));
  };

  if (!acceptingSpokeIds.includes(spokeId)) {
    throw new Error(t("earnSafety.spokeUnavailable"));
  }
  const eligible = positions.filter(
    (detail) => detail.spoke_id === spokeId && detail.borrow.length === 0,
  );
  const target =
    eligible.find((detail) => supplyOf(detail).gt(0)) ?? eligible[0];

  return {
    accountId: target?.account_id ?? "0",
    spokeId: target?.spoke_id ?? spokeId,
    suppliedTokens: target ? supplyOf(target).toFixed() : "0",
  };
};

const mapPositionLeg = (
  accountId: string,
  leg: ApiXoxnoLegRow,
): XoxnoPositionLeg => ({
  accountId,
  hubId: leg.hub_id,
  hubName: leg.hub_name,
  assetId: leg.asset_id,
  // The registry names the XLM contract "native", which is not a code any
  // screen should render. Resolved to "XLM" here rather than to null as the
  // earn catalog does: a catalog row can fall back to the held balance's own
  // code, but a position has no balance in hand, and every consumer that
  // nulled it independently reached a different answer — the withdraw flow
  // rendered the truncated contract address instead.
  symbol: isNativeAssetId(leg.symbol) ? NATIVE_TOKEN_CODE : leg.symbol,
  decimals: leg.decimals,
  tokens: leg.tokens,
  withdrawableTokens: leg.withdrawable_tokens,
  usdValue: leg.usd_value,
  apy: leg.apy,
});

/**
 * The account's XOXNO positions, one entry per position NFT.
 *
 * Unknown borrow quantities stay visible and cannot prove a position debt-free.
 */
export const getXoxnoPositions = async ({
  publicKey,
  networkDetails,
}: {
  publicKey: string;
  networkDetails: NetworkDetails;
}): Promise<XoxnoPosition[]> => {
  const positions = await fetchXoxnoPositionDetails({
    publicKey,
    networkDetails,
    caller: "getXoxnoPositions",
  });

  return positions
    .map((detail) => ({
      accountId: detail.account_id,
      spokeName: detail.spoke_name,
      healthFactor: detail.health_factor,
      supply: detail.supply
        .filter((leg) => leg.tokens !== null && leg.tokens !== "0")
        .map((leg) => mapPositionLeg(detail.account_id, leg)),
      borrow: detail.borrow.map((leg) =>
        mapPositionLeg(detail.account_id, leg),
      ),
    }))
    .filter(
      (position) => position.supply.length > 0 || position.borrow.length > 0,
    );
};
