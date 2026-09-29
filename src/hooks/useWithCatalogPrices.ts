import { TokenIdentifier, TokenPricesMap } from "config/types";
import { useAuthenticationStore } from "ducks/auth";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { withCatalogPrices } from "helpers/tokenCatalog";
import { useMemo } from "react";

/**
 * `withCatalogPrices` on the active network's loaded catalog.
 *
 * @param prices - The prices map to start from
 * @param tokenIds - The tokens to fill from the catalog when the map lacks them
 */
export const useWithCatalogPrices = (
  prices: TokenPricesMap,
  tokenIds: Array<TokenIdentifier | undefined>,
): TokenPricesMap => {
  const network = useAuthenticationStore((state) => state.network);
  const byContractId = useTokenCatalogStore(
    (state) => state.byNetwork[network]?.byContractId,
  );
  // The caller passes a fresh array on every render; its contents are the key.
  const tokenIdsKey = JSON.stringify(tokenIds);

  return useMemo(
    () =>
      withCatalogPrices(
        prices,
        JSON.parse(tokenIdsKey) as Array<TokenIdentifier | undefined>,
        byContractId,
        network,
      ),
    [prices, byContractId, network, tokenIdsKey],
  );
};
