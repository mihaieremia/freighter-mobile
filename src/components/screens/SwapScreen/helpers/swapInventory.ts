import { DestinationTokenDescriptor } from "components/screens/SwapScreen/helpers/types";
import { NETWORKS } from "config/constants";
import { logger } from "config/logger";
import { TokenTypeWithCustomToken } from "config/types";
import { useBalancesStore } from "ducks/balances";
import { getSorobanContractId } from "helpers/swapAssets";
import { saveCustomToken } from "services/customTokenStorage";

/**
 * A Soroban token bought in a swap has no trustline for the wallet to add, so
 * unless the user already holds it the wallet does not know to list it. Saves it
 * to the account's custom tokens and reloads the balances, so it shows in the
 * inventory right away. Best effort: the swap has already settled.
 */
export const addBoughtTokenToBalances = async ({
  token,
  publicKey,
  network,
}: {
  token: DestinationTokenDescriptor | null;
  publicKey: string;
  network: NETWORKS;
}): Promise<void> => {
  if (
    token?.tokenType !== TokenTypeWithCustomToken.CUSTOM_TOKEN ||
    !token.issuer
  ) {
    return;
  }
  const contractId = token.issuer;

  try {
    const { balances, fetchAccountBalances } = useBalancesStore.getState();
    const isHeld = Object.values(balances).some(
      (balance) => getSorobanContractId(balance) === contractId,
    );
    if (isHeld) return;

    await saveCustomToken({
      publicKey,
      network,
      token: {
        contractId,
        symbol: token.tokenCode,
        name: token.tokenCode,
        decimals: token.decimals,
      },
    });
    await fetchAccountBalances({
      publicKey,
      network,
      contractIds: [contractId],
    });
  } catch (error) {
    logger.warn(
      "SwapInventory",
      "Could not add the bought token to balances",
      error,
    );
  }
};
