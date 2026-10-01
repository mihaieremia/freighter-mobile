import BigNumber from "bignumber.js";
import { buildSourceBalanceRight } from "components/screens/SwapScreen/helpers/swapDisplayStrings";
import { PricedBalance } from "config/types";

const soroban = {
  tokenCode: "XAUM",
  decimals: 9,
  total: new BigNumber("1608622"),
  available: new BigNumber("1608622"),
} as unknown as PricedBalance;

const classic = {
  tokenCode: "USDC",
  total: new BigNumber("12.5"),
  available: new BigNumber("12.5"),
} as unknown as PricedBalance;

const build = (
  sourceBalance: PricedBalance | undefined,
  spendableAmount: BigNumber | null,
) =>
  buildSourceBalanceRight({
    sourceBalance,
    sourceTokenSymbol: "TKN",
    spendableAmount,
    availableLabel: "available",
  });

describe("buildSourceBalanceRight", () => {
  it("shows a Soroban token's spendable amount once scaled, not scaled again", () => {
    expect(build(soroban, new BigNumber("0.001608622"))).toBe(
      "0.0016086 XAUM available",
    );
  });

  it("scales a Soroban token's raw total when there is no spendable amount", () => {
    expect(build(soroban, null)).toBe("0.0016086 XAUM available");
  });

  it("shows a classic token's spendable amount", () => {
    expect(build(classic, new BigNumber("12.25"))).toBe("12.25 USDC available");
  });

  it("falls back to a classic token's total", () => {
    expect(build(classic, null)).toBe("12.50 USDC available");
  });

  it("is empty without a source balance", () => {
    expect(build(undefined, null)).toBe("");
  });
});
