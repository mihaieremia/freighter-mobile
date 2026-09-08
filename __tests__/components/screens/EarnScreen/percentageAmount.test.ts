import BigNumber from "bignumber.js";
import {
  DEBT_LIMITED_MARGIN,
  FULL_REPAY_MARGIN,
  NATIVE_FEE_ALLOWANCE_XLM,
  getPercentageRepayAmount,
  getPercentageWithdrawAmount,
} from "components/screens/EarnScreen/helpers";

describe("getPercentageWithdrawAmount", () => {
  const available = new BigNumber("100");

  it("offers the whole balance when no debt limits the leg", () => {
    expect(
      getPercentageWithdrawAmount({
        available,
        pct: 100,
        decimals: 7,
        isLimitedByDebt: false,
      }),
    ).toBe("100");
  });

  // The bound is exact only for the ledger it was read from: interest and
  // prices move under it, so offering it whole is what made Max fail at
  // simulation.
  it("holds a margin back from a debt-limited bound", () => {
    expect(
      getPercentageWithdrawAmount({
        available,
        pct: 100,
        decimals: 7,
        isLimitedByDebt: true,
      }),
    ).toBe(new BigNumber(100).multipliedBy(DEBT_LIMITED_MARGIN).toFixed());
  });

  it("takes the percentage of the balance, not the raw percent", () => {
    expect(
      getPercentageWithdrawAmount({
        available,
        pct: 25,
        decimals: 7,
        isLimitedByDebt: false,
      }),
    ).toBe("25");
  });

  it("rounds down at the asset's precision, never up", () => {
    expect(
      getPercentageWithdrawAmount({
        available: new BigNumber("1.23456789"),
        pct: 100,
        decimals: 7,
        isLimitedByDebt: false,
      }),
    ).toBe("1.2345678");
  });
});

describe("getPercentageRepayAmount", () => {
  const owed = new BigNumber("100");

  it("overpays a full repayment so the debt lands at zero, not at dust", () => {
    expect(
      getPercentageRepayAmount({
        owed,
        spendable: new BigNumber("500"),
        pct: 100,
        decimals: 7,
        isNative: false,
      }),
    ).toBe(owed.multipliedBy(FULL_REPAY_MARGIN).toFixed());
  });

  it("takes a part-payment straight off the debt", () => {
    expect(
      getPercentageRepayAmount({
        owed,
        spendable: new BigNumber("500"),
        pct: 25,
        decimals: 7,
        isNative: false,
      }),
    ).toBe("25");
  });

  it("never offers more of a token than the wallet can spend", () => {
    expect(
      getPercentageRepayAmount({
        owed,
        spendable: new BigNumber("40"),
        pct: 100,
        decimals: 7,
        isNative: false,
      }),
    ).toBe("40");
  });

  // Repaying in XLM also has to pay the invoke's own fee out of the same
  // balance, which is why Max worked for every other asset and failed here.
  it("leaves the fee behind when the wallet caps an XLM repayment", () => {
    expect(
      getPercentageRepayAmount({
        owed,
        spendable: new BigNumber("6.8983453"),
        pct: 100,
        decimals: 7,
        isNative: true,
      }),
    ).toBe(
      new BigNumber("6.8983453").minus(NATIVE_FEE_ALLOWANCE_XLM).toFixed(),
    );
  });

  it("does not touch an XLM repayment the debt itself caps", () => {
    // The debt is far under the balance, so the fee still has the rest of
    // the wallet to come out of and nothing needs holding back.
    expect(
      getPercentageRepayAmount({
        owed: new BigNumber("1"),
        spendable: new BigNumber("6.8983453"),
        pct: 100,
        decimals: 7,
        isNative: true,
      }),
    ).toBe("1.0001");
  });

  it("offers nothing rather than a negative amount when the fee is all there is", () => {
    expect(
      getPercentageRepayAmount({
        owed,
        spendable: new BigNumber("0.05"),
        pct: 100,
        decimals: 7,
        isNative: true,
      }),
    ).toBe("0");
  });
});

describe("small full repayment", () => {
  it.each([0, 6, 7, 18, 27])(
    "rounds the margin up at %i decimals",
    (decimals) => {
      const unit = new BigNumber(1).shiftedBy(-decimals);
      expect(
        getPercentageRepayAmount({
          owed: unit,
          spendable: unit.multipliedBy(10),
          pct: 100,
          decimals,
          isNative: false,
        }),
      ).toBe(unit.multipliedBy(2).toFixed());
      expect(
        getPercentageRepayAmount({
          owed: unit,
          spendable: unit.multipliedBy("1.9"),
          pct: 100,
          decimals,
          isNative: false,
        }),
      ).toBe(unit.toFixed());
    },
  );
});
