import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  TransactionDetails,
  TransactionStatus,
  TransactionType,
} from "components/screens/HistoryScreen/types";
import { NETWORKS } from "config/constants";
import { useHistorySwapReceipt } from "hooks/useHistorySwapReceipt";
import { fetchSwapReceipt, getTokenDetails } from "services/backend";

jest.mock("services/backend", () => ({
  fetchSwapReceipt: jest.fn(),
  getTokenDetails: jest.fn(),
}));
const fetchReceipt = fetchSwapReceipt as jest.MockedFunction<
  typeof fetchSwapReceipt
>;
const tokenDetails = getTokenDetails as jest.MockedFunction<
  typeof getTokenDetails
>;
let transaction = 0;
const details = (overrides = {}): TransactionDetails =>
  ({
    transactionType: TransactionType.SWAP,
    status: TransactionStatus.SUCCESS,
    swapReceipt: {
      network: NETWORKS.PUBLIC,
      transactionHash: `receipt-test-${++transaction}`,
      viewer: "viewer",
      operationIndex: 1,
      tokenIn: "input",
      tokenOut: "output",
      sourceAtoms: "123456789012345678901234567",
      sourceDecimals: 9,
      destinationDecimals: 9,
      ...overrides,
    },
    swapDetails: {
      sourceTokenCode: "IN",
      destinationTokenCode: "OUT",
      sourceTokenIssuer: "input",
      destinationTokenIssuer: "output",
      sourceTokenType: "custom_token",
      destinationTokenType: "custom_token",
      sourceAmount: "123456789012345678.901234567",
      destinationAmount: "",
    },
  }) as TransactionDetails;
const confirmed = (item: TransactionDetails) => ({
  ...item.swapReceipt!,
  status: "confirmed" as const,
  receivedAtoms: "123456789012345678901234567",
});

beforeEach(() => {
  jest.clearAllMocks();
  tokenDetails.mockResolvedValue(null);
});

it("makes no request until an item opens; confirms exact atoms and delegates receipt loading to the shared client", async () => {
  const item = details();
  fetchReceipt.mockResolvedValue(confirmed(item));
  const { result, rerender } = renderHook(
    ({ item: selected }: { item: TransactionDetails | null }) =>
      useHistorySwapReceipt(selected, NETWORKS.PUBLIC, "viewer"),
    { initialProps: { item: null } },
  );
  expect(fetchReceipt).not.toHaveBeenCalled();
  rerender({ item });
  expect(result.current.details).toBe(item);
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("confirmed"));
  expect(result.current.details?.swapDetails?.destinationAmount).toBe(
    "123456789012345678.901234567",
  );
  expect(fetchReceipt).toHaveBeenCalledTimes(1);
});

it("keeps success when unavailable, retries only on demand, and never renders zero", async () => {
  const item = details();
  fetchReceipt.mockResolvedValue({
    ...item.swapReceipt!,
    status: "unavailable",
  });
  const { result, rerender } = renderHook(() =>
    useHistorySwapReceipt(item, NETWORKS.PUBLIC, "viewer"),
  );
  await waitFor(() => expect(result.current.status).toBe("unavailable"));
  rerender({});
  expect(fetchReceipt).toHaveBeenCalledTimes(1);
  expect(result.current.details?.status).toBe(TransactionStatus.SUCCESS);
  expect(result.current.details?.swapDetails?.destinationAmount).toBe("");
  fetchReceipt.mockResolvedValue(confirmed(item));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe("confirmed"));
  expect(fetchReceipt).toHaveBeenCalledTimes(2);
});

it.each(["close", "viewer", "network", "item"])(
  "aborts and ignores late receipt after %s changes",
  async (change) => {
    const item = details();
    let resolve!: (value: ReturnType<typeof confirmed>) => void;
    fetchReceipt.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fetchReceipt.mockResolvedValue({
      ...item.swapReceipt!,
      status: "unavailable",
    });
    const initial = {
      item: item as TransactionDetails | null,
      viewer: "viewer",
      network: NETWORKS.PUBLIC,
    };
    const { result, rerender } = renderHook(
      (props: typeof initial) =>
        useHistorySwapReceipt(props.item, props.network, props.viewer),
      { initialProps: initial },
    );
    const signal = fetchReceipt.mock.calls[0][2]!;
    const next = { ...initial };
    if (change === "close") next.item = null;
    if (change === "viewer") next.viewer = "other";
    if (change === "network") next.network = NETWORKS.TESTNET;
    if (change === "item") next.item = details();
    rerender(next);
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(confirmed(item));
      await Promise.resolve();
    });
    expect(result.current.details?.swapDetails?.destinationAmount ?? "").toBe(
      "",
    );
  },
);

it("keeps unknown decimal amounts as atoms; metadata is attempted only in the modal", async () => {
  const item = details({
    sourceDecimals: undefined,
    destinationDecimals: undefined,
  });
  fetchReceipt.mockResolvedValue(confirmed(item));
  const { result } = renderHook(() =>
    useHistorySwapReceipt(item, NETWORKS.PUBLIC, "viewer"),
  );
  await waitFor(() => expect(result.current.status).toBe("confirmed"));
  expect(
    result.current.details?.swapReceipt?.destinationDecimals,
  ).toBeUndefined();
  expect(result.current.details?.swapDetails?.destinationAmount).toBe(
    "123456789012345678901234567",
  );
  expect(tokenDetails).toHaveBeenCalledTimes(2);
});

it("publishes confirmed atoms before optional metadata resolves, then scales exactly", async () => {
  const item = details({ destinationDecimals: undefined });
  let resolveMetadata!: (value: {
    name: string;
    symbol: string;
    decimals: number;
  }) => void;
  tokenDetails.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolveMetadata = done;
      }),
  );
  fetchReceipt.mockResolvedValue(confirmed(item));
  const { result } = renderHook(() =>
    useHistorySwapReceipt(item, NETWORKS.PUBLIC, "viewer"),
  );
  await waitFor(() => expect(result.current.status).toBe("confirmed"));
  expect(result.current.details?.swapDetails?.destinationAmount).toBe(
    "123456789012345678901234567",
  );
  await act(async () => {
    resolveMetadata({ name: "Output", symbol: "OUT", decimals: 9 });
    await Promise.resolve();
  });
  expect(result.current.details?.swapDetails?.destinationAmount).toBe(
    "123456789012345678.901234567",
  );
});
