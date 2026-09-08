import {
  formatRisk,
  liquidationRisk,
  riskLevel,
} from "components/screens/EarnScreen/helpers";
import { Text } from "components/sds/Typography";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React from "react";
import { View } from "react-native";

export interface PositionRiskBadgeProps {
  healthFactor: number | null;
  hasDebt?: boolean;
}

/**
 * How close a position is to liquidation.
 *
 * Reported as the share of its borrowing power already used, not as the raw
 * health factor: 100% is the liquidation point and bigger is worse, which
 * runs the same direction as every other risk figure a wallet shows. The
 * colour carries the same message for anyone who does not read the number.
 *
 * Renders nothing for a position with no debt — there is no liquidation to be
 * near, and a green badge saying so would draw the eye to a non-event.
 */
export const PositionRiskBadge: React.FC<PositionRiskBadgeProps> = ({
  healthFactor,
  hasDebt = false,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();

  const risk = liquidationRisk(healthFactor);
  if (risk === null) {
    return hasDebt ? (
      <Text sm secondary testID="earn-position-risk-unknown">
        {t("earnSafety.riskUnavailable")}
      </Text>
    ) : null;
  }

  const color = {
    safe: themeColors.status.success,
    caution: themeColors.status.warning,
    danger: themeColors.status.error,
  }[riskLevel(risk)];

  return (
    // Only the figure is coloured: the word is a label, and colouring it too
    // would read as the whole position being in that state rather than the
    // number being the thing to watch.
    <View className="flex-row items-center gap-1">
      <Text sm secondary>
        {t("earnPositions.health")}
      </Text>
      <Text sm medium color={color} testID="earn-position-risk">
        {formatRisk(risk)}
      </Text>
    </View>
  );
};
