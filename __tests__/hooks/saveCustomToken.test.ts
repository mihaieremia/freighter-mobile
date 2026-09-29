/* eslint-disable @fnando/consistent-import/consistent-import */
import { NETWORKS, STORAGE_KEYS } from "config/constants";
import { saveCustomToken } from "services/customTokenStorage";

import { CONTRACT, SENDER } from "../../__mocks__/swapFixtures";

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock("services/storage/storageFactory", () => ({
  dataStorage: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
    remove: jest.fn(),
  },
}));

const token = {
  contractId: CONTRACT,
  symbol: "deJTRSY",
  name: "deJTRSY",
  decimals: 18,
};

const savedStorage = () =>
  JSON.parse(mockSetItem.mock.calls.at(-1)?.[1] ?? "{}");

describe("saveCustomToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
  });

  it("saves the token under the account and network", async () => {
    await saveCustomToken({
      publicKey: SENDER,
      network: NETWORKS.PUBLIC,
      token,
    });

    expect(mockSetItem).toHaveBeenCalledWith(
      STORAGE_KEYS.CUSTOM_TOKEN_LIST,
      expect.any(String),
    );
    expect(savedStorage()).toEqual({
      [SENDER]: { [NETWORKS.PUBLIC]: [token] },
    });
  });

  it("keeps the tokens already saved, for this account and for others", async () => {
    const other = {
      ...token,
      contractId: "CC64WBDGS6QQP22QTTIACYIXT3WF7BBQEYOQPLTP7GTKYY7PZ74QYGSL",
      symbol: "deJAAA",
    };
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        [SENDER]: {
          [NETWORKS.PUBLIC]: [other],
          [NETWORKS.TESTNET]: [other],
        },
        GOTHER: { [NETWORKS.PUBLIC]: [other] },
      }),
    );

    await saveCustomToken({
      publicKey: SENDER,
      network: NETWORKS.PUBLIC,
      token,
    });

    const storage = savedStorage();
    expect(storage[SENDER][NETWORKS.PUBLIC]).toEqual([other, token]);
    expect(storage[SENDER][NETWORKS.TESTNET]).toEqual([other]);
    expect(storage.GOTHER[NETWORKS.PUBLIC]).toEqual([other]);
  });

  it("does nothing for a token that is already saved", async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ [SENDER]: { [NETWORKS.PUBLIC]: [token] } }),
    );

    await saveCustomToken({
      publicKey: SENDER,
      network: NETWORKS.PUBLIC,
      token,
    });

    expect(mockSetItem).not.toHaveBeenCalled();
  });
});
