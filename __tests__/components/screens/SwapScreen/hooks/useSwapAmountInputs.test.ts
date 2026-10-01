/* eslint-disable @fnando/consistent-import/consistent-import */
import { act, renderHook } from "@testing-library/react-native";
import BigNumber from "bignumber.js";
import { useSwapAmountInputs } from "components/screens/SwapScreen/hooks/useSwapAmountInputs";
import { NETWORKS } from "config/constants";
import { PricedBalance, TokenTypeWithCustomToken } from "config/types";
import { useAuthenticationStore } from "ducks/auth";
import { useSwapStore } from "ducks/swap";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { useTokenFiatConverter } from "hooks/useTokenFiatConverter";

import {
  CONTRACT,
  soroban,
  usdc as baseUsdc,
  xlm as baseXlm,
} from "../../../../../__mocks__/swapFixtures";
import {
  catalogSoroban,
  catalogUnpriced,
  seedCatalog,
} from "../../../../../__mocks__/tokenCatalog";

type Args = Parameters<typeof useSwapAmountInputs>[0];

const xlm = { ...baseXlm, currentPrice: new BigNumber(0.23) } as PricedBalance;
const usdc = { ...baseUsdc, currentPrice: new BigNumber(1) } as PricedBalance;

const renderInputs = (overrides: Partial<Args> = {}) =>
  renderHook(() => {
    const sell = useTokenFiatConverter({ selectedBalance: xlm });
    const inputs = useSwapAmountInputs({
      sellConverter: sell,
      sourceBalance: xlm,
      destinationForPath: usdc,
      destinationBalance: usdc,
      destinationTokenDescriptor: null,
      prices: {},
      ...overrides,
    });

    return { sell, ...inputs };
  });

const store = () => useSwapStore.getState();

