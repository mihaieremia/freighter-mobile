import { mapNetworkToNetworkDetails } from "config/constants";
import { TokenIdentifier } from "config/types";
import { useAuthenticationStore } from "ducks/auth";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { getCatalogEntry } from "helpers/tokenCatalog";
import { useCallback } from "react";
import { TokenCatalogEntry } from "services/backend";

/**
 * The active network's catalog entry for a token, or undefined when the catalog
 * has not loaded or does not list the token. Only this token's entry is
 * selected, so a row re-renders when its own entry changes, not the whole list.
 *
 * @param tokenId - The token identifier ("XLM", "CODE:ISSUER", "SYMBOL:CONTRACT"), or undefined for none
 */
export const useTokenCatalogEntry = (
  tokenId: TokenIdentifier | undefined,
): TokenCatalogEntry | undefined => {
  const network = useAuthenticationStore((state) => state.network);

  return useTokenCatalogStore(
    useCallback(
      (state) => {
        const byContractId = state.byNetwork[network]?.byContractId;
        // Nothing to look up until the catalog has loaded.
        if (!tokenId || !byContractId) return undefined;

        return getCatalogEntry(
          byContractId,
          tokenId,
          mapNetworkToNetworkDetails(network).networkPassphrase,
        );
      },
      [network, tokenId],
    ),
  );
};
