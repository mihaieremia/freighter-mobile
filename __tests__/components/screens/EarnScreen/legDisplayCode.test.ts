import { legDisplayCode } from "components/screens/EarnScreen/helpers";
import { XoxnoPositionLeg } from "config/xoxnoTypes";

const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

const leg = (symbol: string | null): XoxnoPositionLeg => ({
  accountId: "6",
  hubId: 1,
  hubName: "Core",
  assetId: XLM_SAC,
  symbol,
  decimals: 7,
  tokens: "1",
  withdrawableTokens: "1",
  usdValue: null,
  apy: null,
});

describe("legDisplayCode", () => {
  it("uses the registry code, which already resolves native to XLM", () => {
    expect(legDisplayCode(leg("XLM"))).toBe("XLM");
    expect(legDisplayCode(leg("USDC"))).toBe("USDC");
  });

  it("falls back to a truncated contract id only when there is no code at all", () => {
    // Never the contract id for an asset the registry does know: that is the
    // bug this helper exists to prevent, where the withdraw flow showed
    // "CDLZ…" for a leg the positions row showed as "XLM".
    expect(legDisplayCode(leg(null))).toBe(`${XLM_SAC.slice(0, 4)}…`);
  });
});
