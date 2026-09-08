import BigNumber from "bignumber.js";
import { TokenIcon } from "components/TokenIcon";
import {
  formatRate,
  legDisplayCode,
} from "components/screens/EarnScreen/helpers";
import Icon from "components/sds/Icon";
import { Text } from "components/sds/Typography";
import { NATIVE_TOKEN_CODE, NetworkDetails } from "config/constants";
import { Balance, Token } from "config/types";
import { XoxnoPositionLeg } from "config/xoxnoTypes";
import { formatFiatAmount, formatTokenForDisplay } from "helpers/formatAmount";
import { getNativeContractDetails } from "helpers/soroban";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React from "react";
import { TouchableOpacity, View } from "react-native";

export interface EarnPositionRowProps {
  /** A borrow leg's rate is a cost, so it is not dressed as a gain. */
  variant?: "supply" | "borrow";
  leg: XoxnoPositionLeg;
  networkDetails: NetworkDetails;
  /** Omitted for a debt row, which this app can display but not act on. */
  onPress?: () => void;
  testID?: string;
}

/**
 * One supplied leg on the positions screen: token icon and code on the left,
 * the supplied balance and its USD value beneath, the market's rate on the
 * right.
 *
 * Mirrors `EarnTokenRow`'s card surface so the two lists read as one family,
 * but reports the position rather than the wallet: the balance here is what
 * the protocol holds for this account, which is the figure a withdrawal is
 * bounded by.
 */
export const EarnPositionRow: React.FC<EarnPositionRowProps> = ({
  variant = "supply",
  leg,
  networkDetails,
  onPress,
  testID,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();

  // Native is decided by comparing the contract address to the network's
  // derived native SAC, never by code — any issuer can mint an asset coded
  // "XLM" (the trap `buildEarnTokenRows` guards against as well). It selects
  // the icon only; the code itself comes resolved from the service.
  const isNative =
    leg.assetId === getNativeContractDetails(networkDetails.network).contract;
  const code = legDisplayCode(leg);

  const token: Token | Balance = isNative
    ? { type: "native" as const, code: NATIVE_TOKEN_CODE as "XLM" }
    : { code, issuer: { key: leg.assetId } };

  const amount =
    leg.tokens !== null && leg.decimals !== null
      ? new BigNumber(leg.tokens).shiftedBy(-leg.decimals)
      : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      className="flex-row items-center gap-3 rounded-2xl bg-background-tertiary p-4"
    >
      <TokenIcon token={token} size="lg" />

      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-1">
          <Text md medium primary>
            {code}
          </Text>
          {/* The hub, not the spoke above the list: a position's legs can sit
              in different hubs, and the hub is what the rate belongs to. */}
          <Text sm secondary>
            {`· ${leg.hubName}`}
          </Text>
        </View>
        {/* One line, truncated: a long balance was pushing the row onto a
            second line and breaking the rhythm of the list. */}
        <Text sm secondary numberOfLines={1}>
          {amount === null
            ? t("earnSafety.quantityUnavailable")
            : formatTokenForDisplay(amount, code)}
          {leg.usdValue !== null &&
            ` · ${formatFiatAmount(String(leg.usdValue))}`}
        </Text>
      </View>

      {leg.apy !== null && (
        // Labelled, because a bare percentage beside a balance could as
        // easily be a share of the position. Supply and borrow get the same
        // treatment and differ only in colour: green reads as earning, which
        // interest on a debt is not, so that side takes the app's accent.
        <View className="items-end">
          <Text xs secondary>
            {t("earnPositions.apy")}
          </Text>
          <Text
            sm
            medium
            color={
              variant === "borrow"
                ? themeColors.lilac[11]
                : themeColors.status.success
            }
            testID={`earn-position-apy-${leg.assetId}`}
          >
            {formatRate(leg.apy)}
          </Text>
        </View>
      )}
      {onPress && (
        <Icon.ChevronRight size={16} color={themeColors.foreground.secondary} />
      )}
    </TouchableOpacity>
  );
};
