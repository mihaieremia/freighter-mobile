/* eslint-disable @fnando/consistent-import/consistent-import */
import { NETWORKS } from "config/constants";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { TokenCatalogEntry } from "services/backend";

import { CONTRACT, ISSUER, USDC_SAC, XLM_SAC } from "./swapFixtures";

/** Circle USDC's issuer and its mainnet Stellar Asset Contract. */
export const CATALOG_USDC_ISSUER = ISSUER;
export const CATALOG_USDC_SAC = USDC_SAC;
export const CATALOG_XLM_SAC = XLM_SAC;
/** A Soroban token contract. */
export const CATALOG_SOROBAN_CONTRACT = CONTRACT;

export const catalogUsdc: TokenCatalogEntry = {
  id: CATALOG_USDC_SAC,
  code: "USDC",
  name: "USD Coin",
  decimals: 7,
  iconUrl: "https://media.xoxno.com/tokens/usdc/custom.png",
  priceUsd: 1,
  swappable: true,
};

export const catalogXlm: TokenCatalogEntry = {
  id: CATALOG_XLM_SAC,
  code: "XLM",
  name: "Stellar Lumens",
  decimals: 7,
  priceUsd: 0.25,
  swappable: true,
};

export const catalogSoroban: TokenCatalogEntry = {
  id: CATALOG_SOROBAN_CONTRACT,
  code: "XAUM",
  name: "Matrixdock Gold",
  decimals: 9,
  iconUrl: "",
  priceUsd: 4200,
  swappable: false,
};

export const catalogUnpriced: TokenCatalogEntry = {
  ...catalogSoroban,
  priceUsd: 0,
};

export const catalogByContractId = (
  ...entries: TokenCatalogEntry[]
): Record<string, TokenCatalogEntry> =>
  Object.fromEntries(entries.map((entry) => [entry.id, entry]));

/** Matrixdock Gold, the 9-decimal Soroban token of the real router swaps. */
export const catalogXaum = (
  over: Partial<TokenCatalogEntry> = {},
): TokenCatalogEntry => ({
  id: "CC2RBGYNCFBCVENIDL5BFBWPH4OUZM2UA3OD2K2N54GLMWCC4KWPVAGO",
  code: "XAUM",
  name: "Matrixdock Gold",
  decimals: 9,
  swappable: false,
  ...over,
});

export const seedCatalog = (
  network: NETWORKS,
  ...entries: TokenCatalogEntry[]
) =>
  useTokenCatalogStore.setState({
    byNetwork: {
      [network]: {
        byContractId: catalogByContractId(...entries),
        fetchedAt: Date.now(),
      },
    },
  });
