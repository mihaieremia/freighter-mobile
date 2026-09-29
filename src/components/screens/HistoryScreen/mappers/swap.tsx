/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { logos } from "assets/logos";
import { TokenIcon } from "components/TokenIcon";
import TransactionDetailsContent from "components/screens/HistoryScreen/TransactionDetailsContent";
import {
  TransactionDetails,
  TransactionType,
  TransactionStatus,
  HistoryItemData,
  AssetDiffSummary,
} from "components/screens/HistoryScreen/types";
import Icon from "components/sds/Icon";
import { Token } from "components/sds/Token";
import { Text } from "components/sds/Typography";
import {
  DEFAULT_DECIMALS,
  NATIVE_TOKEN_CODE,
  NETWORKS,
} from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { isNativeAssetId } from "helpers/assetIdentity";
import { formatTokenForDisplay } from "helpers/formatAmount";
import { getIconUrl } from "helpers/getIconUrl";
import { isContractId } from "helpers/soroban";
import useColors, { ThemeColors } from "hooks/useColors";
import { t } from "i18next";
import React from "react";
import { View } from "react-native";

interface SwapHistoryItemData {
  operation: any;
  stellarExpertUrl: string;
  date: string;
  fee: string;
  memo?: string;
  network: NETWORKS;
  themeColors: ThemeColors;
  xdr: string;
}

/**
 * The asset the icon lookups take: a Soroban token is named by its contract
 * id, a classic asset by its code and issuer.
 */
const getIconAsset = (code: string, issuer?: string) =>
  issuer && isContractId(issuer)
    ? { code, contractId: issuer }
    : { code, issuer: issuer || "" };

/**
 * Maps swap operation data to history item data
 */
export const mapSwapHistoryItem = async ({
  operation,
  stellarExpertUrl,
  date,
  fee,
  memo,
  network,
  themeColors,
  xdr,
}: SwapHistoryItemData): Promise<HistoryItemData> => {
  const {
    id,
    amount,
    asset_code: destTokenCode,
    asset_issuer: tokenIssuer,
    source_asset_code: sourceTokenCode,
    source_asset_issuer: sourceTokenIssuer,
    source_icon_url: sourceIconUrl,
    icon_url: destIconUrl,
  } = operation;

  const srcTokenCode = sourceTokenCode || NATIVE_TOKEN_CODE;
  const destTokenCodeFinal = destTokenCode || NATIVE_TOKEN_CODE;
  // The received amount is empty when it could not be read (a Soroban token
  // leg of an aggregator swap); the row then shows what was sold instead.
  const hasReceivedAmount = !!amount;
  const formattedAmount = hasReceivedAmount
    ? `+${formatTokenForDisplay(amount, destTokenCodeFinal)}`
    : `-${formatTokenForDisplay(operation.source_amount || "", srcTokenCode)}`;

  // Nativeness comes from the operation record's own type discriminant.
  const isSourceNative = isNativeAssetId(operation.source_asset_type);
  const isDestNative = isNativeAssetId(operation.asset_type);

  // Fetch icon URLs for the source and destination assets in parallel.
  // Native token icons are omitted — they use hardcoded logos in the row component.
  const [destIcon, sourceIcon] = await Promise.all([
    isDestNative
      ? Promise.resolve(undefined)
      : getIconUrl({
          asset: getIconAsset(destTokenCodeFinal, tokenIssuer),
          network,
        }),
    isSourceNative
      ? Promise.resolve(undefined)
      : getIconUrl({
          asset: getIconAsset(srcTokenCode, sourceTokenIssuer),
          network,
        }),
  ]);

  // Create asset diffs for swap: one debit (sent) and, when its amount is
  // known, one credit (received)
  const assetDiffs: AssetDiffSummary[] = [
    // Debit: Source asset being sold
    {
      assetCode: srcTokenCode,
      assetIssuer: sourceTokenIssuer || null,
      decimals: DEFAULT_DECIMALS,
      amount: operation.source_amount || "",
      isCredit: false,
      icon: sourceIcon,
    },
    // Credit: Destination asset being bought
    ...(hasReceivedAmount
      ? [
          {
            assetCode: destTokenCodeFinal,
            assetIssuer: tokenIssuer || null,
            decimals: DEFAULT_DECIMALS,
            amount,
            isCredit: true,
            icon: destIcon,
          },
        ]
      : []),
  ];

  const ActionIconComponent = (
    <Icon.RefreshCw05 size={16} color={themeColors.foreground.primary} />
  );

  const IconComponent = (
    <Token
      size="lg"
      variant="swap"
      sourceOne={{
        altText: "Swap source token logo",
        // For the native asset, use the Stellar logo directly; a Soroban token
        // brings the catalog logo, used when the icon store has none
        image: isSourceNative ? logos.stellar : sourceIconUrl,
        token: isSourceNative
          ? undefined
          : {
              code: srcTokenCode,
              issuer: sourceTokenIssuer || "",
            },
        // Fallback: show token initials if the icon is not available
        renderContent: () => (
          <Text xs secondary semiBold>
            {srcTokenCode.substring(0, 2)}
          </Text>
        ),
      }}
      sourceTwo={{
        altText: "Swap destination token logo",
        // For the native asset, use the Stellar logo directly; a Soroban token
        // brings the catalog logo, used when the icon store has none
        image: isDestNative ? logos.stellar : destIconUrl,
        token: isDestNative
          ? undefined
          : {
              code: destTokenCodeFinal,
              issuer: tokenIssuer || "",
            },
        // Fallback: show token initials if the icon is not available
        renderContent: () => (
          <Text xs secondary semiBold>
            {destTokenCodeFinal.substring(0, 2)}
          </Text>
        ),
      }}
    />
  );

  const transactionDetails: TransactionDetails = {
    operation,
    transactionTitle: t("history.transactionHistory.swappedTwoTokens", {
      srcTokenCode,
      destTokenCode: destTokenCodeFinal,
    }),
    transactionType: TransactionType.SWAP,
    status: TransactionStatus.SUCCESS,
    IconComponent,
    ActionIconComponent,
    fee,
    memo,
    xdr,
    externalUrl: `${stellarExpertUrl}/op/${id}`,
    swapDetails: {
      sourceTokenIssuer: operation.source_asset_issuer || "",
      destinationTokenIssuer: operation.asset_issuer || "",
      sourceTokenCode: srcTokenCode || "",
      destinationTokenCode: destTokenCodeFinal || "",
      sourceAmount: operation.source_amount || "",
      destinationAmount: operation.amount || "",
      sourceTokenType: operation.source_asset_type || "",
      destinationTokenType: operation.asset_type || "",
    },
    assetDiffs,
  };

  return {
    transactionDetails,
    rowText: t("history.transactionHistory.swapTwoTokens", {
      srcTokenCode,
      destTokenCode: destTokenCodeFinal,
    }),
    actionText: t("history.transactionHistory.swapped"),
    dateText: date,
    amountText: formattedAmount,
    isAddingFunds: hasReceivedAmount,
    ActionIconComponent,
    IconComponent,
    transactionStatus: TransactionStatus.SUCCESS,
  };
};

