/* eslint-disable @fnando/consistent-import/consistent-import */
import { renderHook } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { NETWORKS } from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { useBalancesStore } from "ducks/balances";
import { useTokenCatalogStore } from "ducks/tokenCatalog";

import {
  CATALOG_SOROBAN_CONTRACT,
  catalogSoroban,
  seedCatalog,
} from "../../__mocks__/tokenCatalog";

const { useBalancesList } = jest.requireActual<
  typeof import("hooks/useBalancesList")
>("hooks/useBalancesList");

const XAUM_ID = `XAUM:${CATALOG_SOROBAN_CONTRACT}`;

const xaumBalance = (currentPrice?: BigNumber) => ({
  token: {
    code: "XAUM",
    issuer: { key: CATALOG_SOROBAN_CONTRACT },
    type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
  },
  total: new BigNumber("0.5"),
  currentPrice,
});

const hold = (balance: ReturnType<typeof xaumBalance>) =>
  useBalancesStore.setState({
    pricedBalances: { [XAUM_ID]: balance },
  } as never);

const renderList = (network: NETWORKS) =>
  renderHook(() => useBalancesList({ publicKey: "G", network })).result.current
    .balanceItems[0];

describe("useBalancesList — catalog prices", () => {
  beforeEach(() => {
    useTokenCatalogStore.setState({ byNetwork: {} });
  });

  it("prices a held token the balances left unpriced from the catalog", () => {
    hold(xaumBalance());
    seedCatalog(NETWORKS.PUBLIC, catalogSoroban);

    const item = renderList(NETWORKS.PUBLIC);

    expect(item.currentPrice?.toString()).toBe("4200");
    expect(item.fiatTotal?.toString()).toBe("2100");
  });

  it("leaves it unpriced off mainnet", () => {
    hold(xaumBalance());
    seedCatalog(NETWORKS.TESTNET, catalogSoroban);

    expect(renderList(NETWORKS.TESTNET).currentPrice).toBeUndefined();
  });
});
