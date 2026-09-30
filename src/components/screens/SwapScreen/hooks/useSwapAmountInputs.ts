import BigNumber from "bignumber.js";
import {
  DestinationTokenDescriptor,
  buildSellSecondaryText,
  resolveDestinationDisplayPrice,
  withDescriptorPrice,
} from "components/screens/SwapScreen/helpers";
import { PricedBalance, TokenPricesMap } from "config/types";
import { SwapInputSide, useSwapStore } from "ducks/swap";
import {
  UseTokenFiatConverterResult,
  useTokenFiatConverter,
} from "hooks/useTokenFiatConverter";
import { useWithCatalogPrices } from "hooks/useWithCatalogPrices";
import { useEffect, useMemo, useRef } from "react";

/**
 * Pushes an amount derived by the quote into a card's converter. In fiat mode the
 * converter shows its fiat field, which `setTokenAmount` does not refresh.
 */
const showDerivedAmount = (
  converter: UseTokenFiatConverterResult,
  price: BigNumber | null | undefined,
  amount: string,
) => {
  converter.setTokenAmount(amount);
  if (converter.showFiatAmount && price && !price.isZero()) {
    converter.updateFiatDisplay(new BigNumber(amount).times(price).toFixed(2));
  }
};

/**
 * Wraps a card's converter so that typing in it makes that card the input side.
 */
const asInputSide = (
  side: SwapInputSide,
  converter: UseTokenFiatConverterResult,
  setInputSide: (side: SwapInputSide) => void,
): UseTokenFiatConverterResult => ({
  ...converter,
  setDisplayAmountFromText: (text: string) => {
    setInputSide(side);
    converter.setDisplayAmountFromText(text);
  },
});

export interface UseSwapAmountInputsResult {
  /** The sell card's converter; typing in it makes the sell card the input side. */
  sellCardConverter: UseTokenFiatConverterResult;
  /** The receive card's converter; typing in it makes the receive card the input side. */
  receiveCardConverter: UseTokenFiatConverterResult;
  /** Sets the sell amount programmatically and makes the sell card the input side. */
  setSellTokenAmount: (amount: string) => void;
  /** Whether the destination has a non-zero price, so a fiat amount can be shown. */
  hasReceivePrice: boolean;
  /** The receive card's secondary line. */
  receiveSecondaryText: string;
}

/** The edited card drives the quote; the other mirrors it. Store amounts remain authoritative. */
export const useSwapAmountInputs = ({
  sellConverter,
  sourceBalance,
  destinationForPath,
  destinationBalance,
  destinationTokenDescriptor,
  prices,
}: {
  sellConverter: UseTokenFiatConverterResult;
  sourceBalance: PricedBalance | undefined;
  destinationForPath: PricedBalance | undefined;
  destinationBalance: PricedBalance | undefined;
  destinationTokenDescriptor: DestinationTokenDescriptor | null;
  prices: TokenPricesMap;
}): UseSwapAmountInputsResult => {
  const inputSide = useSwapStore((state) => state.inputSide);
  const sourceAmount = useSwapStore((state) => state.sourceAmount);
  const destinationAmount = useSwapStore((state) => state.destinationAmount);
  const setInputSide = useSwapStore((state) => state.setInputSide);
  const setSourceAmount = useSwapStore((state) => state.setSourceAmount);
  const setSourceAmountDisplay = useSwapStore(
    (state) => state.setSourceAmountDisplay,
  );
  const setDestinationInputAmount = useSwapStore(
    (state) => state.setDestinationInputAmount,
  );

  // A non-held destination has no balance to carry a price, so it comes from the
  // prices map, the same way the receive card's fiat line always has. A token none
  // of those price (a Soroban token the wallet's price source does not know) is
  // valued at the picker's price, then at the XOXNO catalog's.
  const pickerPrices = useMemo(
    () => withDescriptorPrice(prices, destinationTokenDescriptor),
    [prices, destinationTokenDescriptor],
  );
  const destinationPrices = useWithCatalogPrices(pickerPrices, [
    destinationTokenDescriptor?.id,
  ]);
  const destinationPrice = useMemo(
    () =>
      resolveDestinationDisplayPrice({
        balance: destinationBalance,
        prices: destinationPrices,
        descriptor: destinationTokenDescriptor,
      }),
    [destinationBalance, destinationTokenDescriptor, destinationPrices],
  );

  const receiveBalance = useMemo(
    () =>
      destinationForPath && {
        ...destinationForPath,
        currentPrice: destinationPrice,
      },
    [destinationForPath, destinationPrice],
  );
  const receiveConverter = useTokenFiatConverter({
    selectedBalance: receiveBalance as PricedBalance | undefined,
  });

  // The effects below read the latest converters without depending on them: their
  // identity changes on every keystroke, and a dependency on them would re-run the
  // mirror each time and undo what the user is typing.
  const current = {
    sellConverter,
    receiveConverter,
    sourcePrice: sourceBalance?.currentPrice,
    destinationPrice,
  };
  const latest = useRef(current);
  latest.current = current;

  // The card the user typed in feeds the store; the other one mirrors it.
  useEffect(() => {
    if (inputSide === SwapInputSide.SOURCE) {
      setSourceAmount(sellConverter.tokenAmount);
      setSourceAmountDisplay(sellConverter.tokenAmountDisplay);
    }
  }, [
    inputSide,
    sellConverter.tokenAmount,
    sellConverter.tokenAmountDisplay,
    setSourceAmount,
    setSourceAmountDisplay,
  ]);

  useEffect(() => {
    if (inputSide === SwapInputSide.DESTINATION) {
      setDestinationInputAmount(receiveConverter.tokenAmount);
    }
  }, [inputSide, receiveConverter.tokenAmount, setDestinationInputAmount]);

  useEffect(() => {
    if (inputSide === SwapInputSide.SOURCE) {
      showDerivedAmount(
        latest.current.receiveConverter,
        latest.current.destinationPrice,
        destinationAmount,
      );
    }
  }, [inputSide, destinationAmount]);

  useEffect(() => {
    if (inputSide === SwapInputSide.DESTINATION) {
      showDerivedAmount(
        latest.current.sellConverter,
        latest.current.sourcePrice,
        sourceAmount,
      );
    }
  }, [inputSide, sourceAmount]);

  const setSellTokenAmount = (amount: string) => {
    setInputSide(SwapInputSide.SOURCE);
    sellConverter.setTokenAmount(amount);
  };

  const hasReceivePrice = !!destinationPrice && !destinationPrice.isZero();
  const receiveSecondaryText = buildSellSecondaryText({
    showFiatAmount: receiveConverter.showFiatAmount,
    tokenAmount: receiveConverter.tokenAmount,
    sourceTokenSymbol: destinationTokenDescriptor?.tokenCode ?? "",
    fiatAmountDisplay: receiveConverter.fiatAmountDisplay,
  });

  return {
    sellCardConverter: asInputSide(
      SwapInputSide.SOURCE,
      sellConverter,
      setInputSide,
    ),
    receiveCardConverter: asInputSide(
      SwapInputSide.DESTINATION,
      receiveConverter,
      setInputSide,
    ),
    setSellTokenAmount,
    hasReceivePrice,
    receiveSecondaryText,
  };
};
