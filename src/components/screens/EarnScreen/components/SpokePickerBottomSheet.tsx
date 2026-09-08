import { Button } from "components/sds/Button";
import Icon from "components/sds/Icon";
import { Text } from "components/sds/Typography";
import { XoxnoEarnSpoke } from "config/xoxnoTypes";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React from "react";
import { TouchableOpacity, View } from "react-native";

export interface SpokePickerBottomSheetProps {
  spokes: XoxnoEarnSpoke[];
  selectedSpokeId: number | null;
  onSelect: (spokeId: number) => void;
  onClose: () => void;
}

/** Basis points as a percentage, e.g. 7500 -> "75%". */
const bpsToPercent = (bps: number) => `${(bps / 100).toFixed(0)}%`;

/**
 * Chooses which risk spoke a new position opens in.
 *
 * Every spoke here earns the same on this asset — the rate belongs to the
 * market, not the spoke — so the choice is only about what the deposit can do
 * afterwards: whether it counts as collateral, and on what terms. That is why
 * the rows lead with those numbers rather than a yield.
 */
export const SpokePickerBottomSheet: React.FC<SpokePickerBottomSheetProps> = ({
  spokes,
  selectedSpokeId,
  onSelect,
  onClose,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text lg medium primary>
          {t("earnSpoke.title")}
        </Text>
        <Text sm secondary>
          {t("earnSpoke.sameRate")}
        </Text>
      </View>

      <View className="gap-2">
        {spokes.map((spoke) => (
          <TouchableOpacity
            key={spoke.id}
            onPress={() => onSelect(spoke.id)}
            testID={`earn-spoke-${spoke.id}`}
            className="flex-row items-center gap-3 rounded-2xl bg-background-tertiary p-4"
          >
            <View className="flex-1 gap-1">
              <Text md medium primary numberOfLines={1}>
                {spoke.name ?? t("earnSpoke.unnamed", { id: spoke.id })}
              </Text>
              <Text sm secondary numberOfLines={1}>
                {t("earnSpoke.collateral", {
                  ltv: bpsToPercent(spoke.loanToValueBps),
                  threshold: bpsToPercent(spoke.liquidationThresholdBps),
                })}
              </Text>
            </View>

            {spoke.id === selectedSpokeId && (
              <Icon.CheckCircle size={20} color={themeColors.status.success} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <Button secondary xl onPress={onClose} testID="earn-spoke-close">
        {t("earnSpoke.close")}
      </Button>
    </View>
  );
};
