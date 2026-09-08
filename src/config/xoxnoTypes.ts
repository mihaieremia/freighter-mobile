import { NETWORKS } from "config/constants";

/* -------------------------------------------------------------------------- */
/* GET /protocols/xoxno/earn-options                                          */
/* -------------------------------------------------------------------------- */

export interface ApiXoxnoEarnSpoke {
  id: number;
  name: string | null;
  loan_to_value_bps: number;
  liquidation_threshold_bps: number;
}

export interface ApiXoxnoEarnPool {
  /** `"<hubId>:<asset>"` — the hub half is what this app keys on. */
  id: string;
  name: string | null;
  supply_apy: number | null;
  /** Always null for XOXNO, which runs no emissions programme. */
  emissions_supply_apr: number | null;
  supplied_usd: number | null;
  /** Risk spokes accepting a deposit, best first. */
  spokes?: ApiXoxnoEarnSpoke[];
}

export interface ApiXoxnoEarnAssetOption {
  asset_id: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  /** Ordered by supplied USD descending (unpriced last). */
  pools: ApiXoxnoEarnPool[];
}

export interface ApiXoxnoEarnOptionsCatalog {
  options: ApiXoxnoEarnAssetOption[];
}

export interface XoxnoEarnSpoke {
  id: number;
  name: string | null;
  loanToValueBps: number;
  liquidationThresholdBps: number;
}

export interface XoxnoEarnOffer {
  /** The hub id on its own, e.g. `1` — a u32 to the contract. */
  hubId: number;
  name: string | null;
  supplyApy: number | null;
  suppliedUsd: number | null;
  /**
   * The risk spokes that accept a deposit of this asset, best first.
   *
   * Every one of them earns the same, because the rate belongs to the market
   * rather than the spoke; they differ in whether the deposit can be borrowed
   * against and on what terms. The whole list travels so the flow can prefer
   * a position the account already holds over the default.
   */
  spokes: XoxnoEarnSpoke[];
}

export interface XoxnoEarnAssetOption {
  /** The market's asset contract address — a SAC for every classic asset. */
  assetId: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  offers: XoxnoEarnOffer[];
}

/* -------------------------------------------------------------------------- */
/* Hubs, folded out of the same catalog                                       */
/* -------------------------------------------------------------------------- */

export interface XoxnoHubReserve {
  assetId: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  supplyApy: number | null;
  suppliedUsd: number | null;
}

export interface XoxnoHub {
  /** Hub id, e.g. `1`. */
  id: number;
  name: string | null;
  /** Sum of the hub's reserves; null only when nothing in it is priced. */
  suppliedUsd: number | null;
  /** Supplied-USD-weighted supply rate across the hub's reserves. */
  interestApy: number | null;
  reserves: XoxnoHubReserve[];
}

/* -------------------------------------------------------------------------- */
/* POST /accounts/positions                                                   */
/* -------------------------------------------------------------------------- */

export interface ApiXoxnoLegRow {
  hub_id: number;
  /** The liquidity hub's display name. */
  hub_name: string;
  asset_id: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  /**
   * Balance as an integer string in the asset's base units. Null when the
   * token's decimals are unknown, which is indistinguishable from zero here
   * and so is treated as "no balance".
   */
  tokens: string | null;
  /**
   * How much of a supply leg can leave the position without pushing it under
   * water, in base units. Equals `tokens` when the position carries no debt,
   * and is null when the position cannot be priced.
   */
  withdrawable_tokens: string | null;
  usd_value: number | null;
  apy: number | null;
  price_usd: number | null;
}

export interface ApiXoxnoPositionDetail {
  /** The position NFT's token id, and the `account_id` `supply` takes. */
  account_id: string;
  /** The risk spoke the position lives in, fixed for its lifetime. */
  spoke_id: number;
  /** The spoke's display name; null for a spoke the backend does not know. */
  spoke_name: string | null;
  /** 0 Normal, 1 Multiply, 2 Long, 3 Short. */
  position_mode: number;
  health_factor: number | null;
  supply: ApiXoxnoLegRow[];
  borrow: ApiXoxnoLegRow[];
}

export interface ApiPoolPosition {
  protocol: string;
  /** The position's id within its protocol; the NFT token id for XOXNO. */
  id: string;
  name: string | null;
  net_usd: number | null;
  supplied_usd: number | null;
  borrowed_usd: number | null;
  net_apy: number | null;
  xoxno?: ApiXoxnoPositionDetail;
}

export interface ApiAccountPositions {
  address: string;
  total_value_usd: number | null;
  net_apy: number | null;
  /** Always non-nil; empty for accounts with no positions or unknown upstream. */
  positions: ApiPoolPosition[];
}

/** What the deposit builder needs to target an existing position, or open one. */
export interface XoxnoDepositTarget {
  /** Existing account id, or `"0"` to open a new account in `spokeId`. */
  accountId: string;
  spokeId: number;
  /** The account's current supply of the asset, in base units. */
  suppliedTokens: string;
}

/** One supplied (hub, asset) leg of a position, as the positions list shows it. */
export interface XoxnoPositionLeg {
  /** The position NFT this leg belongs to; `withdraw` takes it. */
  accountId: string;
  hubId: number;
  /**
   * The hub's display name. It belongs to the leg rather than the position
   * around it, because one position's legs can sit in different hubs.
   */
  hubName: string;
  assetId: string;
  symbol: string | null;
  decimals: number | null;
  /** Balance in the asset's base units. */
  tokens: string | null;
  /**
   * The most this leg can give back while the position stays solvent, in base
   * units. Equal to `tokens` with no debt; smaller, possibly zero, when debt
   * is being carried; null when the position is unpriced and no bound is
   * knowable.
   */
  withdrawableTokens: string | null;
  usdValue: number | null;
  apy: number | null;
}

export interface XoxnoPosition {
  accountId: string;
  spokeName: string | null;
  /**
   * Liquidation-threshold-weighted collateral over debt. Null for a position
   * with no debt, which is every position this app can create today.
   */
  healthFactor: number | null;
  supply: XoxnoPositionLeg[];
  /**
   * What the position owes. Freighter cannot borrow or repay, but a position
   * opened elsewhere can carry debt, and that debt is what bounds every
   * withdrawal from it — so it is shown rather than hidden.
   */
  borrow: XoxnoPositionLeg[];
}

/* -------------------------------------------------------------------------- */
/* Building one XOXNO action                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a deposit, a withdrawal and a repayment all carry: who signs it, on
 * what network, at what fee, and how much of which asset.
 *
 * The three stay separate actions — they take genuinely different extra
 * fields — so each of the builders, duck actions and simulate hooks extends
 * this with only what is its own.
 */
export interface XoxnoActionParams {
  senderAddress: string;
  network: NETWORKS;
  /** Inclusion fee in XLM; the resource fee is added by the prepared tx. */
  transactionFee: string;
  transactionTimeout: number;
  /** Human-readable amount, e.g. "500.00". */
  amount: string;
  decimals: number;
  /** The market's asset contract address (a SAC for every classic asset). */
  assetId: string;
}
