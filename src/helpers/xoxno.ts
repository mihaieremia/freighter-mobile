import { Address, Contract, XdrLargeInt, xdr } from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { t } from "i18next";

/** Partial actions must be exact positive base units; zero is an explicit exit. */
export const xoxnoAmountToUnits = (
  amount: string,
  decimals: number,
): string => {
  const units = new BigNumber(amount).shiftedBy(decimals);
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 27 ||
    !units.isFinite() ||
    !units.isInteger() ||
    units.lte(0) ||
    units.gt("170141183460469231731687303715884105727")
  ) {
    throw new Error(t("earnSafety.invalidAmount"));
  }
  return units.toFixed(0);
};

/**
 * ScVal encoders for the XOXNO controller's three user entry points.
 *
 * `caller` is the transaction source account in all three, so simulation
 * returns an auth entry with source-account credentials and the envelope
 * signature covers it — no `authorizeEntry` round trip. Supply and repay pull
 * the asset via `require_auth` on the token's own `transfer` inside the same
 * transaction, so neither needs a separate approval step.
 */

/**
 * Encodes `HubAssetKey { hub_id: u32, asset: Address }`.
 *
 * Soroban encodes a `#[contracttype]` struct as an ScMap whose Symbol keys are
 * in ascending BYTE order: `asset`, then `hub_id`. This is hand-built rather
 * than going through `nativeToScVal`, which sorts with `String.localeCompare` —
 * locale collation ignores `_`, so it is not byte order in general (it would
 * invert `r_two` vs `reactivity`, for instance). For these two keys the orders
 * happen to agree, but relying on that is a trap for the next struct.
 */
const buildHubAssetKey = (hubId: number, assetId: string): xdr.ScVal =>
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("asset"),
      val: new Address(assetId).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("hub_id"),
      val: xdr.ScVal.scvU32(hubId),
    }),
  ]);

/**
 * The `Vec<(HubAssetKey, i128)>` every one of the three calls carries.
 *
 * Exported so a caller can rebuild the exact bytes it expects and compare
 * them against a built transaction, rather than decoding the transaction into
 * JavaScript values and comparing those: the decoded shape depends on the
 * SDK's map handling, which is not the same everywhere the app runs.
 */
export const buildXoxnoAssetEntries = (
  hubId: number,
  assetId: string,
  amount: string,
): xdr.ScVal =>
  xdr.ScVal.scvVec([
    xdr.ScVal.scvVec([
      buildHubAssetKey(hubId, assetId),
      new XdrLargeInt("i128", amount).toI128(),
    ]),
  ]);

/**
 * Arguments for the controller's
 * `supply(caller: Address, account_id: u64, spoke_id: u32, assets: Vec<(HubAssetKey, i128)>)`.
 *
 * Exported separately from the operation so the encoding can be asserted
 * without unwrapping a built transaction.
 *
 * A single-element `assets` vector: Freighter deposits one asset at a time,
 * though the contract accepts a batch across hubs in one call.
 */
export const buildXoxnoSupplyArgs = ({
  publicKey,
  accountId,
  spokeId,
  hubId,
  assetId,
  amount,
}: XoxnoSupplyArgs): xdr.ScVal[] => [
  new Address(publicKey).toScVal(),
  new XdrLargeInt("u64", accountId).toU64(),
  xdr.ScVal.scvU32(spokeId),
  buildXoxnoAssetEntries(hubId, assetId, amount),
];

export interface XoxnoSupplyArgs {
  /** Payer and position owner; always the transaction source account. */
  publicKey: string;
  /** Existing position NFT id, or "0" to open a new position in `spokeId`. */
  accountId: string;
  /** Risk spoke. Read only when opening a position; ignored otherwise. */
  spokeId: number;
  hubId: number;
  /** The market's asset contract address (a SAC for every classic asset). */
  assetId: string;
  /** Base-10 string in the asset's smallest unit, already scaled by decimals. */
  amount: string;
}

/** Builds `controller.supply(...)`. */
export const buildXoxnoSupplyOp = ({
  controllerId,
  ...args
}: XoxnoSupplyArgs & { controllerId: string }) =>
  new Contract(controllerId).call("supply", ...buildXoxnoSupplyArgs(args));

export interface XoxnoWithdrawArgs {
  /** Position owner and recipient; always the transaction source account. */
  publicKey: string;
  /** The position NFT to withdraw from. */
  accountId: string;
  hubId: number;
  assetId: string;
  /**
   * Base-10 string in the asset's smallest unit. `"0"` is not "nothing": the
   * contract reads it as "withdraw the whole supplied position", which is the
   * only way to empty a leg exactly — a supply balance grows with the index
   * between the quote and the ledger that executes it, so any figure computed
   * up front is stale on arrival and would leave dust behind.
   */
  amount: string;
}

/**
 * Arguments for the controller's
 * `withdraw(caller: Address, account_id: u64, withdrawals: Vec<(HubAssetKey, i128)>, to: Option<Address>)`.
 *
 * `to` is sent explicitly as the caller rather than as `None`. Both pay the
 * same account today, but naming the recipient keeps the destination visible
 * in the signed envelope instead of implied by the contract's default.
 */
export const buildXoxnoWithdrawArgs = ({
  publicKey,
  accountId,
  hubId,
  assetId,
  amount,
}: XoxnoWithdrawArgs): xdr.ScVal[] => [
  new Address(publicKey).toScVal(),
  new XdrLargeInt("u64", accountId).toU64(),
  buildXoxnoAssetEntries(hubId, assetId, amount),
  // `Option<Address>` is encoded as the value itself for `Some` and
  // `scvVoid` for `None` — never as a one-element vector.
  new Address(publicKey).toScVal(),
];

/** Builds `controller.withdraw(...)`. */
export const buildXoxnoWithdrawOp = ({
  controllerId,
  ...args
}: XoxnoWithdrawArgs & { controllerId: string }) =>
  new Contract(controllerId).call("withdraw", ...buildXoxnoWithdrawArgs(args));

export interface XoxnoRepayArgs {
  /** Payer; anyone may repay, but this app only ever repays its own position. */
  publicKey: string;
  /** The position NFT whose debt is being repaid. */
  accountId: string;
  hubId: number;
  assetId: string;
  /**
   * Base-10 string in the asset's smallest unit, and strictly positive: the
   * contract rejects zero, so there is no "repay everything" instruction the
   * way there is for withdraw. Overpaying is the way to clear a debt exactly —
   * the pool refunds the excess to the payer in the same transaction.
   */
  amount: string;
}

/**
 * Arguments for the controller's
 * `repay(caller: Address, account_id: u64, payments: Vec<(HubAssetKey, i128)>)`.
 */
export const buildXoxnoRepayArgs = ({
  publicKey,
  accountId,
  hubId,
  assetId,
  amount,
}: XoxnoRepayArgs): xdr.ScVal[] => [
  new Address(publicKey).toScVal(),
  new XdrLargeInt("u64", accountId).toU64(),
  buildXoxnoAssetEntries(hubId, assetId, amount),
];

/** Builds `controller.repay(...)`. */
export const buildXoxnoRepayOp = ({
  controllerId,
  ...args
}: XoxnoRepayArgs & { controllerId: string }) =>
  new Contract(controllerId).call("repay", ...buildXoxnoRepayArgs(args));