describe("useSwapAmountInputs", () => {
  beforeEach(() => {
    act(() => store().resetSwap());
  });

  it("feeds the store from the sell card and shows the quote's amount in the receive card", () => {
    const { result } = renderInputs();

    act(() => result.current.sellCardConverter.setDisplayAmountFromText("10"));

    expect(store().inputSide).toBe("source");
    expect(store().sourceAmount).toBe("10");

    act(() => useSwapStore.setState({ destinationAmount: "2.3" }));

    expect(result.current.receiveCardConverter.tokenAmount).toBe("2.3");
    expect(store().sourceAmount).toBe("10");
  });

  it("makes the receive card the input side when the user types in it", () => {
    const { result } = renderInputs();

    act(() =>
      result.current.receiveCardConverter.setDisplayAmountFromText("2.3"),
    );

    expect(store().inputSide).toBe("destination");
    expect(store().destinationInputAmount).toBe("2.3");
  });

  it("shows the derived amount to sell in the sell card without feeding it back", () => {
    const { result } = renderInputs();
    act(() =>
      result.current.receiveCardConverter.setDisplayAmountFromText("2.3"),
    );

    act(() => useSwapStore.setState({ sourceAmount: "10.0489927" }));

    expect(result.current.sell.tokenAmount).toBe("10.0489927");
    expect(store().sourceAmount).toBe("10.0489927");
    expect(store().inputSide).toBe("destination");
  });

  it("does not overwrite the amount being typed when the quote answers", () => {
    const { result } = renderInputs();
    act(() =>
      result.current.receiveCardConverter.setDisplayAmountFromText("2.3"),
    );

    act(() => useSwapStore.setState({ destinationAmount: "2.3027190" }));

    expect(result.current.receiveCardConverter.tokenAmount).toBe("2.3");
    expect(store().destinationInputAmount).toBe("2.3");
  });

  it("switches back to the sell side when the user types there", () => {
    const { result } = renderInputs();
    act(() =>
      result.current.receiveCardConverter.setDisplayAmountFromText("2.3"),
    );

    act(() => result.current.sellCardConverter.setDisplayAmountFromText("5"));

    expect(store().inputSide).toBe("source");
    expect(store().sourceAmount).toBe("5");
  });

  it("makes the sell card the input side when the amount to sell is set from code", () => {
    const { result } = renderInputs();
    act(() =>
      result.current.receiveCardConverter.setDisplayAmountFromText("2.3"),
    );

    act(() => result.current.setSellTokenAmount("7.5"));

    expect(store().inputSide).toBe("source");
    expect(store().sourceAmount).toBe("7.5");
  });

  it("keeps the fiat field of a card in fiat mode in step with the derived amount", () => {
    const { result } = renderInputs();
    act(() => result.current.receiveCardConverter.setShowFiatAmount(true));

    act(() => useSwapStore.setState({ destinationAmount: "2.3" }));

    expect(result.current.receiveCardConverter.fiatAmountDisplay).toBe("2.30");
  });

  it("prices a destination the prices store does not know from the picker's price", () => {
    const { result } = renderInputs({
      destinationForPath: soroban(18),
      destinationBalance: undefined,
      destinationTokenDescriptor: {
        id: `deJTRSY:${CONTRACT}`,
        tokenCode: "deJTRSY",
        issuer: CONTRACT,
        decimals: 18,
        tokenType: TokenTypeWithCustomToken.CUSTOM_TOKEN,
        requiresTrustline: false,
        priceUsd: 1.02,
      },
    });

    expect(result.current.hasReceivePrice).toBe(true);
  });

  it("has no price for a destination nothing prices", () => {
    const { result } = renderInputs({
      destinationForPath: undefined,
      destinationBalance: undefined,
    });

    expect(result.current.hasReceivePrice).toBe(false);
  });

  describe("a destination only the XOXNO catalog prices", () => {
    const xaumDescriptor = (priceUsd?: number) => ({
      id: `XAUM:${CONTRACT}`,
      tokenCode: "XAUM",
      issuer: CONTRACT,
      decimals: 9,
      tokenType: TokenTypeWithCustomToken.CUSTOM_TOKEN,
      requiresTrustline: false,
      priceUsd,
    });

    const renderXaum = (overrides: Partial<Args> = {}) =>
      renderInputs({
        destinationForPath: soroban(9),
        destinationBalance: undefined,
        destinationTokenDescriptor: xaumDescriptor(),
        ...overrides,
      });

    beforeEach(() => {
      useAuthenticationStore.setState({ network: NETWORKS.PUBLIC });
      useTokenCatalogStore.setState({ byNetwork: {} });
    });

    it("has a receive price from the catalog", () => {
      seedCatalog(NETWORKS.PUBLIC, catalogSoroban);

      const { result } = renderXaum();

      expect(result.current.hasReceivePrice).toBe(true);
    });

    it("shows the fiat value of a typed 9-decimal receive amount", () => {
      seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
      const { result } = renderXaum();

      act(() =>
        result.current.receiveCardConverter.setDisplayAmountFromText(
          "0.123456789",
        ),
      );

      expect(result.current.receiveCardConverter.fiatAmount).toBe("518.52");
      expect(store().destinationInputAmount).toBe("0.123456789");
    });

    it("prefers the price the prices store has", () => {
      seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
      const { result } = renderXaum({
        prices: { [`XAUM:${CONTRACT}`]: { currentPrice: new BigNumber(1) } },
      });

      act(() =>
        result.current.receiveCardConverter.setDisplayAmountFromText("2"),
      );

      expect(result.current.receiveCardConverter.fiatAmount).toBe("2.00");
    });

    it("prefers the picker's price over the catalog's", () => {
      seedCatalog(NETWORKS.PUBLIC, catalogSoroban);
      const { result } = renderXaum({
        destinationTokenDescriptor: xaumDescriptor(4000),
      });

      act(() =>
        result.current.receiveCardConverter.setDisplayAmountFromText("2"),
      );

      expect(result.current.receiveCardConverter.fiatAmount).toBe("8000.00");
    });

    it.each([
      ["lists it at zero", NETWORKS.PUBLIC, NETWORKS.PUBLIC, catalogUnpriced],
      ["does not list it", NETWORKS.PUBLIC, NETWORKS.PUBLIC, undefined],
      [
        "lists it off mainnet",
        NETWORKS.TESTNET,
        NETWORKS.TESTNET,
        catalogSoroban,
      ],
    ])(
      "has no receive price when the catalog %s",
      (_title, walletNetwork, catalogNetwork, entry) => {
        useAuthenticationStore.setState({ network: walletNetwork });
        seedCatalog(catalogNetwork, ...(entry ? [entry] : []));

        const { result } = renderXaum();

        expect(result.current.hasReceivePrice).toBe(false);
      },
    );
  });
});