/**
 * Renders swap transaction details
 */
export const SwapTransactionDetailsContent: React.FC<{
  transactionDetails: TransactionDetails;
}> = ({ transactionDetails }) => {
  const { themeColors } = useColors();

  return (
    <TransactionDetailsContent>
      <View className="flex-row items-center">
        <TokenIcon
          token={{
            code: transactionDetails.swapDetails?.sourceTokenCode ?? "",
            issuer: {
              key: transactionDetails.swapDetails?.sourceTokenIssuer ?? "",
            },
            type: transactionDetails.swapDetails
              ?.sourceTokenType as TokenTypeWithCustomToken,
          }}
        />
        <View className="ml-[16px]">
          <Text xl primary medium numberOfLines={1}>
            {formatTokenForDisplay(
              transactionDetails.swapDetails?.sourceAmount ?? "",
              transactionDetails.swapDetails?.sourceTokenCode ?? "",
            )}
          </Text>
        </View>
      </View>

      <View className="w-[40px] flex items-center py-1">
        <Icon.ChevronDownDouble
          size={20}
          color={themeColors.foreground.primary}
        />
      </View>

      <View className="flex-row items-center">
        <TokenIcon
          token={{
            code: transactionDetails.swapDetails?.destinationTokenCode ?? "",
            issuer: {
              key: transactionDetails.swapDetails?.destinationTokenIssuer ?? "",
            },
            type: transactionDetails.swapDetails
              ?.destinationTokenType as TokenTypeWithCustomToken,
          }}
        />
        <View className="ml-[16px]">
          <Text xl primary medium numberOfLines={1}>
            {formatTokenForDisplay(
              transactionDetails.swapDetails?.destinationAmount ?? "",
              transactionDetails.swapDetails?.destinationTokenCode ?? "",
            )}
          </Text>
        </View>
      </View>
    </TransactionDetailsContent>
  );
};
