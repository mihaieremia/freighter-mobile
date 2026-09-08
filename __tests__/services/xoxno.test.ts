import { NETWORKS } from "config/constants";
import { freighterBackendV2 } from "services/backend";
import {
  foldXoxnoHubs,
  getXoxnoDepositTarget,
  getXoxnoEarnOptions,
  getXoxnoPositions,
} from "services/xoxno";

jest.mock("services/backend", () => ({
  freighterBackendV2: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = freighterBackendV2.get as jest.Mock;
const mockPost = freighterBackendV2.post as jest.Mock;
const networkDetails = { network: NETWORKS.PUBLIC } as never;
const USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

beforeEach(() => jest.clearAllMocks());

const catalog = (options: unknown[]) => ({ data: { data: { options } } });

const apiOption = (over = {}) => ({
  asset_id: USDC_SAC,
  symbol: "USDC",
  name: null,
  decimals: 7,
  pools: [
    {
      id: `1:${USDC_SAC}`,
      name: "XOXNO Hub 1",
      supply_apy: 0.05,
      emissions_supply_apr: null,
      supplied_usd: 100,
    },
  ],
  ...over,
});

describe("getXoxnoEarnOptions", () => {
  it("splits the hub out of the catalog's '<hub>:<asset>' pool id", () => {
    // The contract is keyed by (hub_id, asset); the composite id is a backend
    // convention, and carrying it further would put a non-numeric value where
    // a u32 hub id is expected.
    mockGet.mockResolvedValue(catalog([apiOption()]));
    return getXoxnoEarnOptions({ networkDetails }).then(([option]) => {
      expect(option.offers[0].hubId).toBe(1);
      expect(option.offers[0].supplyApy).toBe(0.05);
      expect(option.offers[0].suppliedUsd).toBe(100);
    });
  });

  it("nulls the registry's 'native' symbol so the row falls back to XLM", () => {
    mockGet.mockResolvedValue(
      catalog([apiOption({ asset_id: XLM_SAC, symbol: "native" })]),
    );
    return getXoxnoEarnOptions({ networkDetails }).then(([option]) => {
      expect(option.symbol).toBeNull();
    });
  });

  it("sends the network as a query param", async () => {
    mockGet.mockResolvedValue(catalog([]));
    await getXoxnoEarnOptions({ networkDetails });
    expect(mockGet).toHaveBeenCalledWith("/protocols/xoxno/earn-options", {
      params: { network: NETWORKS.PUBLIC },
    });
  });

  it("throws when the payload has no data envelope", async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(getXoxnoEarnOptions({ networkDetails })).rejects.toThrow();
  });

  it("tolerates a missing options array", async () => {
    mockGet.mockResolvedValue({ data: { data: {} } });
    await expect(getXoxnoEarnOptions({ networkDetails })).resolves.toEqual([]);
  });
});

describe("foldXoxnoHubs", () => {
  const offer = (
    hubId: number,
    supplyApy: number | null,
    suppliedUsd: number | null,
  ) => ({
    hubId,
    name: `XOXNO Hub ${hubId}`,
    supplyApy,
    suppliedUsd,
  });
  const option = (assetId: string, symbol: string, offers: unknown[]) =>
    ({ assetId, symbol, name: null, decimals: 7, offers }) as never;

  it("groups each asset's offers into one hub per hub id", () => {
    const hubs = foldXoxnoHubs([
      option(USDC_SAC, "USDC", [offer(1, 0.05, 100), offer(2, 0.01, 5)]),
      option(XLM_SAC, "XLM", [offer(1, 0.01, 300)]),
    ]);

    expect(hubs.map((hub) => hub.id)).toEqual([1, 2]);
    expect(hubs[0].reserves.map((r) => r.symbol)).toEqual(["USDC", "XLM"]);
    expect(hubs[0].suppliedUsd).toBe(400);
  });

  it("weights the hub rate by what is supplied to each market", () => {
    // 100 at 5% and 300 at 1% is 2%, not the 3% an unweighted mean would give:
    // most of the hub's money is earning the lower rate.
    const [hub] = foldXoxnoHubs([
      option(USDC_SAC, "USDC", [offer(1, 0.05, 100)]),
      option(XLM_SAC, "XLM", [offer(1, 0.01, 300)]),
    ]);
    expect(hub.interestApy).toBeCloseTo(0.02);
  });

  it("reports an unpriced hub as unknown rather than zero", () => {
    // Null means "no fresh oracle price"; reporting 0% would read as a real
    // rate a depositor could act on.
    const [hub] = foldXoxnoHubs([
      option(USDC_SAC, "USDC", [offer(1, null, null)]),
    ]);
    expect(hub.suppliedUsd).toBeNull();
    expect(hub.interestApy).toBeNull();
  });

  it.each([
    [null, null],
    [null, 300],
  ] as const)("keeps incomplete hub rates unknown (%s, %s)", (apy, value) => {
    const [hub] = foldXoxnoHubs([
      option(USDC_SAC, "USDC", [offer(1, 0.05, 100)]),
      option(XLM_SAC, "XLM", [offer(1, apy, value)]),
    ]);
    expect(hub.interestApy).toBeNull();
    expect(hub.suppliedUsd).toBe(value === null ? null : 400);
  });

  it("keeps a genuine zero distinct from unpriced", () => {
    const [hub] = foldXoxnoHubs([option(USDC_SAC, "USDC", [offer(1, 0, 0)])]);
    expect(hub.suppliedUsd).toBe(0);
    // Nothing supplied means no weighting is possible, so the rate is unknown
    // even though every market reported one.
    expect(hub.interestApy).toBeNull();
  });
});

describe("getXoxnoDepositTarget", () => {
  const leg = (hubId: number, assetId: string, tokens: string | null) => ({
    hub_id: hubId,
    asset_id: assetId,
    symbol: null,
    name: null,
    decimals: 7,
    tokens,
    usd_value: null,
    apy: null,
    price_usd: null,
  });
  const position = (accountId: string, spokeId: number, supply: unknown[]) => ({
    protocol: "xoxno",
    id: accountId,
    name: null,
    net_usd: null,
    supplied_usd: null,
    borrowed_usd: null,
    net_apy: null,
    xoxno: {
      account_id: accountId,
      spoke_id: spokeId,
      position_mode: 0,
      health_factor: null,
      supply,
      borrow: [] as unknown[],
    },
  });
  const positionsResponse = (...positions: unknown[]) => ({
    data: {
      data: [
        {
          address: "G...",
          total_value_usd: 1,
          net_apy: null,
          positions,
        },
      ],
    },
  });
  const target = () =>
    getXoxnoDepositTarget({
      publicKey: "G...",
      hubId: 1,
      assetId: USDC_SAC,
      spokeId: 1,
      acceptingSpokeIds: [1],
      networkDetails,
    });

  it("prefers the position already supplying this market, and sums its legs", async () => {
    mockPost.mockResolvedValue(
      positionsResponse(
        position("5", 1, [leg(2, USDC_SAC, "1")]),
        position("6", 1, [leg(1, USDC_SAC, "25"), leg(1, XLM_SAC, "7")]),
      ),
    );

    // Asset matches are preferred only within the selected accepting spoke.
    await expect(target()).resolves.toEqual({
      accountId: "6",
      spokeId: 1,
      suppliedTokens: "25",
    });
  });

  it("falls back to a position in the pinned spoke", async () => {
    mockPost.mockResolvedValue(
      positionsResponse(position("9", 1, [leg(1, XLM_SAC, "7")])),
    );

    // The pinned spoke lists every asset the pinned hub offers, so supplying
    // a new asset into this account is valid; it holds none of it yet.
    await expect(target()).resolves.toEqual({
      accountId: "9",
      spokeId: 1,
      suppliedTokens: "0",
    });
  });

  it("never reuses another spoke even when it supplies the selected asset", async () => {
    mockPost.mockResolvedValue(
      positionsResponse(position("6", 3, [leg(1, USDC_SAC, "25")])),
    );
    await expect(target()).resolves.toMatchObject({
      accountId: "0",
      spokeId: 1,
    });
  });
  it("treats unpriced debt as debt and creates a separate position", async () => {
    const leveraged = position("6", 1, [leg(1, USDC_SAC, "25")]);
    leveraged.xoxno.borrow = [leg(1, XLM_SAC, null)];
    mockPost.mockResolvedValue(positionsResponse(leveraged));
    await expect(target()).resolves.toMatchObject({ accountId: "0" });
  });
  it("rejects a selected spoke that is no longer accepting", async () => {
    mockPost.mockResolvedValue(positionsResponse());
    await expect(
      getXoxnoDepositTarget({
        publicKey: "G...",
        hubId: 1,
        assetId: USDC_SAC,
        spokeId: 3,
        acceptingSpokeIds: [1],
        networkDetails,
      }),
    ).rejects.toThrow();
  });

  it("opens a new position when the account has none that fits", async () => {
    mockPost.mockResolvedValue(
      positionsResponse(position("9", 4, [leg(1, XLM_SAC, "7")])),
    );

    // Account 9's spoke is neither the pinned one nor already supplying this
    // asset, so its reserve list may not cover it. "0" opens a fresh position
    // in the pinned spoke instead of risking a rejected call.
    await expect(target()).resolves.toEqual({
      accountId: "0",
      spokeId: 1,
      suppliedTokens: "0",
    });
  });

  it("opens a new position for an address the indexer has never seen", async () => {
    mockPost.mockResolvedValue(positionsResponse());
    await expect(target()).resolves.toEqual({
      accountId: "0",
      spokeId: 1,
      suppliedTokens: "0",
    });
  });

  it("stops preparation when the target quantity is unavailable", async () => {
    mockPost.mockResolvedValue(
      positionsResponse(position("6", 1, [leg(1, USDC_SAC, null)])),
    );
    await expect(target()).rejects.toThrow();
  });
  it("rejects a partial upstream account envelope", async () => {
    mockPost.mockResolvedValue({ data: { data: [] } });
    await expect(target()).rejects.toThrow();
    mockPost.mockResolvedValue(
      positionsResponse({ protocol: "xoxno", id: "6" }),
    );
    await expect(target()).rejects.toThrow();
  });

  it("ignores positions from another protocol", async () => {
    mockPost.mockResolvedValue(
      positionsResponse({ protocol: "other", id: "1", name: null }),
    );
    await expect(target()).resolves.toEqual({
      accountId: "0",
      spokeId: 1,
      suppliedTokens: "0",
    });
  });

  it("never joins a position that is carrying debt", async () => {
    // Supplying into a leveraged position would turn the deposit into cover
    // for borrowing the depositor never did, locking it behind a solvency
    // check they never agreed to. A fresh position is opened instead, even
    // though this one is in the pinned spoke and already holds the asset.
    const leveraged = position("6", 1, [leg(1, USDC_SAC, "5000000000")]);
    leveraged.xoxno.borrow = [leg(1, XLM_SAC, "100")];
    mockPost.mockResolvedValue(positionsResponse(leveraged));

    await expect(target()).resolves.toEqual({
      accountId: "0",
      spokeId: 1,
      suppliedTokens: "0",
    });
  });

  it("posts the address as a single-element batch", async () => {
    mockPost.mockResolvedValue(positionsResponse());
    await target();
    expect(mockPost).toHaveBeenCalledWith(
      "/accounts/positions",
      { addresses: ["G..."] },
      { params: { network: NETWORKS.PUBLIC } },
    );
  });

  it("throws when the payload has no data envelope", async () => {
    mockPost.mockResolvedValue({ data: {} });
    await expect(target()).rejects.toThrow();
  });
});

describe("getXoxnoPositions", () => {
  const leg = (assetId: string, tokens: string | null, symbol = "USDC") => ({
    hub_id: 1,
    hub_name: "Core",
    withdrawable_tokens: tokens,
    asset_id: assetId,
    symbol,
    name: null,
    decimals: 7,
    tokens,
    usd_value: 1,
    apy: 0.05,
    price_usd: 1,
  });
  const response = (
    supply: unknown[],
    spokeName: string | null = "Blue Chip",
    borrow: unknown[] = [],
  ) => ({
    data: {
      data: [
        {
          address: "G...",
          total_value_usd: 1,
          net_apy: null,
          positions: [
            {
              protocol: "xoxno",
              id: "6",
              name: spokeName,
              net_usd: null,
              supplied_usd: null,
              borrowed_usd: null,
              net_apy: null,
              xoxno: {
                account_id: "6",
                spoke_id: 1,
                spoke_name: spokeName,
                position_mode: 0,
                health_factor: null,
                supply,
                borrow,
              },
            },
          ],
        },
      ],
    },
  });
  const positions = () =>
    getXoxnoPositions({ publicKey: "G...", networkDetails });

  it("carries the account id and spoke name each leg needs to be withdrawn", async () => {
    mockPost.mockResolvedValue(response([leg(USDC_SAC, "5000000000")]));
    const [position] = await positions();

    expect(position.accountId).toBe("6");
    expect(position.spokeName).toBe("Blue Chip");
    // The leg repeats the account id because `withdraw` takes it, and the row
    // that opens the withdrawal only has the leg in hand.
    expect(position.supply[0].accountId).toBe("6");
    // The hub names the leg, since one position's legs can sit in different
    // hubs and the rate belongs to the hub.
    expect(position.supply[0].hubName).toBe("Core");
    expect(position.supply[0].tokens).toBe("5000000000");
  });

  it("drops a leg whose balance cannot be stated", async () => {
    // `tokens` is null when the token's decimals are unknown upstream.
    // Showing it as zero would read as "nothing to withdraw" for a leg that
    // in fact holds something.
    mockPost.mockResolvedValue(
      response([leg(USDC_SAC, null), leg(XLM_SAC, "0", "native")]),
    );
    await expect(positions()).resolves.toEqual([]);
  });

  it("resolves the registry's 'native' symbol to XLM", async () => {
    // A position has no held balance to fall back to, so leaving this null
    // pushed every consumer to its own answer — the withdraw flow rendered
    // the truncated contract address where the row rendered "XLM".
    mockPost.mockResolvedValue(response([leg(XLM_SAC, "1", "native")]));
    const [position] = await positions();
    expect(position.supply[0].symbol).toBe("XLM");
  });

  it("carries the position's debt rather than hiding it", async () => {
    // Freighter can neither borrow nor repay, but a position opened elsewhere
    // can carry debt, and that debt is what bounds every withdrawal from it.
    mockPost.mockResolvedValue(
      response([leg(USDC_SAC, "5000000000")], "Blue Chip", [
        leg(XLM_SAC, "100", "native"),
      ]),
    );
    const [position] = await positions();

    expect(position.borrow).toHaveLength(1);
    expect(position.borrow[0].tokens).toBe("100");
  });

  it("keeps unknown debt quantities visible", async () => {
    mockPost.mockResolvedValue(response([], "Blue Chip", [leg(XLM_SAC, null)]));
    const [position] = await positions();
    expect(position.borrow).toHaveLength(1);
    expect(position.borrow[0].tokens).toBeNull();
  });

  it("ignores positions from another protocol", async () => {
    mockPost.mockResolvedValue({
      data: { data: [{ address: "G...", positions: [{ protocol: "other" }] }] },
    });
    await expect(positions()).resolves.toEqual([]);
  });

  it("throws when the payload has no data envelope", async () => {
    mockPost.mockResolvedValue({ data: {} });
    await expect(positions()).rejects.toThrow();
  });
});
