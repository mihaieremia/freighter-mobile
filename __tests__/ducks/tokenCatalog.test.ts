/* eslint-disable @fnando/consistent-import/consistent-import */
import { NETWORKS } from "config/constants";
import { logger } from "config/logger";
import {
  TOKEN_CATALOG_TTL_MS,
  resetTokenCatalogInFlightForTests,
  useTokenCatalogStore,
} from "ducks/tokenCatalog";
import { fetchTokenCatalog } from "services/backend";

import { catalogSoroban, catalogUsdc } from "../../__mocks__/tokenCatalog";

jest.mock("services/backend", () => ({
  fetchTokenCatalog: jest.fn(),
}));

jest.mock("config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockFetch = fetchTokenCatalog as jest.MockedFunction<
  typeof fetchTokenCatalog
>;

describe("tokenCatalog duck", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    jest.clearAllMocks();
    resetTokenCatalogInFlightForTests();
    useTokenCatalogStore.setState({ byNetwork: {} });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stores the catalog by contract id", async () => {
    mockFetch.mockResolvedValue([catalogUsdc, catalogSoroban]);

    await useTokenCatalogStore.getState().fetchCatalog(NETWORKS.PUBLIC);

    const stored = useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC];
    expect(stored?.byContractId[catalogUsdc.id]).toEqual(catalogUsdc);
    expect(stored?.byContractId[catalogSoroban.id]).toEqual(catalogSoroban);
    expect(stored?.fetchedAt).toBe(Date.now());
    expect(mockFetch).toHaveBeenCalledWith(NETWORKS.PUBLIC);
  });

  it("shares one request between calls made while it runs", async () => {
    let resolve: (value: (typeof catalogUsdc)[]) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const { fetchCatalog } = useTokenCatalogStore.getState();
    const first = fetchCatalog(NETWORKS.PUBLIC);
    const second = fetchCatalog(NETWORKS.PUBLIC);
    resolve([catalogUsdc]);
    await Promise.all([first, second]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh catalog and refetches after the TTL", async () => {
    mockFetch.mockResolvedValue([catalogUsdc]);
    const { fetchCatalog } = useTokenCatalogStore.getState();

    await fetchCatalog(NETWORKS.PUBLIC);
    jest.advanceTimersByTime(TOKEN_CATALOG_TTL_MS - 1);
    await fetchCatalog(NETWORKS.PUBLIC);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await fetchCatalog(NETWORKS.PUBLIC);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous data when a refetch fails, and warns on a connectivity failure", async () => {
    mockFetch.mockResolvedValueOnce([catalogUsdc]);
    const { fetchCatalog } = useTokenCatalogStore.getState();
    await fetchCatalog(NETWORKS.PUBLIC);
    const before = useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC];

    jest.advanceTimersByTime(TOKEN_CATALOG_TTL_MS);
    mockFetch.mockRejectedValueOnce({
      message: "Network Error",
      status: 0,
      isNetworkError: true,
    });
    await expect(fetchCatalog(NETWORKS.PUBLIC)).resolves.toBeUndefined();

    expect(useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC]).toBe(
      before,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs an error on a backend failure and allows an immediate retry", async () => {
    mockFetch.mockRejectedValueOnce({
      message: "boom",
      status: 500,
      isNetworkError: false,
    });
    const { fetchCatalog } = useTokenCatalogStore.getState();

    await fetchCatalog(NETWORKS.PUBLIC);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC]).toBe(
      undefined,
    );

    mockFetch.mockResolvedValueOnce([catalogUsdc]);
    await fetchCatalog(NETWORKS.PUBLIC);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC],
    ).toBeDefined();
  });

  it("rejects a response that is not a list without storing it", async () => {
    mockFetch.mockResolvedValueOnce(undefined as never);

    await useTokenCatalogStore.getState().fetchCatalog(NETWORKS.PUBLIC);

    expect(useTokenCatalogStore.getState().byNetwork[NETWORKS.PUBLIC]).toBe(
      undefined,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("keeps one catalog per network", async () => {
    mockFetch.mockImplementation((network) =>
      Promise.resolve(
        network === NETWORKS.PUBLIC ? [catalogUsdc] : [catalogSoroban],
      ),
    );
    const { fetchCatalog } = useTokenCatalogStore.getState();

    await Promise.all([
      fetchCatalog(NETWORKS.PUBLIC),
      fetchCatalog(NETWORKS.TESTNET),
    ]);

    const { byNetwork } = useTokenCatalogStore.getState();
    expect(Object.keys(byNetwork[NETWORKS.PUBLIC]?.byContractId ?? {})).toEqual(
      [catalogUsdc.id],
    );
    expect(
      Object.keys(byNetwork[NETWORKS.TESTNET]?.byContractId ?? {}),
    ).toEqual([catalogSoroban.id]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
