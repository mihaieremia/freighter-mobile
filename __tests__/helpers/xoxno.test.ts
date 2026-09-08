import { scValToNative } from "@stellar/stellar-sdk";
import {
  buildXoxnoRepayArgs,
  buildXoxnoSupplyArgs,
  buildXoxnoWithdrawArgs,
} from "helpers/xoxno";

const USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PUBLIC_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const args = (over: Partial<Parameters<typeof buildXoxnoSupplyArgs>[0]> = {}) =>
  buildXoxnoSupplyArgs({
    publicKey: PUBLIC_KEY,
    accountId: "6",
    spokeId: 1,
    hubId: 1,
    assetId: USDC_SAC,
    amount: "5000000000",
    ...over,
  });

describe("buildXoxnoSupplyArgs", () => {
  it("passes caller, account id, spoke and the asset batch in the contract's order", () => {
    // supply(caller, account_id: u64, spoke_id: u32, assets: Vec<(HubAssetKey, i128)>)
    expect(args().map(scValToNative)).toEqual([
      PUBLIC_KEY,
      BigInt(6),
      1,
      [[{ asset: USDC_SAC, hub_id: 1 }, BigInt("5000000000")]],
    ]);
  });

  it("encodes each asset as a (HubAssetKey, i128) tuple, not a flat struct", () => {
    // The amount sits beside the key in a 2-tuple rather than inside it; a
    // struct with an `amount` field would not decode against the contract.
    const [entry] = scValToNative(args()[3]) as unknown[][];
    expect(entry).toHaveLength(2);
    expect(entry[0]).toEqual({ asset: USDC_SAC, hub_id: 1 });
    expect(entry[1]).toBe(BigInt("5000000000"));
  });

  it("orders the HubAssetKey map keys by byte value, as Soroban requires", () => {
    // A struct decodes only when its symbol keys ascend: "asset" before
    // "hub_id". Hand-built rather than via nativeToScVal, which sorts by
    // locale collation and so is not byte order for keys containing "_".
    const [[key]] = scValToNative(args()[3]) as Record<string, unknown>[][];
    expect(Object.keys(key)).toEqual(["asset", "hub_id"]);
  });

  it("sends account id 0 to open a new position", () => {
    const [, accountId] = args({ accountId: "0" });
    expect(scValToNative(accountId)).toBe(BigInt(0));
  });

  it("keeps a large account id exact rather than going through a float", () => {
    // Account ids are u64. Passing them as decimal strings avoids the
    // precision loss a JS number would introduce past 2^53.
    const big = "18446744073709551615";
    const [, accountId] = args({ accountId: big });
    expect(scValToNative(accountId)).toBe(BigInt(big));
  });
});

describe("buildXoxnoWithdrawArgs", () => {
  const withdrawArgs = (
    over: Partial<Parameters<typeof buildXoxnoWithdrawArgs>[0]> = {},
  ) =>
    buildXoxnoWithdrawArgs({
      publicKey: PUBLIC_KEY,
      accountId: "6",
      hubId: 1,
      assetId: USDC_SAC,
      amount: "5000000000",
      ...over,
    });

  it("passes caller, account id, the withdrawal batch and the recipient", () => {
    // withdraw(caller, account_id: u64, withdrawals: Vec<(HubAssetKey, i128)>, to: Option<Address>)
    expect(withdrawArgs().map(scValToNative)).toEqual([
      PUBLIC_KEY,
      BigInt(6),
      [[{ asset: USDC_SAC, hub_id: 1 }, BigInt("5000000000")]],
      PUBLIC_KEY,
    ]);
  });

  it("encodes the recipient as a bare address, not a one-element vector", () => {
    // Soroban encodes `Some(v)` as the value itself; wrapping it would decode
    // as a vec and the call would be rejected.
    const [, , , to] = withdrawArgs();
    expect(scValToNative(to)).toBe(PUBLIC_KEY);
    expect(Array.isArray(scValToNative(to))).toBe(false);
  });

  it("sends amount 0 to empty the leg", () => {
    // 0 is the contract's "withdraw everything", and the only way to empty a
    // leg exactly: the balance accrues right up to the executing ledger, so
    // any figure computed beforehand leaves dust.
    const [, , batch] = withdrawArgs({ amount: "0" });
    const [[, amount]] = scValToNative(batch) as unknown[][];
    expect(amount).toBe(BigInt(0));
  });
});

describe("buildXoxnoRepayArgs", () => {
  const repayArgs = (amount = "5000000000") =>
    buildXoxnoRepayArgs({
      publicKey: PUBLIC_KEY,
      accountId: "6",
      hubId: 1,
      assetId: USDC_SAC,
      amount,
    });

  it("passes payer, account id and the payment batch, with no recipient", () => {
    // repay(caller, account_id: u64, payments: Vec<(HubAssetKey, i128)>) —
    // three arguments, unlike withdraw, which also names where funds land.
    expect(repayArgs().map(scValToNative)).toEqual([
      PUBLIC_KEY,
      BigInt(6),
      [[{ asset: USDC_SAC, hub_id: 1 }, BigInt("5000000000")]],
    ]);
  });

  it("carries an overpayment through unchanged", () => {
    // Paying above the debt is how it is cleared exactly; the pool refunds
    // the excess, so the client must not clamp the figure on the way in.
    const [, , batch] = repayArgs("99999999999");
    const [[, amount]] = scValToNative(batch) as unknown[][];
    expect(amount).toBe(BigInt("99999999999"));
  });
});
