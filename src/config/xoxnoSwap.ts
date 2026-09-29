import { NETWORKS } from "config/constants";

/**
 * The only contract an aggregator swap transaction may invoke, per network.
 * Pinned here so a compromised backend cannot redirect the user's signature.
 * Source: XOXNO lending repo `configs/networks.json` (`aggregator`).
 */
export const XOXNO_SWAP_ROUTER: Partial<Record<NETWORKS, string>> = {
  [NETWORKS.PUBLIC]: "CCVENFSVCBYDHVOACFZXMNNYVOZ3LKXPZYU5LUI4N7KTXOKRVYD7F3TR",
  [NETWORKS.TESTNET]:
    "CDNTWMWW2WGYTKIZTJYNGNVQQZI4KTC5BQRZ3275KESRX5T4O3AYECL5",
};
