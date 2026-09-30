/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  Account,
  Horizon,
  Operation,
  TransactionBuilder,
  Transaction,
} from "@stellar/stellar-sdk";
import {
  mapHistoryItemData,
  mapInstantXoxnoHistoryItem,
} from "components/screens/HistoryScreen/mappers";
import {
  NETWORKS,
  PUBLIC_NETWORK_DETAILS,
  TESTNET_NETWORK_DETAILS,
} from "config/constants";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import {
  getHistoryOperationIndex,
  toXoxnoSwapOperation,
} from "helpers/aggregatorSwapHistory";
import { processAssetBalanceChanges } from "helpers/assetBalanceChanges";
import { getIconUrl } from "helpers/getIconUrl";
import { ThemeColors } from "hooks/useColors";
import { getTokenDetails } from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

import {
  SWAPPER,
  OTHER_ACCOUNT,
  XAUM_CONTRACT,
  POOL_TOKEN_IN,
  POOL_TOKEN_OUT,
  sorobanToSoroban,
  usdcToXaum,
  xlmToUsdt0,
  lendingRepay,
} from "../../__mocks__/routerSwapHistory";
import { catalogXaum, seedCatalog } from "../../__mocks__/tokenCatalog";

jest.mock("services/backend", () => ({
  fetchTokenCatalog: jest.fn(),
  getTokenDetails: jest.fn(),
}));
jest.mock("helpers/assetBalanceChanges", () => ({
  processAssetBalanceChanges: jest.fn(),
}));
jest.mock("helpers/getIconUrl", () => ({ getIconUrl: jest.fn() }));
const swapOf = (
  operation: Horizon.ServerApi.OperationRecord,
  publicKey = SWAPPER,
) =>
  toXoxnoSwapOperation({
    operation,
    publicKey,
    networkDetails: PUBLIC_NETWORK_DETAILS,
    accountBalances: {},
  });
beforeEach(() => {
  jest.clearAllMocks();
  seedCatalog(NETWORKS.PUBLIC);
});

it("decodes cached source/pair synchronously without any per-row enrichment", () => {
  seedCatalog(NETWORKS.PUBLIC, catalogXaum());
  const fetchCatalog = jest.spyOn(
    useTokenCatalogStore.getState(),
    "fetchCatalog",
  );
  const result = swapOf(usdcToXaum);
  expect(result).not.toBeInstanceOf(Promise);
  expect(result).toMatchObject({
    amount: "",
    asset_code: "XAUM",
    xoxnoReceipt: {
      operationIndex: 0,
      tokenOut: XAUM_CONTRACT,
      destinationDecimals: 9,
    },
  });
  expect(fetchCatalog).not.toHaveBeenCalled();
  expect(getTokenDetails).not.toHaveBeenCalled();
  expect(getIconUrl).not.toHaveBeenCalled();
  expect(fetchTransactionMeta).not.toHaveBeenCalled();
  fetchCatalog.mockRestore();
});

it("keeps unlisted contracts and raw input atoms instead of guessing seven decimals", () => {
  const result = swapOf(sorobanToSoroban);
  expect(result).toMatchObject({
    source_asset_code: POOL_TOKEN_IN,
    asset_code: POOL_TOKEN_OUT,
    source_amount: "1729274",
    amount: "",
    xoxnoReceipt: { sourceDecimals: undefined, destinationDecimals: undefined },
  });
});

it("uses exact catalog decimals and envelope input", () => {
  seedCatalog(NETWORKS.PUBLIC, {
    id: POOL_TOKEN_IN,
    code: "POOL",
    name: "Pool",
    decimals: 9,
    swappable: false,
  });
  expect(swapOf(sorobanToSoroban)).toMatchObject({
    source_amount: "0.001729274",
    source_asset_code: "POOL",
  });
});

it("rejects another viewer/router/network and failed transactions", () => {
  expect(swapOf(xlmToUsdt0, OTHER_ACCOUNT)).toBeNull();
  expect(swapOf(lendingRepay)).toBeNull();
  expect(
    swapOf({
      ...xlmToUsdt0,
      transaction_successful: false,
    } as unknown as Horizon.ServerApi.OperationRecord),
  ).toBeNull();
  expect(
    toXoxnoSwapOperation({
      operation: xlmToUsdt0,
      publicKey: SWAPPER,
      networkDetails: TESTNET_NETWORK_DETAILS,
      accountBalances: {},
    }),
  ).toBeNull();
});

