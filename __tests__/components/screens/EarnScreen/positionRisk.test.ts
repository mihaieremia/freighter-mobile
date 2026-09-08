import {
  formatRisk,
  liquidationRisk,
  riskLevel,
} from "components/screens/EarnScreen/helpers";

describe("liquidationRisk", () => {
  it("inverts the health factor into the share of borrowing power used", () => {
    // A health factor of 1 IS the liquidation point, so it reads as 100%.
    expect(liquidationRisk(1)).toBeCloseTo(100);
    // 1.08 is much closer to liquidation than the number suggests.
    expect(liquidationRisk(1.08)).toBeCloseTo(92.6, 1);
    expect(liquidationRisk(4)).toBeCloseTo(25);
  });

  it("reports nothing for a position with no debt", () => {
    // Nothing is borrowed against it, so there is no liquidation to be near.
    expect(liquidationRisk(null)).toBeNull();
    expect(liquidationRisk(0)).toBe(Infinity);
    expect(riskLevel(liquidationRisk(0)!)).toBe("danger");
  });
});

describe("riskLevel", () => {
  it("treats anything within ten points of liquidation as danger", () => {
    expect(riskLevel(100)).toBe("danger");
    expect(riskLevel(92.6)).toBe("danger");
    expect(riskLevel(90)).toBe("danger");
  });

  it("warns well before the edge, because the number moves on its own", () => {
    // Prices and accrued interest push this up with no action from the
    // holder, so "solvent" and "safe to leave" are not the same thing.
    expect(riskLevel(89.9)).toBe("caution");
    expect(riskLevel(75)).toBe("caution");
  });

  it("is safe only with real room to absorb a move", () => {
    expect(riskLevel(74.9)).toBe("safe");
    expect(riskLevel(25)).toBe("safe");
  });
});

describe("formatRisk", () => {
  it("keeps one decimal, which is what separates 92.6 from 93", () => {
    expect(formatRisk(92.59)).toBe("92.6%");
    expect(formatRisk(100)).toBe("100.0%");
  });
});
