import xoxnoIcon from "assets/logos/xoxno-icon.png";
import { formatRate } from "components/screens/EarnScreen/helpers";
import Icon from "components/sds/Icon";
import { Text } from "components/sds/Typography";
import { XoxnoHub } from "config/xoxnoTypes";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";

export interface HubCardProps {
  hub: XoxnoHub | null;
  /** Selected asset's headline APY, as read off the earn duck. */
  apy: number | null;
  /** Opens `HubDetailsBottomSheet` -- the design's only route there now
   *  that the token picker's invented header info-button is gone. */
  onPress: () => void;
  testID?: string;
}

/**
 * Amount screen's hub-identity card: a "Current APY" tab sitting flush on top
 * of a hub row, and this screen's only entry into `HubDetailsBottomSheet`.
 *
 * An asset with no fresh APY (`apy === null`) drops the tab entirely, the
 * same fallback `EarnTokenRow` takes, rather than inventing a "no rate" state
 * the design does not have.
 */
export const HubCard: React.FC<HubCardProps> = ({
  hub,
  apy,
  onPress,
  testID,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();

  if (!hub) {
    return null;
  }

  return (
    <View testID={testID}>
      {apy !== null && (
        <View className="mx-4">
          <View
            className="items-center justify-center rounded-t-2xl px-3 py-0.5"
            style={{ backgroundColor: themeColors.green[2] }}
          >
            <Text xs medium color={themeColors.green[9]}>
              {t("earnAmount.hubCard.currentApy", { rate: formatRate(apy) })}
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        className="flex-row items-center justify-between px-4 py-3 rounded-2xl bg-background-tertiary"
        testID={testID ? `${testID}-row` : undefined}
        accessibilityRole="button"
        accessibilityLabel={t("earnAmount.hubCard.accessibilityLabel")}
      >
        <View className="flex-row items-center flex-1 mr-4">
          <Image
            source={xoxnoIcon}
            className="size-10 rounded"
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <View className="ml-4 flex-1">
            {hub.name && (
              <Text md medium primary numberOfLines={1}>
                {hub.name}
              </Text>
            )}
            <Text sm medium secondary numberOfLines={1}>
              {t("earnAmount.hubCard.byXoxno")}
            </Text>
          </View>
        </View>
        {/* 34x34 (10 padding around a 14 glyph) on the page background, so it
            reads as a well punched into the card rather than a raised chip. */}
        <View
          className="size-[34px] items-center justify-center rounded-full"
          style={{ backgroundColor: themeColors.background.primary }}
        >
          <Icon.ChevronRight size={14} color={themeColors.text.primary} />
        </View>
      </TouchableOpacity>
    </View>
  );
};

export default HubCard;
