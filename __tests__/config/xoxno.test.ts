import { NETWORKS } from "config/constants";
import {
  XOXNO_CONTROLLER_IDS,
  getXoxnoControllerId,
  isEarnSupportedNetwork,
} from "config/xoxno";

const details = (network: NETWORKS) =>
  ({ network }) as unknown as Parameters<typeof getXoxnoControllerId>[0];

describe("xoxno config", () => {
  it("maps each network to its own controller", () => {
    // The hub and spoke are no longer pinned here: an asset belongs to
    // exactly one hub, and the catalog reports which spokes accept it. The
    // controller address is the only thing that is per-network and fixed.
    const publicId = getXoxnoControllerId(details(NETWORKS.PUBLIC));
    const testnetId = getXoxnoControllerId(details(NETWORKS.TESTNET));

    expect(publicId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(testnetId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(publicId).not.toBe(testnetId);
  });

  it("reports Earn unsupported on a network with no deployment", () => {
    expect(getXoxnoControllerId(details(NETWORKS.FUTURENET))).toBeUndefined();
    expect(isEarnSupportedNetwork(details(NETWORKS.FUTURENET))).toBe(false);
  });

  it("reports Earn supported wherever XOXNO is deployed", () => {
    expect(isEarnSupportedNetwork(details(NETWORKS.PUBLIC))).toBe(true);
    expect(isEarnSupportedNetwork(details(NETWORKS.TESTNET))).toBe(true);
  });

  it("exposes exactly the two deployed networks", () => {
    expect(Object.keys(XOXNO_CONTROLLER_IDS).sort()).toEqual(
      [NETWORKS.PUBLIC, NETWORKS.TESTNET].sort(),
    );
  });
});