it("decodes large TOID strings with BigInt, explicit zero-based indexes, and sole-op fallback", () => {
  const operation = {
    ...xlmToUsdt0,
    id: (90000000n * 4294967296n + 4n * 4096n + 3n).toString(),
  } as unknown as Horizon.ServerApi.OperationRecord;
  expect(
    getHistoryOperationIndex(
      operation,
      PUBLIC_NETWORK_DETAILS.networkPassphrase,
    ),
  ).toBe(2);
  expect(
    getHistoryOperationIndex(
      {
        ...operation,
        operation_index: 1,
      } as unknown as Horizon.ServerApi.OperationRecord,
      PUBLIC_NETWORK_DETAILS.networkPassphrase,
    ),
  ).toBe(1);
  expect(
    getHistoryOperationIndex(
      {
        ...xlmToUsdt0,
        id: "unknown",
      } as unknown as Horizon.ServerApi.OperationRecord,
      PUBLIC_NETWORK_DETAILS.networkPassphrase,
    ),
  ).toBe(0);
});

it("never guesses operation zero in a multi-operation envelope", () => {
  const tx = TransactionBuilder.fromXDR(
    (
      xlmToUsdt0 as Horizon.ServerApi.OperationRecord & {
        transaction_attr: { envelope_xdr: string };
      }
    ).transaction_attr.envelope_xdr,
    PUBLIC_NETWORK_DETAILS.networkPassphrase,
  );
  if (!(tx instanceof Transaction))
    throw new Error("Expected inner transaction");
  const parsedEnvelope = tx.toEnvelope();
  if (parsedEnvelope.type !== "envelopeTypeTx")
    throw new Error("Expected v1 envelope");
  const envelope = new TransactionBuilder(new Account(SWAPPER, "1"), {
    fee: "100",
    networkPassphrase: PUBLIC_NETWORK_DETAILS.networkPassphrase,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "10" }))
    .addOperation(parsedEnvelope.v1.tx.operations[0])
    .setTimeout(0)
    .build()
    .toXDR();
  const operation = {
    ...xlmToUsdt0,
    id: "unknown",
    transaction_attr: {
      ...(
        xlmToUsdt0 as Horizon.ServerApi.OperationRecord & {
          transaction_attr: { envelope_xdr: string };
        }
      ).transaction_attr,
      envelope_xdr: envelope,
    },
  } as unknown as Horizon.ServerApi.OperationRecord;
  expect(swapOf(operation)).toBeNull();
  expect(
    swapOf({
      ...operation,
      operation_index: 1,
    } as unknown as Horizon.ServerApi.OperationRecord),
  ).toMatchObject({ xoxnoReceipt: { operationIndex: 1 } });
  expect(
    swapOf({
      ...operation,
      operation_index: 0,
    } as unknown as Horizon.ServerApi.OperationRecord),
  ).toBeNull();
});

it("selects the same inner operation in a fee-bump envelope", () => {
  const transaction = TransactionBuilder.fromXDR(
    (
      xlmToUsdt0 as Horizon.ServerApi.OperationRecord & {
        transaction_attr: { envelope_xdr: string };
      }
    ).transaction_attr.envelope_xdr,
    PUBLIC_NETWORK_DETAILS.networkPassphrase,
  );
  if (!(transaction instanceof Transaction))
    throw new Error("Expected transaction");
  const envelopeXdr = TransactionBuilder.buildFeeBumpTransaction(
    SWAPPER,
    "100",
    transaction,
    PUBLIC_NETWORK_DETAILS.networkPassphrase,
  ).toXDR();
  const operation = {
    ...xlmToUsdt0,
    transaction_attr: { envelope_xdr: envelopeXdr },
  } as unknown as Horizon.ServerApi.OperationRecord;
  expect(swapOf(operation)).toMatchObject({
    source_amount: "10",
    source_asset_code: "XLM",
    xoxnoReceipt: { operationIndex: 0 },
  });
});

it("recognizes XOXNO before generic async asset diffs or icon mapping", async () => {
  const args = {
    operation: xlmToUsdt0,
    accountBalances: {},
    publicKey: SWAPPER,
    networkDetails: PUBLIC_NETWORK_DETAILS,
    network: NETWORKS.PUBLIC,
    themeColors: { foreground: { primary: "black" } } as ThemeColors,
  };
  const instant = mapInstantXoxnoHistoryItem(args);
  expect(instant).not.toBeNull();
  expect(instant).not.toBeInstanceOf(Promise);
  expect(
    (await mapHistoryItemData(args)).transactionDetails.xoxnoReceipt
      ?.operationIndex,
  ).toBe(0);
  expect(processAssetBalanceChanges).not.toHaveBeenCalled();
  expect(getIconUrl).not.toHaveBeenCalled();
  expect(getTokenDetails).not.toHaveBeenCalled();
  expect(fetchTransactionMeta).not.toHaveBeenCalled();
});
