/* eslint-disable @fnando/consistent-import/consistent-import */
import { addBoughtTokenToBalances } from "components/screens/SwapScreen/helpers/swapInventory";
import { DestinationTokenDescriptor } from "components/screens/SwapScreen/helpers/types";
import { NETWORKS } from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";

import { CONTRACT, SENDER } from "../../../../../__mocks__/swapFixtures";

const mockSaveCustomToken = jest.fn();
const mockFetchAccountBalances = jest.fn();
let mockBalances: Record<string, unknown> = {};

jest.mock("services/customTokenStorage", () => ({
  saveCustomToken: (...args: unknown[]) => mockSaveCustomToken(...args),
}));
jest.mock("ducks/balances", () => ({
  useBalancesStore: {
    getState: () => ({
      balances: mockBalances,
      fetchAccountBalances: mockFetchAccountBalances,
    }),
  },
}));

const soroban: DestinationTokenDescriptor = {
  id: `deJTRSY:${CONTRACT}`,
  tokenCode: "deJTRSY",
  issuer: CONTRACT,
  decimals: 18,
  tokenType: TokenTypeWithCustomToken.CUSTOM_TOKEN,
  requiresTrustline: false,
};

const run = (token: DestinationTokenDescriptor | null) =>
  addBoughtTokenToBalances({
    token,
    publicKey: SENDER,
    network: NETWORKS.PUBLIC,
  });

describe("addBoughtTokenToBalances", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBalances = {};
  });

  it("saves a bought Soroban token and reloads the balances with it", async () => {
    await run(soroban);

    expect(mockSaveCustomToken).toHaveBeenCalledWith({
      publicKey: SENDER,
      network: NETWORKS.PUBLIC,
      token: {
        contractId: CONTRACT,
        symbol: "deJTRSY",
        name: "deJTRSY",
        decimals: 18,
      },
    });
    expect(mockFetchAccountBalances).toHaveBeenCalledWith({
      publicKey: SENDER,
      network: NETWORKS.PUBLIC,
      contractIds: [CONTRACT],
    });
  });

  it("leaves a token the user already holds alone", async () => {
    mockBalances = {
      [soroban.id]: {
        id: soroban.id,
        token: {
          type: "custom_token",
          code: "deJTRSY",
          issuer: { key: CONTRACT },
        },
      },
    };

    await run(soroban);

    expect(mockSaveCustomToken).not.toHaveBeenCalled();
    expect(mockFetchAccountBalances).not.toHaveBeenCalled();
  });

  it("does nothing for a classic or native destination, or none", async () => {
    await run({
      ...soroban,
      tokenType: TokenTypeWithCustomToken.CREDIT_ALPHANUM4,
    });
    await run({
      ...soroban,
      tokenType: TokenTypeWithCustomToken.NATIVE,
      issuer: undefined,
    });
    await run(null);

    expect(mockSaveCustomToken).not.toHaveBeenCalled();
  });

  it("does not throw when saving fails: the swap has already settled", async () => {
    mockSaveCustomToken.mockRejectedValueOnce(new Error("storage full"));

    await expect(run(soroban)).resolves.toBeUndefined();
    expect(mockFetchAccountBalances).not.toHaveBeenCalled();
  });
});
