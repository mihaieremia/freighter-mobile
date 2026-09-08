import BigNumber from "bignumber.js";
import { buildEarnTokenRows } from "components/screens/EarnScreen/hooks/useEarnTokens";
import { NETWORKS } from "config/constants";

const HUB_ID = 1;
const USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

describe("buildEarnTokenRows", () => {
  const networkDetails = { network: NETWORKS.PUBLIC } as never;

  const option = (overrides = {}) => ({
    assetId: USDC_SAC,
    symbol: "USDC",
    name: null,
    decimals: 7,
    offers: [
      {
        hubId: HUB_ID,
        name: "XOXNO Hub 1",
        supplyApy: 0.05,
        suppliedUsd: 0,
        spokes: [
          {
            id: 1,
            name: "Blue Chip",
            loanToValueBps: 7500,
            liquidationThresholdBps: 7800,
          },
        ],
      },
    ],
    ...overrides,
  });

  it("puts a held asset in held and a zero-balance asset in supported", () => {
    const balances = {
      "USDC:GISSUER": {
        total: new BigNumber("50"),
        token: { code: "USDC", issuer: { key: "GISSUER" } },
      },
    } as never;

    const { held, supported } = buildEarnTokenRows({
      options: [option()],
      balances,
      networkDetails,
      findBalance: () => balances["USDC:GISSUER"],
    });

    expect(held).toHaveLength(1);
    expect(held[0].total).toBe("50");
    // The held row must carry the real balance through — `EarnTokenRow`
    // relies on it to render the exact icon rather than reconstructing one
    // from catalog data alone.
    expect(held[0].balance).toBe(balances["USDC:GISSUER"]);
    expect(supported).toHaveLength(0);
  });

  it("leaves `balance` undefined for a zero-balance (supported) row", () => {
    const { supported } = buildEarnTokenRows({
      options: [option()],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported[0].balance).toBeUndefined();
  });

  it("skips assets the allowlisted hub does not offer", () => {
    const { held, supported } = buildEarnTokenRows({
      options: [option({ offers: [] })],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(held).toHaveLength(0);
    expect(supported).toHaveLength(0);
  });

  it("falls back through symbol, then balance code, then a truncated id", () => {
    // The live catalog returns symbol AND name null for native XLM, so symbol
    // cannot be the only source of the display code.
    const { supported } = buildEarnTokenRows({
      options: [option({ symbol: null, name: null })],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported[0].code).toBe(`${USDC_SAC.slice(0, 4)}…`);
  });

  it("falls back to the held balance's own code when the catalog symbol is missing", () => {
    // The middle rung of the fallback chain: `option.symbol` absent but a
    // held balance exists, so its `token.code` should be used in preference
    // to the truncated-id last resort. Only the truncated-id branch (no
    // symbol AND no balance) was previously covered.
    const balance = {
      total: new BigNumber("50"),
      token: { code: "USDC", issuer: { key: "GISSUER" } },
    } as never;

    const { held } = buildEarnTokenRows({
      options: [option({ symbol: null, name: null })],
      balances: {} as never,
      networkDetails,
      findBalance: () => balance,
    });

    expect(held[0].code).toBe("USDC");
  });

  it("defaults decimals when the catalog omits them", () => {
    const { supported } = buildEarnTokenRows({
      options: [option({ decimals: null })],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported[0].decimals).toBe(7);
  });

  it("flags the reserve whose contract address is the network's native SAC", () => {
    // getBalanceByContractId's native trap applies here too: native must be
    // recognised by contract-address comparison, never by `code === "XLM"`.
    // Live TESTNET catalog data confirms native XLM's assetId equals the
    // derived native SAC (verified separately against getNativeContractDetails).
    const nativeAssetId =
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    const { supported } = buildEarnTokenRows({
      options: [
        option({
          assetId: nativeAssetId,
          symbol: null,
          name: null,
        }),
      ],
      balances: {} as never,
      networkDetails: { network: NETWORKS.TESTNET } as never,
      findBalance: () => undefined,
    });

    expect(supported[0].isNative).toBe(true);
  });

  it("does not flag a non-native reserve as native", () => {
    const { supported } = buildEarnTokenRows({
      options: [option()],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported[0].isNative).toBe(false);
  });
});

describe("buildEarnTokenRows ordering", () => {
  const networkDetails = { network: NETWORKS.PUBLIC } as never;

  const optionAt = (assetId: string, apy: number | null) =>
    ({
      assetId,
      symbol: assetId,
      name: null,
      decimals: 7,
      offers: [
        {
          hubId: 1,
          name: "Core",
          supplyApy: apy,
          suppliedUsd: 0,
          spokes: [
            {
              id: 1,
              name: "Blue Chip",
              loanToValueBps: 7500,
              liquidationThresholdBps: 7800,
            },
          ],
        },
      ],
    }) as never;

  it("puts the best return first", () => {
    const { supported } = buildEarnTokenRows({
      options: [
        optionAt("LOW", 0.01),
        optionAt("HIGH", 0.09),
        optionAt("MID", 0.05),
      ],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported.map((row) => row.assetId)).toEqual(["HIGH", "MID", "LOW"]);
  });

  it("sorts an unknown rate last rather than treating it as zero", () => {
    // A missing rate means the oracle had no fresh price, which is not the
    // same as earning nothing — ranking it among the real zeros would state
    // something the catalog never said.
    const { supported } = buildEarnTokenRows({
      options: [optionAt("UNKNOWN", null), optionAt("ZERO", 0)],
      balances: {} as never,
      networkDetails,
      findBalance: () => undefined,
    });

    expect(supported.map((row) => row.assetId)).toEqual(["ZERO", "UNKNOWN"]);
  });
});
