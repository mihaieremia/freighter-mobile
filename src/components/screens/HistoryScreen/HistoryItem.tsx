/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import Spinner from "components/Spinner";
import { HistoryItemProps } from "components/screens/HistoryScreen";
import {
  renderIconComponent,
  renderActionIcon,
} from "components/screens/HistoryScreen/helpers";
import {
  mapHistoryItemData,
  mapInstantXoxnoHistoryItem,
} from "components/screens/HistoryScreen/mappers";
import { Text } from "components/sds/Typography";
import { DEFAULT_PRESS_DELAY } from "config/constants";
import useColors from "hooks/useColors";
import React, { useEffect, useMemo, useState } from "react";
import { View, TouchableOpacity } from "react-native";

/**
 * Component to display a single transaction history item
 */
const HistoryItem: React.FC<HistoryItemProps> = ({
  accountBalances,
  operation,
  publicKey,
  networkDetails,
  handleTransactionDetails,
}) => {
  const { network } = networkDetails;
  const { themeColors } = useColors();
  const [isLoading, setIsLoading] = useState(true);
  const [historyItem, setHistoryItem] = useState<any>(null);

  const instantItem = useMemo(
    () =>
      mapInstantXoxnoHistoryItem({
        operation,
        accountBalances,
        publicKey,
        networkDetails,
        network,
        themeColors,
      }),
    [
      operation,
      accountBalances,
      publicKey,
      networkDetails,
      network,
      themeColors,
    ],
  );

  // Load history item data on component mount or when dependencies change
  useEffect(() => {
    if (instantItem) return undefined;
    let current = true;
    setIsLoading(true);
    setHistoryItem(null);
    const buildHistoryItem = async () => {
      try {
        const historyItemData = await mapHistoryItemData({
          operation,
          accountBalances,
          publicKey,
          networkDetails,
          network,
          themeColors,
        });

        if (!current) return;
        setHistoryItem(historyItemData);
        setIsLoading(false);
      } catch (error) {
        if (!current) return;
        setIsLoading(false);
      }
    };

    buildHistoryItem();
    return () => {
      current = false;
    };
  }, [
    instantItem,
    operation,
    accountBalances,
    publicKey,
    networkDetails,
    network,
    themeColors,
  ]);

  // Show loading spinner while data is being fetched
  if (!instantItem && isLoading) {
    return (
      <View className="flex-0 items-start py-2">
        <Spinner size="small" />
      </View>
    );
  }

  // Return null if no history item data was loaded
  const item = instantItem ?? historyItem;
  if (!item) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={() => {
        handleTransactionDetails(item.transactionDetails);
      }}
      delayPressIn={DEFAULT_PRESS_DELAY}
      className="mb-4 flex-row justify-between items-center flex-0"
    >
      <View className="flex-row items-center flex-1">
        {renderIconComponent({
          iconComponent: item.IconComponent,
          themeColors,
        })}
        <View className="ml-4 flex-1 mr-2">
          <Text md primary medium numberOfLines={1}>
            {item.rowText}
          </Text>
          <View className="flex-row items-center gap-1">
            {renderActionIcon({
              actionIcon: item.ActionIconComponent,
              themeColors,
            })}
            <Text sm secondary numberOfLines={1}>
              {item.actionText}
            </Text>
          </View>
        </View>
      </View>
      <View className="items-end justify-center">
        {item.amountText && (
          <Text
            md
            primary
            numberOfLines={1}
            color={
              item.isAddingFunds
                ? themeColors.status.success
                : themeColors.text.primary
            }
          >
            {item.amountText}
          </Text>
        )}
        <Text sm secondary numberOfLines={1}>
          {item.dateText}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default HistoryItem;
