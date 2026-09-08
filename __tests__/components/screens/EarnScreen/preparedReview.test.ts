import { Account, TransactionBuilder } from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import {
  EarnAction,
  EarnReviewParams,
  assertEarnFeeAffordable,
  prepareEarnReview,
} from "components/screens/EarnScreen/helpers/preparedReview";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { NativeBalance } from "config/types";
import { getXoxnoControllerId } from "config/xoxno";
import { getNativeContractDetails } from "helpers/soroban";
import {
  buildXoxnoSupplyOp,
  buildXoxnoWithdrawOp,
  buildXoxnoRepayOp,
  xoxnoAmountToUnits,
} from "helpers/xoxno";

const senderAddress =
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const assetId = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const params: EarnReviewParams = {
  senderAddress,
  assetId,
  accountId: "6",
  hubId: 1,
  spokeId: 2,
  amount: "0.0000001",
  decimals: 7,
  network: NETWORKS.TESTNET,
  transactionFee: "0.00001",
  transactionTimeout: 30,
};
const network = mapNetworkToNetworkDetails(params.network);
const envelope = (action: EarnAction, intent = params) => {
  const args = {
    publicKey: intent.senderAddress,
    controllerId: getXoxnoControllerId(network)!,
    accountId: intent.accountId!,
    spokeId: intent.spokeId!,
    hubId: intent.hubId,
    assetId: intent.assetId,
    amount:
      action === "withdraw" && intent.withdrawAll
        ? "0"
        : xoxnoAmountToUnits(intent.amount, intent.decimals),
  };
  const builders = {
    deposit: buildXoxnoSupplyOp,
    withdraw: buildXoxnoWithdrawOp,
    repay: buildXoxnoRepayOp,
  };
  const op = builders[action](args);
  return new TransactionBuilder(new Account(senderAddress, "1"), {
    networkPassphrase: network.networkPassphrase,
    fee: "600000",
  })
    .addOperation(op)
    .setTimeout(30)
    .build()
    .toXDR();
};

describe("prepared Earn intent", () => {
  // The asset, hub and amount are verified as encoded bytes rather than as a
  // decoded object, because the decoded shape differed on device and made a
  // correct transaction fail its own check. A wrong asset must still fail.
  it("rejects an entry built for a different asset", () => {
    const other = "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF";
    const xdr = envelope("withdraw", { ...params, assetId: other });
    expect(() => prepareEarnReview("withdraw", params, xdr, "r1")).toThrow(
      /entries/,
    );
  });

  it("accepts the asset it was built for", () => {
    const xdr = envelope("withdraw");
    expect(prepareEarnReview("withdraw", params, xdr, "r1").amountUnits).toBe(
      xoxnoAmountToUnits(params.amount, params.decimals),
    );
  });

  it.each(["deposit", "withdraw", "repay"] as const)(
    "binds %s to the decoded operation and total fee",
    (action) => {
      const xdr = envelope(action);
      const review = prepareEarnReview(action, params, xdr, "r1");
      expect(review).toMatchObject({
        action,
        accountId: "6",
        amountUnits: "1",
        preparedXdr: xdr,
        requestId: "r1",
        feeXlm: "0.06",
      });
      expect(review.params).not.toBe(params);
    },
  );
  it.each([
    { amount: "0.0000002" },
    { accountId: "7" },
    { hubId: 2 },
    { spokeId: 3 },
  ])("rejects mismatched operation intent %p", (changed) => {
    expect(() =>
      prepareEarnReview(
        "deposit",
        { ...params, ...changed },
        envelope("deposit"),
        "r1",
      ),
    ).toThrow();
  });
  it("permits zero only for explicit withdraw-all", () => {
    const all = { ...params, withdrawAll: true };
    const xdr = envelope("withdraw", all);
    expect(prepareEarnReview("withdraw", all, xdr, "r1").amountUnits).toBe("0");
    expect(() => prepareEarnReview("withdraw", params, xdr, "r1")).toThrow();
    expect(() => prepareEarnReview("repay", all, xdr, "r1")).toThrow();
  });
  it.each([
    "0",
    "-1",
    "NaN",
    "Infinity",
    "0.00000001",
    "170141183460469231731687303715884105728",
  ])("rejects invalid or inexact amount %s", (amount) => {
    expect(() => xoxnoAmountToUnits(amount, 7)).toThrow();
  });
  it.each([0, 6, 7, 18, 27])(
    "keeps one base unit exact at %i decimals",
    (decimals) => {
      expect(
        xoxnoAmountToUnits(
          new BigNumber(1).shiftedBy(-decimals).toFixed(),
          decimals,
        ),
      ).toBe("1");
    },
  );
  it.each([-1, 28, 7.1, NaN])("rejects invalid decimals %s", (decimals) => {
    expect(() => xoxnoAmountToUnits("1", decimals)).toThrow();
  });
});

describe("final total fee affordability", () => {
  const balance = (available: string): NativeBalance => ({
    token: { type: "native", code: "XLM" },
    total: new BigNumber(available).plus(1),
    available: new BigNumber(available),
    minimumBalance: new BigNumber(1),
    buyingLiabilities: "0",
    sellingLiabilities: "0",
  });
  it.each(["NaN", "Infinity"])(
    "rejects unavailable fee balance %s",
    (available) => {
      const review = prepareEarnReview(
        "withdraw",
        params,
        envelope("withdraw"),
        "r1",
      );
      expect(() =>
        assertEarnFeeAffordable(review, balance(available), 0),
      ).toThrow();
    },
  );
  it.each(["deposit", "withdraw", "repay"] as const)(
    "checks XLM for non-native %s",
    (action) => {
      const review = prepareEarnReview(action, params, envelope(action), "r1");
      expect(() =>
        assertEarnFeeAffordable(review, balance("0.0599999"), 0),
      ).toThrow();
      expect(() =>
        assertEarnFeeAffordable(review, balance("0.06"), 0),
      ).not.toThrow();
    },
  );
  it.each(["deposit", "repay"] as const)(
    "subtracts native %s principal before paying the fee",
    (action) => {
      const native = {
        ...params,
        assetId: getNativeContractDetails(params.network).contract,
        amount: "1",
      };
      const review = prepareEarnReview(
        action,
        native,
        envelope(action, native),
        "r1",
      );
      expect(() =>
        assertEarnFeeAffordable(review, balance("1.0599999"), 0),
      ).toThrow();
      expect(() =>
        assertEarnFeeAffordable(review, balance("1.06"), 0),
      ).not.toThrow();
    },
  );
});
