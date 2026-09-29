/* eslint-disable @fnando/consistent-import/consistent-import */
import { mapHistoryItemData } from "components/screens/HistoryScreen/mappers";
import {
  TransactionStatus,
  TransactionType,
} from "components/screens/HistoryScreen/types";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { resetTokenCatalogInFlightForTests } from "ducks/tokenCatalog";
import { ThemeColors } from "hooks/useColors";
import "i18n";
import { getTokenDetails } from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

import {
  SWAPPER,
  lendingRepay,
  usdcToXaum,
  usdcToXaumMeta,
  xlmToUsdt0,
} from "../../../../../__mocks__/routerSwapHistory";
import {
  catalogXaum,
  seedCatalog,
} from "../../../../../__mocks__/tokenCatalog";

jest.mock("helpers/getIconUrl", () => ({
  getIconUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("services/backend", () => ({
  fetchCollectibles: jest.fn().mockResolvedValue([]),
  fetchTokenCatalog: jest.fn().mockResolvedValue([]),
  getTokenDetails: jest.fn(),
}));

const mockFetchTransactionMeta = fetchTransactionMeta as jest.MockedFunction<
  typeof fetchTransactionMeta
>;
const mockGetTokenDetails = getTokenDetails as jest.MockedFunction<
  typeof getTokenDetails
>;

const networkDetails = mapNetworkToNetworkDetails(NETWORKS.PUBLIC);
const map = (operation: unknown) =>
  mapHistoryItemData({
    operation,
    accountBalances: {},
    publicKey: SWAPPER,
    networkDetails,
    network: NETWORKS.PUBLIC,
    themeColors: {
      foreground: { primary: "#000000" },
    } as unknown as ThemeColors,
  });

describe("mapHistoryItemData — router swaps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTokenCatalogInFlightForTests();
    seedCatalog(
      NETWORKS.PUBLIC,
      catalogXaum({
        iconUrl: "https://media.xoxno.com/tokens/xaum/logo.png",
        swappable: true,
      }),
    );
    mockGetTokenDetails.mockResolvedValue(null);
    mockFetchTransactionMeta.mockResolvedValue(null);
  });

  it("lists 10 XLM for USDT0 as a swap with the sent and received legs", async () => {
    const item = await map(xlmToUsdt0);

    expect(item.transactionDetails?.transactionType).toBe(TransactionType.SWAP);
    expect(item.rowText).toBe("XLM to USDT0");
    expect(item.actionText).toBe("Swapped");
    expect(item.amountText).toBe("+2.3156637 USDT0");
    expect(item.isAddingFunds).toBe(true);
    expect(item.transactionDetails?.swapDetails).toMatchObject({
      sourceTokenCode: "XLM",
      sourceAmount: "10.0000000",
      destinationTokenCode: "USDT0",
      destinationAmount: "2.3156637",
    });
    expect(
      item.transactionDetails?.assetDiffs?.map(
        ({ isCredit, amount, assetCode }) => [isCredit, amount, assetCode],
      ),
    ).toEqual([
      [false, "10.0000000", "XLM"],
      [true, "2.3156637", "USDT0"],
    ]);
  });

  it("lists a swap for a Soroban token with the amount received from the transaction events", async () => {
    mockFetchTransactionMeta.mockResolvedValue(usdcToXaumMeta);

    const item = await map(usdcToXaum);

    expect(item.transactionDetails?.transactionType).toBe(TransactionType.SWAP);
    expect(item.rowText).toBe("USDC to XAUM");
    expect(item.amountText).toBe("+0.0016086 XAUM");
    expect(item.isAddingFunds).toBe(true);
    expect(item.transactionDetails?.swapDetails).toMatchObject({
      sourceTokenCode: "USDC",
      sourceAmount: "6.7546053",
      destinationTokenCode: "XAUM",
      destinationAmount: "0.001608622",
    });
  });

  it("lists a swap for a Soroban token with the sold amount only when the events cannot be fetched", async () => {
    // Received amounts are cached by transaction hash; this one was never read.
    const item = await map({
      ...usdcToXaum,
      transaction_hash: "hash-of-a-transaction-never-read",
    });

    expect(item.transactionDetails?.transactionType).toBe(TransactionType.SWAP);
    expect(item.rowText).toBe("USDC to XAUM");
    expect(item.amountText).toBe("-6.7546053 USDC");
    expect(item.isAddingFunds).toBe(false);
    expect(item.transactionDetails?.swapDetails?.destinationAmount).toBe("");
    expect(
      item.transactionDetails?.assetDiffs?.map(({ isCredit }) => isCredit),
    ).toEqual([false]);
  });

  it("keeps a call to another contract a contract interaction", async () => {
    const item = await map(lendingRepay);

    expect(item.transactionDetails?.transactionType).toBe(
      TransactionType.CONTRACT,
    );
  });

  it("keeps a failed router transaction a failed transaction", async () => {
    const item = await map({ ...xlmToUsdt0, transaction_successful: false });

    expect(item.transactionStatus).toBe(TransactionStatus.FAILED);
    expect(item.transactionDetails?.transactionType).not.toBe(
      TransactionType.SWAP,
    );
  });
});
