import { withdrawableBound } from "components/screens/EarnScreen/helpers";

const base = {
  routeBound: "500",
  legBound: "400",
};

it("stands in with the route's bound until the first fetch resolves", () => {
  expect(
    withdrawableBound({ ...base, positions: null, positionsError: null }),
  ).toBe("500");
});

it("has no bound when the first fetch fails", () => {
  expect(
    withdrawableBound({ ...base, positions: null, positionsError: "502" }),
  ).toBe(null);
});

it("keeps the loaded bound when a background poll fails", () => {
  // The failure arrives under a screen the user is already working in. Taking
  // the bound away disables the percentage buttons, raises the withdrawal-
  // unavailable block, and clears a typed amount — all of which undoes itself
  // on the next successful poll.
  expect(
    withdrawableBound({ ...base, positions: [{}], positionsError: "502" }),
  ).toBe("400");
});

it("reports no bound once a loaded leg has none", () => {
  expect(
    withdrawableBound({
      ...base,
      positions: [{}],
      positionsError: null,
      legBound: null,
    }),
  ).toBe(null);
});
