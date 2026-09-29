/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  Account,
  Horizon,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { AssetDiffSummary } from "components/screens/HistoryScreen/types";
import {
  NETWORKS,
  PUBLIC_NETWORK_DETAILS,
  TESTNET_NETWORK_DETAILS,
} from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { resetTokenCatalogInFlightForTests } from "ducks/tokenCatalog";
import { toAggregatorSwapOperation } from "helpers/aggregatorSwapHistory";
import { processAssetBalanceChanges } from "helpers/assetBalanceChanges";
import { TokenCatalogEntry, getTokenDetails } from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

import {
  POOL_TOKEN_IN,
  POOL_TOKEN_OUT,
  OTHER_ACCOUNT,
  ROUTER,
  SWAPPER,
  XAUM_CONTRACT,
  lendingRepay,
  pyusdToUsdm1MultiHop,
  sorobanToSoroban,
  usdcToXaum,
  usdcToXaumMeta,
  xlmToSorobanPoolShare,
  xlmToUsdt0,
} from "../../__mocks__/routerSwapHistory";
import { catalogXaum, seedCatalog } from "../../__mocks__/tokenCatalog";

jest.mock("helpers/getIconUrl", () => ({
  getIconUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("services/backend", () => ({
  fetchTokenCatalog: jest.fn().mockResolvedValue([]),
  getTokenDetails: jest.fn(),
}));

const mockFetchTransactionMeta = fetchTransactionMeta as jest.MockedFunction<
  typeof fetchTransactionMeta
>;
const mockGetTokenDetails = getTokenDetails as jest.MockedFunction<
  typeof getTokenDetails
>;

const network = PUBLIC_NETWORK_DETAILS;

const xaum = catalogXaum({
  iconUrl: "https://media.xoxno.com/tokens/xaum/logo.png",
  swappable: true,
});
const poolEntry = (id: string): TokenCatalogEntry => ({
  id,
  code: "POOL",
  name: "Pool Share Token",
  decimals: 7,
  swappable: false,
});

/** A distinct hash per test: received amounts are cached by transaction. */
let hashCounter = 0;
const freshUsdcToXaum = () => {
  hashCounter += 1;

  return {
    ...usdcToXaum,
    transaction_hash: `hash-${hashCounter}`,
  } as unknown as Horizon.ServerApi.OperationRecord;
};

const diffsOf = (operation: Horizon.ServerApi.OperationRecord) =>
  processAssetBalanceChanges(operation, SWAPPER, network);

const swapOf = async (
  operation: Horizon.ServerApi.OperationRecord,
  overrides: {
    publicKey?: string;
    assetDiffs?: AssetDiffSummary[];
    networkDetails?: typeof network;
  } = {},
) =>
  toAggregatorSwapOperation({
    operation,
    publicKey: overrides.publicKey ?? SWAPPER,
    networkDetails: overrides.networkDetails ?? network,
    assetDiffs: overrides.assetDiffs ?? (await diffsOf(operation)),
  });

describe("toAggregatorSwapOperation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTokenCatalogInFlightForTests();
    seedCatalog(NETWORKS.PUBLIC);
    mockGetTokenDetails.mockResolvedValue(null);
    mockFetchTransactionMeta.mockResolvedValue(null);
  });

  describe("classic legs, both in the balance changes", () => {
    it("turns 10 XLM for USDT0 into a swap from the balance changes alone", async () => {
      expect(await swapOf(xlmToUsdt0)).toMatchObject({
        id: xlmToUsdt0.id,
        source_amount: "10.0000000",
        source_asset_code: "XLM",
        source_asset_issuer: undefined,
        source_asset_type: TokenTypeWithCustomToken.NATIVE,
        amount: "2.3156637",
        asset_code: "USDT0",
        asset_issuer:
          "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
        asset_type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
      });
      expect(mockGetTokenDetails).not.toHaveBeenCalled();
    });

    it("shows a four-hop route as its first debit and last credit", async () => {
      expect(await swapOf(pyusdToUsdm1MultiHop)).toMatchObject({
        source_amount: "1.0000000",
        source_asset_code: "PYUSD",
        source_asset_type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
        amount: "0.9953869",
        asset_code: "USDM1",
        asset_type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
      });
    });
  });

  describe("a Soroban token bought", () => {
    it("takes the sold amount from the balance change and the token from the catalog, with no bought amount when the events cannot be fetched", async () => {
      seedCatalog(NETWORKS.PUBLIC, xaum);

      expect(await swapOf(freshUsdcToXaum())).toMatchObject({
        source_amount: "6.7546053",
        source_asset_code: "USDC",
        amount: "",
        asset_code: "XAUM",
        asset_issuer: XAUM_CONTRACT,
        asset_type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
        icon_url: "https://media.xoxno.com/tokens/xaum/logo.png",
      });
      expect(mockGetTokenDetails).not.toHaveBeenCalled();
      expect(mockFetchTransactionMeta).toHaveBeenCalledTimes(1);
    });

    it("falls back to the token's own details when the catalog does not list it", async () => {
      mockGetTokenDetails.mockResolvedValue({
        name: "Matrixdock Gold",
        symbol: "XAUM",
        decimals: 9,
      });

      expect(await swapOf(usdcToXaum)).toMatchObject({
        amount: "",
        asset_code: "XAUM",
        asset_issuer: XAUM_CONTRACT,
        icon_url: undefined,
      });
    });

    it("is not a swap when the bought token cannot be identified", async () => {
      expect(await swapOf(usdcToXaum)).toBeNull();
      expect(mockFetchTransactionMeta).not.toHaveBeenCalled();
    });
  });

  describe("a Soroban token bought, received amount from the transaction events", () => {
    const received = async (meta: string | null) => {
      mockFetchTransactionMeta.mockResolvedValue(meta);

      return swapOf(freshUsdcToXaum());
    };

    beforeEach(() => seedCatalog(NETWORKS.PUBLIC, xaum));

    it("scales the transfer to the swapper by the token's decimals", async () => {
      expect(await received(usdcToXaumMeta)).toMatchObject({
        source_amount: "6.7546053",
        amount: "0.001608622",
        asset_code: "XAUM",
      });
      expect(mockFetchTransactionMeta).toHaveBeenCalledWith(
        expect.stringMatching(/^hash-/),
        network.network,
      );
    });

    it("uses the token's own details for the decimals when the catalog lacks it", async () => {
      seedCatalog(NETWORKS.PUBLIC);
      mockGetTokenDetails.mockResolvedValue({
        name: "Matrixdock Gold",
        symbol: "XAUM",
        decimals: 9,
      });

      expect((await received(usdcToXaumMeta))?.amount).toBe("0.001608622");
    });

    it("keeps the sold amount only when the lookup fails", async () => {
      expect(await received(null)).toMatchObject({
        source_amount: "6.7546053",
        amount: "",
      });
    });

    it("does not fetch again for a transaction it already read", async () => {
      mockFetchTransactionMeta.mockResolvedValue(usdcToXaumMeta);
      const operation = freshUsdcToXaum();

      expect((await swapOf(operation))?.amount).toBe("0.001608622");
      expect((await swapOf(operation))?.amount).toBe("0.001608622");
      expect(mockFetchTransactionMeta).toHaveBeenCalledTimes(1);
    });

    it("does not remember a failed lookup", async () => {
      const operation = freshUsdcToXaum();
      mockFetchTransactionMeta.mockResolvedValueOnce(null);

      expect((await swapOf(operation))?.amount).toBe("");

      mockFetchTransactionMeta.mockResolvedValueOnce(usdcToXaumMeta);

      expect((await swapOf(operation))?.amount).toBe("0.001608622");
      expect(mockFetchTransactionMeta).toHaveBeenCalledTimes(2);
    });

    it("does not look events up when the balance changes hold the credit", async () => {
      await swapOf(xlmToUsdt0);

      expect(mockFetchTransactionMeta).not.toHaveBeenCalled();
    });
  });

  describe("Soroban tokens on both sides", () => {
    beforeEach(() => {
      seedCatalog(
        NETWORKS.PUBLIC,
        poolEntry(POOL_TOKEN_IN),
        poolEntry(POOL_TOKEN_OUT),
      );
    });

    it("takes the sold amount from the call's input amount and leaves the bought one empty", async () => {
      expect(await swapOf(sorobanToSoroban)).toMatchObject({
        source_amount: "0.1729274",
        source_asset_code: "POOL",
        source_asset_issuer: POOL_TOKEN_IN,
        source_asset_type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
        amount: "",
        asset_code: "POOL",
        asset_issuer: POOL_TOKEN_OUT,
        asset_type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
      });
    });

    it("is not a swap when the sold token cannot be identified", async () => {
      seedCatalog(NETWORKS.PUBLIC, poolEntry(POOL_TOKEN_OUT));

      expect(await swapOf(sorobanToSoroban)).toBeNull();
    });

    it("keeps the debit of a classic token sold for a Soroban token", async () => {
      expect(await swapOf(xlmToSorobanPoolShare)).toMatchObject({
        source_amount: "2.0000000",
        source_asset_code: "XLM",
        amount: "",
        asset_code: "POOL",
        asset_issuer: POOL_TOKEN_IN,
      });
    });
  });

  describe("what is not one swap of the viewer", () => {
    const routerCall = (functionName: string) =>
      ({
        type: "invoke_host_function",
        transaction_hash: "abc",
        transaction_attr: {
          envelope_xdr: new TransactionBuilder(new Account(SWAPPER, "1"), {
            fee: "100",
            networkPassphrase: network.networkPassphrase,
          })
            .addOperation(
              Operation.invokeContractFunction({
                contract: ROUTER,
                function: functionName,
                args: [nativeToScVal(SWAPPER, { type: "address" })],
              }),
            )
            .setTimeout(0)
            .build()
            .toXDR(),
        },
      }) as unknown as Horizon.ServerApi.OperationRecord;

    it("leaves a call to another contract alone", async () => {
      expect(await swapOf(lendingRepay)).toBeNull();
    });

    it("leaves another router function alone", async () => {
      expect(await swapOf(routerCall("add_liquidity"))).toBeNull();
    });

    it("leaves a swap of another account alone", async () => {
      expect(
        await swapOf(xlmToUsdt0, {
          publicKey: OTHER_ACCOUNT,
        }),
      ).toBeNull();
    });

    it("has no router on a network that does not have this one", async () => {
      expect(
        await swapOf(xlmToUsdt0, { networkDetails: TESTNET_NETWORK_DETAILS }),
      ).toBeNull();
    });

    it("leaves a call with two debits alone", async () => {
      const diffs = await diffsOf(xlmToUsdt0);

      expect(
        await swapOf(xlmToUsdt0, {
          assetDiffs: [...diffs, { ...diffs[0], amount: "1" }],
        }),
      ).toBeNull();
    });

    it("leaves a call whose balance change is a token the route does not name alone", async () => {
      const diffs = await diffsOf(xlmToUsdt0);

      expect(
        await swapOf(xlmToUsdt0, {
          assetDiffs: diffs.map((diff) =>
            diff.isCredit ? { ...diff, assetCode: "OTHER" } : diff,
          ),
        }),
      ).toBeNull();
    });
  });
});
