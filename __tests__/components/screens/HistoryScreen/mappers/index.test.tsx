/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  mapHistoryItemData,
  mapInstantXoxnoHistoryItem,
} from "components/screens/HistoryScreen/mappers";
import {
  TransactionStatus,
  TransactionType,
} from "components/screens/HistoryScreen/types";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { resetTokenCatalogInFlightForTests } from "ducks/tokenCatalog";
import * as assetBalanceChanges from "helpers/assetBalanceChanges";
import { getIconUrl } from "helpers/getIconUrl";
import { getCatalogContractId } from "helpers/tokenCatalog";
import { ThemeColors } from "hooks/useColors";
import "i18n";
import {
  getTokenDetails,
  fetchTokenCatalog,
  fetchSwapReceipt,
} from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

import {
  SWAPPER,
  XAUM_CONTRACT,
  lendingRepay,
  usdcToXaum,
  usdcToXaumMeta,
  xlmToUsdt0,
} from "../../../../../__mocks__/routerSwapHistory";
import {
  catalogXaum,
  catalogUsdc,
  seedCatalog,
} from "../../../../../__mocks__/tokenCatalog";

jest.mock("helpers/getIconUrl", () => ({
  getIconUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("services/backend", () => ({
  fetchSwapReceipt: jest.fn(),
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

const diffsSpy = jest.spyOn(assetBalanceChanges, "processAssetBalanceChanges");
const expectNoEnrichment = () => {
  expect(diffsSpy).not.toHaveBeenCalled();
  expect(fetchTokenCatalog).not.toHaveBeenCalled();
  expect(mockGetTokenDetails).not.toHaveBeenCalled();
  expect(mockFetchTransactionMeta).not.toHaveBeenCalled();
  expect(fetchSwapReceipt).not.toHaveBeenCalled();
  expect(getIconUrl).not.toHaveBeenCalled();
};

const networkDetails = mapNetworkToNetworkDetails(NETWORKS.PUBLIC);
const args = (operation: unknown) => ({
  operation,
  accountBalances: {},
  publicKey: SWAPPER,
  networkDetails,
  network: NETWORKS.PUBLIC,
  themeColors: {
    foreground: { primary: "#000000" },
  } as unknown as ThemeColors,
});
const map = (operation: unknown) => mapHistoryItemData(args(operation));

describe("mapHistoryItemData — router swaps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTokenCatalogInFlightForTests();
    seedCatalog(
      NETWORKS.PUBLIC,
      catalogUsdc,
      {
        id: getCatalogContractId(
          "USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
          networkDetails.networkPassphrase,
        )!,
        code: "USDT0",
        name: "USDT0",
        decimals: 7,
        swappable: true,
      },
      catalogXaum({
        iconUrl: "https://media.xoxno.com/tokens/xaum/logo.png",
        swappable: true,
      }),
    );
    mockGetTokenDetails.mockResolvedValue(null);
    mockFetchTransactionMeta.mockResolvedValue(null);
  });

  it("renders sent amount and cached pair immediately; received amount waits for modal receipt", async () => {
    const instant = mapInstantXoxnoHistoryItem(args(xlmToUsdt0));
    expect(instant).not.toBeInstanceOf(Promise);
    expect(instant?.transactionDetails.transactionType).toBe(
      TransactionType.SWAP,
    );
    expect(instant?.rowText).toBe("XLM to USDT0");
    expect(instant?.actionText).toBe("Swapped");
    expect(instant?.amountText).toBe("-10.00 XLM");
    expect(instant?.isAddingFunds).toBe(false);
    expect(instant?.transactionDetails.swapDetails).toMatchObject({
      sourceTokenCode: "XLM",
      sourceAmount: "10",
      destinationTokenCode: "USDT0",
      destinationAmount: "",
    });
    expect(instant?.transactionDetails.assetDiffs).toEqual([]);
    expect(instant?.transactionDetails.xoxnoReceipt).toMatchObject({
      transactionHash: xlmToUsdt0.transaction_hash,
      viewer: SWAPPER,
      operationIndex: 0,
    });
    expect((await map(xlmToUsdt0)).rowText).toBe(instant?.rowText);
    expectNoEnrichment();
  });

  it("uses cached Soroban metadata without fetching transaction events or receipts", async () => {
    mockFetchTransactionMeta.mockResolvedValue(usdcToXaumMeta);
    const item = await map(usdcToXaum);
    expect(item.transactionDetails.transactionType).toBe(TransactionType.SWAP);
    expect(item.rowText).toBe("USDC to XAUM");
    expect(item.amountText).toBe("-6.7546053 USDC");
    expect(item.isAddingFunds).toBe(false);
    expect(item.transactionDetails.swapDetails).toMatchObject({
      sourceTokenCode: "USDC",
      sourceAmount: "6.7546053",
      destinationTokenCode: "XAUM",
      destinationAmount: "",
    });
    expect(item.transactionDetails.xoxnoReceipt).toMatchObject({
      tokenOut: XAUM_CONTRACT,
      destinationDecimals: 9,
    });
    expectNoEnrichment();
  });

  it("keeps unknown contract IDs and explicit base units without per-row token lookup", async () => {
    seedCatalog(NETWORKS.PUBLIC);
    const item = await map(usdcToXaum);
    expect(item.transactionDetails.transactionType).toBe(TransactionType.SWAP);
    expect(item.rowText).toBe(`${catalogUsdc.id} to ${XAUM_CONTRACT}`);
    expect(item.amountText).toBe(`-67546053 base units ${catalogUsdc.id}`);
    expect(item.isAddingFunds).toBe(false);
    expect(item.transactionDetails.swapDetails?.destinationAmount).toBe("");
    expect(
      item.transactionDetails.xoxnoReceipt?.sourceDecimals,
    ).toBeUndefined();
    expect(
      item.transactionDetails.xoxnoReceipt?.destinationDecimals,
    ).toBeUndefined();
    expect(item.transactionDetails.assetDiffs).toEqual([]);
    expectNoEnrichment();
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
