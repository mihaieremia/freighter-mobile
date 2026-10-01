import { NETWORKS, STORAGE_KEYS } from "config/constants";
import { logger } from "config/logger";
import { CustomToken, CustomTokenStorage } from "config/types";
import { dataStorage } from "services/storage/storageFactory";

/**
 * Helper to get CustomTokenStorage from storage
 * @returns The current custom token storage, or an empty object if none exists
 */
export const getCustomTokenStorage = async (): Promise<CustomTokenStorage> => {
  const storageData = await dataStorage.getItem(STORAGE_KEYS.CUSTOM_TOKEN_LIST);
  if (!storageData) {
    return {};
  }

  try {
    return JSON.parse(storageData) as CustomTokenStorage;
  } catch (e) {
    logger.error(
      "getCustomTokenStorage",
      "Error parsing custom token storage",
      e,
    );

    return {};
  }
};

/**
 * Helper to save CustomTokenStorage to storage
 * @param storage The updated storage to save
 */
export const saveCustomTokenStorage = async (
  storage: CustomTokenStorage,
): Promise<void> => {
  await dataStorage.setItem(
    STORAGE_KEYS.CUSTOM_TOKEN_LIST,
    JSON.stringify(storage),
  );
};

/**
 * Saves a Soroban token to the account's custom token list so it shows in the
 * balances on this network. Saving a token that is already there does nothing.
 */
export const saveCustomToken = async ({
  publicKey,
  network,
  token,
}: {
  publicKey: string;
  network: NETWORKS;
  token: CustomToken;
}): Promise<void> => {
  const storage = await getCustomTokenStorage();
  const saved = storage[publicKey]?.[network] ?? [];
  if (saved.some(({ contractId }) => contractId === token.contractId)) return;

  storage[publicKey] = {
    ...storage[publicKey],
    [network]: [...saved, token],
  };
  await saveCustomTokenStorage(storage);
};
