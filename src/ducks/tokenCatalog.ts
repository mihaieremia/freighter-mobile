import { MINUTE_IN_MS, NETWORKS } from "config/constants";
import { logApiError } from "services/apiFactory";
import { TokenCatalogEntry, fetchTokenCatalog } from "services/backend";
import { create } from "zustand";

/** How long a network's catalog is served before the next fetch asks again. */
export const TOKEN_CATALOG_TTL_MS = 5 * MINUTE_IN_MS;

/** One network's catalog, keyed by contract id. */
interface NetworkTokenCatalog {
  byContractId: Record<string, TokenCatalogEntry>;
  /** When the catalog was fetched, in ms. */
  fetchedAt: number;
}

interface TokenCatalogState {
  /** Per-network catalogs. A network with no fetch yet has no entry. */
  byNetwork: Partial<Record<NETWORKS, NetworkTokenCatalog>>;
  /**
   * Loads the network's catalog unless it is fresher than the TTL. Calls that
   * arrive while a fetch is running share it. Never rejects: on failure the
   * previous data stays and the failure is logged.
   */
  fetchCatalog: (network: NETWORKS) => Promise<void>;
}

const inFlight = new Map<NETWORKS, Promise<void>>();

export const useTokenCatalogStore = create<TokenCatalogState>((set, get) => ({
  byNetwork: {},
  fetchCatalog: (network) => {
    const cached = get().byNetwork[network];
    if (cached && Date.now() - cached.fetchedAt < TOKEN_CATALOG_TTL_MS) {
      return Promise.resolve();
    }

    const running = inFlight.get(network);
    if (running) return running;

    const request = (async () => {
      try {
        const entries = await fetchTokenCatalog(network);
        if (!Array.isArray(entries)) {
          throw new Error("Token catalog response is not a list");
        }
        const byContractId: Record<string, TokenCatalogEntry> = {};
        entries.forEach((entry) => {
          if (entry?.id) byContractId[entry.id] = entry;
        });
        set((state) => ({
          byNetwork: {
            ...state.byNetwork,
            [network]: { byContractId, fetchedAt: Date.now() },
          },
        }));
      } catch (error) {
        logApiError(
          "TokenCatalog",
          "Token catalog unreachable",
          "Token catalog request failed",
          error,
          { network },
        );
      } finally {
        inFlight.delete(network);
      }
    })();
    inFlight.set(network, request);

    return request;
  },
}));

/** Test-only: forget requests in flight between tests. */
export const resetTokenCatalogInFlightForTests = (): void => inFlight.clear();
