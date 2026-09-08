import { DEFAULT_DECIMALS } from "config/constants";
import { XoxnoEarnSpoke, XoxnoHub } from "config/xoxnoTypes";
import { create } from "zustand";

/**
 * Earn-domain state that has no home in `transactionBuilder`.
 *
 * The deposit's transaction-shaped state (XDR, fees, submit status) deliberately
 * lives in `transactionBuilder` instead, so Earn reuses the shared sign/submit
 * path rather than duplicating it. What lands here is what must survive that
 * store's reset, or has no equivalent field there.
 */
interface EarnState {
  /** Catalog entry for the allowlisted hub; null until the fetch resolves. */
  hub: XoxnoHub | null;
  /**
   * The chosen asset's contract address (its SAC). Captured at pick time rather
   * than re-derived later: the hub addresses reserves by contract id, and the
   * deposit's Request carries that address, not the code.
   */
  selectedAssetId: string;
  /**
   * The chosen asset's headline rate (supply APY + emissions APR) as a decimal
   * fraction, or null when the oracle has no fresh price. Carried from the token
   * picker so the amount and review screens don't re-derive it — and so the rate
   * cannot shift under the user mid-entry.
   */
  selectedAssetApy: number | null;
  selectedAssetCode: string;
  selectedAssetDecimals: number;
  /**
   * The hub the chosen asset is listed in; each asset belongs to exactly one.
   * Null until an asset is picked, which is what the fetch guards read.
   */
  selectedHubId: number | null;
  /**
   * The risk spokes accepting the chosen asset, best first, and the one this
   * deposit will use. They all earn the same — the rate belongs to the market
   * — so the default is simply the best of them, and changing it only changes
   * what the deposit can later be borrowed against.
   */
  selectedSpokes: XoxnoEarnSpoke[];
  selectedSpokeId: number | null;
  /**
   * The account's existing balance in the hub for the chosen asset, in raw
   * token units — the "before" side of Review. Defaults to "0", which is also
   * what a fetch failure falls back to.
   */
  currentPositionTokens: string;

  setHub: (hub: XoxnoHub | null) => void;
  selectAsset: (params: {
    assetId: string;
    apy: number | null;
    code: string;
    decimals: number;
    hubId: number;
    spokes: XoxnoEarnSpoke[];
  }) => void;
  /** Overrides the spoke the deposit opens a new position in. */
  setSelectedSpokeId: (spokeId: number) => void;
  setCurrentPositionTokens: (tokens: string) => void;
  resetEarn: () => void;
}

const initialState = {
  hub: null,
  selectedAssetId: "",
  selectedAssetApy: null,
  selectedAssetCode: "",
  selectedAssetDecimals: DEFAULT_DECIMALS,
  selectedHubId: null,
  selectedSpokes: [],
  selectedSpokeId: null,
  currentPositionTokens: "0",
};

export const useEarnStore = create<EarnState>((set) => ({
  ...initialState,

  setHub: (hub) => set({ hub }),

  // Resets `currentPositionTokens` back to its "0" default on every asset
  // switch, mid-flow or not. `useEarnPosition`'s fetch is non-fatal by
  // design (see its docs) and leaves the duck holding whatever it already
  // had on failure — without this reset, picking asset A (fetch succeeds),
  // backing out, then picking asset B (fetch fails) would carry A's
  // position into B's Review "before" value.
  selectAsset: ({ assetId, apy, code, decimals, hubId, spokes }) =>
    set({
      selectedAssetId: assetId,
      selectedAssetApy: apy,
      selectedAssetCode: code,
      selectedAssetDecimals: decimals,
      selectedHubId: hubId,
      selectedSpokes: spokes,
      selectedSpokeId: spokes[0]?.id ?? null,
      currentPositionTokens: initialState.currentPositionTokens,
    }),

  setCurrentPositionTokens: (currentPositionTokens) =>
    set({ currentPositionTokens }),

  setSelectedSpokeId: (selectedSpokeId) => set({ selectedSpokeId }),

  resetEarn: () => set({ ...initialState }),
}));
