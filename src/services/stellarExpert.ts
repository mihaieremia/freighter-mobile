/* eslint-disable no-underscore-dangle */
import { NETWORKS } from "config/constants";
import { normalizeError } from "config/logger";
import { SearchTokenResponse } from "config/types";
import { getApiStellarExpertUrl } from "helpers/stellarExpert";
import {
  RetryConfig,
  createApiService,
  isApiError,
  isRequestCanceled,
  logApiError,
} from "services/apiFactory";

const stellarExpertApiTestnet = createApiService({
  baseURL: getApiStellarExpertUrl(NETWORKS.TESTNET),
});

const stellarExpertApiPublic = createApiService({
  baseURL: getApiStellarExpertUrl(NETWORKS.PUBLIC),
});

const apiFor = (network: NETWORKS) =>
  network === NETWORKS.TESTNET
    ? stellarExpertApiTestnet
    : stellarExpertApiPublic;

export const fetchTrendingAssets = async ({
  network,
  signal,
}: {
  network: NETWORKS;
  signal?: AbortSignal;
}) => {
  const stellarExpertApi = apiFor(network);

  // stellar.expert testnet always reports volume7d=0, so the
  // mainnet "sort by 7-day volume, take top 50" yields an arbitrary
  // ordering AND every record gets dropped by the downstream volume
  // filter. On testnet pull the unsorted first-page slice instead so
  // the trending section has something to show.
  const params =
    network === NETWORKS.TESTNET
      ? { limit: 50 }
      : { sort: "volume7d", order: "desc", limit: 50 };

  try {
    const response = await stellarExpertApi.get<SearchTokenResponse>("/asset", {
      params,
      signal,
    });

    if (!response.data || !response.data._embedded) {
      throw normalizeError(response);
    }

    return response.data;
  } catch (error) {
    if (isRequestCanceled(error)) {
      return null;
    }

    logApiError(
      "stellarExpert",
      "Network unreachable while fetching trending assets",
      "Error fetching trending assets",
      error,
    );

    return null;
  }
};

export const searchToken = async (
  token: string,
  network: NETWORKS,
  signal?: AbortSignal,
) => {
  const stellarExpertApi = apiFor(network);

  try {
    const response = await stellarExpertApi.get<SearchTokenResponse>("/asset", {
      params: {
        search: token,
      },
      signal,
    });

    if (!response.data || !response.data._embedded) {
      throw normalizeError(response);
    }

    return response.data;
  } catch (error) {
    if (isRequestCanceled(error)) {
      return null;
    }

    logApiError(
      "stellarExpert",
      "Network unreachable while searching token",
      "Error searching token",
      error,
    );

    return null;
  }
};

const TRANSACTION_META_TIMEOUT_MS = 10000;

/**
 * Fetches the base64 `TransactionMeta` XDR of a transaction from Stellar
 * Expert. The meta of a Soroban transaction holds its contract events, which
 * Horizon's balance changes do not list for plain Soroban tokens.
 *
 * Never throws: a network failure, an unknown transaction or a malformed
 * response returns null so the caller can fall back.
 *
 * @param hash - The transaction hash
 * @param network - The network the transaction belongs to
 * @param retry - Asks again with exponential backoff when the request fails, such as a 404 for a transaction not indexed yet
 * @returns The base64 meta XDR, or null when it cannot be fetched
 */
export const fetchTransactionMeta = async (
  hash: string,
  network: NETWORKS,
  retry?: RetryConfig,
): Promise<string | null> => {
  const stellarExpertApi = apiFor(network);

  try {
    const response = await stellarExpertApi.get<{ meta?: unknown }>(
      `/tx/${encodeURIComponent(hash)}`,
      { timeout: TRANSACTION_META_TIMEOUT_MS, retry },
    );
    const meta = response.data?.meta;

    if (typeof meta !== "string" || meta.length === 0) {
      throw normalizeError(response);
    }

    return meta;
  } catch (error) {
    // A confirmed transaction may not have reached the explorer's index yet.
    if (isApiError(error) && error.status === 404) {
      return null;
    }

    logApiError(
      "stellarExpert",
      "Network unreachable while fetching transaction meta",
      "Error fetching transaction meta",
      error,
    );

    return null;
  }
};
