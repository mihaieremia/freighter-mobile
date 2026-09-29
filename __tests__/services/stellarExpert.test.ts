/* eslint-disable no-underscore-dangle */
import { NETWORKS } from "config/constants";
import {
  fetchTrendingAssets,
  fetchTransactionMeta,
} from "services/stellarExpert";

// Override the global jest.setup.js mock so we test the real implementation
// with only the underlying API calls intercepted.
jest.mock("services/stellarExpert", () =>
  jest.requireActual("services/stellarExpert"),
);

jest.mock("services/apiFactory", () => {
  const get = jest.fn();
  return {
    createApiService: jest.fn(() => ({ get })),
    isRequestCanceled: jest.fn(() => false),
    logApiError: jest.fn(),
    __get: get, // expose for assertions
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, global-require
const apiFactory = require("services/apiFactory");

describe("stellarExpert service", () => {
  beforeEach(() => {
    apiFactory.__get.mockReset();
  });

  describe("fetchTrendingAssets", () => {
    it("calls /asset with sort=volume7d, order=desc, limit=50", async () => {
      apiFactory.__get.mockResolvedValue({
        data: { _embedded: { records: [] }, _links: {} },
      });

      await fetchTrendingAssets({ network: NETWORKS.PUBLIC });

      expect(apiFactory.__get).toHaveBeenCalledWith("/asset", {
        params: { sort: "volume7d", order: "desc", limit: 50 },
        signal: undefined,
      });
    });

    it("returns null and logs on network error", async () => {
      apiFactory.__get.mockRejectedValue(new Error("network down"));

      const result = await fetchTrendingAssets({ network: NETWORKS.PUBLIC });

      expect(result).toBeNull();
      expect(apiFactory.logApiError).toHaveBeenCalled();
    });

    it("propagates AbortSignal to apiFactory", async () => {
      const controller = new AbortController();
      apiFactory.__get.mockResolvedValue({
        data: { _embedded: { records: [] }, _links: {} },
      });

      await fetchTrendingAssets({
        network: NETWORKS.PUBLIC,
        signal: controller.signal,
      });

      expect(apiFactory.__get).toHaveBeenCalledWith(
        "/asset",
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe("fetchTransactionMeta", () => {
    it("hands the retry setting to the request and returns the meta", async () => {
      apiFactory.__get.mockResolvedValue({ data: { meta: "AAAA" } });
      const retry = { retries: 2, initialDelay: 3000 };

      const meta = await fetchTransactionMeta("abc", NETWORKS.PUBLIC, retry);

      expect(meta).toBe("AAAA");
      expect(apiFactory.__get).toHaveBeenCalledWith(
        "/tx/abc",
        expect.objectContaining({ retry }),
      );
    });

    it("returns null when the request keeps failing", async () => {
      apiFactory.__get.mockRejectedValue(new Error("404"));

      expect(await fetchTransactionMeta("abc", NETWORKS.PUBLIC)).toBeNull();
    });
  });
});
