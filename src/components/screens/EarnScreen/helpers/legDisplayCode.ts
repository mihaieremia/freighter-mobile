import { XoxnoPositionLeg } from "config/xoxnoTypes";

/**
 * The code to show for a supplied leg.
 *
 * `symbol` already carries the registry's code with native resolved to "XLM"
 * (see `mapPositionLeg`), so this only covers the asset the registry has no
 * symbol for at all. Shared rather than repeated because the row and the
 * withdraw route each derived it separately, and disagreed: the withdraw flow
 * showed a truncated contract address where the row showed "XLM".
 */
export const displayCode = (symbol: string | null, assetId: string): string =>
  symbol || `${assetId.slice(0, 4)}…`;

/** The code to show for a supplied leg. See `displayCode`. */
export const legDisplayCode = (leg: XoxnoPositionLeg): string =>
  displayCode(leg.symbol, leg.assetId);
