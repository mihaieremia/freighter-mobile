import BigNumber from "bignumber.js";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import {
  PricedBalanceMap,
  TokenIdentifier,
  TokenPricesMap,
} from "config/types";
import { isNativeAssetId, getNativeContractId } from "helpers/assetIdentity";
import { isLiquidityPool } from "helpers/balances";
import { getBalanceDecimalTotal } from "helpers/formatAmount";
import { isMainnet } from "helpers/networks";
import { getTokenSacAddress, isContractId } from "helpers/soroban";
import { TokenCatalogEntry } from "services/backend";

/** Where XOXNO serves a token's logo, by contract id. */
const TOKEN_LOGO_BASE_URL = "https://media.xoxno.com/tokens";

/**
 * The contract id the catalog knows a token by: XLM's and a classic asset's
 * Stellar Asset Contract (derived from the network passphrase), or a Soroban
 * token's own contract. Takes a token identifier ("XLM", "CODE:ISSUER",
 * "SYMBOL:CONTRACT") or a bare contract id. Returns undefined when the input
 * names no token, such as a liquidity pool id.
 *
 * @param tokenId - The token identifier
 * @param networkPassphrase - The passphrase of the network the token lives on
 */
export const getCatalogContractId = (
  tokenId: TokenIdentifier,
  networkPassphrase: string,
): string | undefined => {
  if (!tokenId) return undefined;
  if (isNativeAssetId(tokenId)) return getNativeContractId(networkPassphrase);
  if (isContractId(tokenId)) return tokenId;

  const [code, issuer] = tokenId.split(":");
  if (!code || !issuer) return undefined;
  if (isContractId(issuer)) return issuer;

  try {
    return getTokenSacAddress(code, issuer, networkPassphrase);
  } catch {
    // Not a valid asset (bad code or issuer): the catalog cannot know it.
    return undefined;
  }
};

/**
 * The catalog entry of a token, if the catalog lists it.
 *
 * @param byContractId - One network's catalog, keyed by contract id
 * @param tokenId - The token identifier
 * @param networkPassphrase - The passphrase of that network
 */
export const getCatalogEntry = (
  byContractId: Record<string, TokenCatalogEntry> | undefined,
  tokenId: TokenIdentifier,
  networkPassphrase: string,
): TokenCatalogEntry | undefined => {
  const contractId = getCatalogContractId(tokenId, networkPassphrase);

  return contractId ? byContractId?.[contractId] : undefined;
};

/** The logo of a catalog entry: its own URL, else the deterministic media URL. */
export const getCatalogIconUrl = (entry: TokenCatalogEntry): string =>
  entry.iconUrl || `${TOKEN_LOGO_BASE_URL}/${entry.id}/logo.png`;

/** The catalog's USD price of an entry, or undefined when it is unknown. */
export const getCatalogPrice = (
  entry: TokenCatalogEntry | undefined,
): BigNumber | undefined => {
  const price = new BigNumber(entry?.priceUsd ?? 0);

  return price.isFinite() && price.gt(0) ? price : undefined;
};

/**
 * The price to show: an existing non-zero one wins, else the catalog's, else the
 * existing one as it is (null, undefined or zero).
 */
export const pickPrice = (
  existing: BigNumber | null | undefined,
  catalog: BigNumber | undefined,
): BigNumber | null | undefined =>
  existing && !existing.isZero() ? existing : (catalog ?? existing);

/**
 * The catalog's USD price of a token, or undefined when the catalog does not
 * list it or lists it at 0.
 *
 * @param byContractId - One network's catalog, keyed by contract id
 * @param tokenId - The token identifier
 * @param networkPassphrase - The passphrase of that network
 */
export const getCatalogPriceFor = (
  byContractId: Record<string, TokenCatalogEntry> | undefined,
  tokenId: TokenIdentifier,
  networkPassphrase: string,
): BigNumber | undefined =>
  getCatalogPrice(getCatalogEntry(byContractId, tokenId, networkPassphrase));

/**
 * Fills the USD price of held tokens that have none from the catalog. A price
 * already on the balance always wins; the catalog only fills a missing (null,
 * undefined or zero) one. The 24h change stays as it is, since the catalog has
 * none. Display data only.
 *
 * @param pricedBalances - The balances, keyed by token identifier
 * @param byContractId - One network's catalog, keyed by contract id
 * @param networkPassphrase - The passphrase of that network
 */
export const fillMissingPricesFromCatalog = (
  pricedBalances: PricedBalanceMap,
  byContractId: Record<string, TokenCatalogEntry> | undefined,
  networkPassphrase: string,
): PricedBalanceMap => {
  if (!byContractId) return pricedBalances;

  return Object.fromEntries(
    Object.entries(pricedBalances).map(([id, balance]) => {
      if (isLiquidityPool(balance)) return [id, balance];

      const price = pickPrice(
        balance.currentPrice,
        getCatalogPriceFor(byContractId, id, networkPassphrase),
      );
      if (price === balance.currentPrice || !price) return [id, balance];

      return [
        id,
        {
          ...balance,
          currentPrice: price,
          fiatCode: "USD",
          fiatTotal: getBalanceDecimalTotal(balance).multipliedBy(price),
        },
      ];
    }),
  );
};

/**
 * A prices map with the catalog's USD price added for the given tokens the map
 * has none for (see `pickPrice`). Returns the same map when nothing was added,
 * and always on a non-mainnet network (fiat is mainnet-only).
 *
 * @param prices - The prices map to start from
 * @param tokenIds - The tokens to fill from the catalog when the map lacks them
 * @param byContractId - One network's catalog, keyed by contract id
 * @param network - The active network
 */
export const withCatalogPrices = (
  prices: TokenPricesMap,
  tokenIds: Array<TokenIdentifier | undefined>,
  byContractId: Record<string, TokenCatalogEntry> | undefined,
  network: NETWORKS,
): TokenPricesMap => {
  if (!byContractId || !isMainnet(network)) return prices;

  const { networkPassphrase } = mapNetworkToNetworkDetails(network);
  const filled: TokenPricesMap = { ...prices };
  let hasFilled = false;
  tokenIds.forEach((id) => {
    if (!id) return;
    const existing = prices[id]?.currentPrice;
    const price = pickPrice(
      existing,
      getCatalogPriceFor(byContractId, id, networkPassphrase),
    );
    if (price === existing) return;
    filled[id] = { ...prices[id], currentPrice: price };
    hasFilled = true;
  });

  return hasFilled ? filled : prices;
};
