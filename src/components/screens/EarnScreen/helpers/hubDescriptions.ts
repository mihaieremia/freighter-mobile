/**
 * Prose descriptions for the hubs we surface, keyed by hub id.
 *
 * Hardcoded because the earn catalog carries no description field. Keyed by
 * hub rather than shown generically because the copy describes one hub's risk
 * setup, which is not true of XOXNO's hubs in general: each hub isolates its
 * own liquidity and lists its own markets.
 *
 * A hub with no entry renders no description rather than a wrong one.
 *
 * Returns an i18n KEY, not translated prose — copy lives in the translation
 * files like everywhere else in this app (see `src/i18n/locales/*`). The key
 * below (`earnHubDetails.descriptions.mainHub`) exists in both `en` and `pt`.
 */
const HUB_DESCRIPTION_KEYS: Record<number, string> = {
  // Hub 1, "Main" — the same id on mainnet and testnet.
  1: "earnHubDetails.descriptions.mainHub",
};

export const getHubDescriptionKey = (hubId: number): string | null =>
  HUB_DESCRIPTION_KEYS[hubId] ?? null;
