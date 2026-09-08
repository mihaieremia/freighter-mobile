import { TokenIcon } from "components/TokenIcon";
import { Banner } from "components/sds/Banner";
import { Button } from "components/sds/Button";
import { Display, Text } from "components/sds/Typography";
import { Balance, Token } from "config/types";
import { formatTokenForDisplay } from "helpers/formatAmount";
import useAppTranslation from "hooks/useAppTranslation";
import React from "react";
import { View } from "react-native";
import { SecurityAssessment } from "services/blockaid/types";

export interface EarnActionReviewBottomSheetProps {
  /** Which way the asset moves; only the copy differs. */
  variant: "withdraw" | "repay";
  amount: string;
  tokenCode: string;
  /** The asset itself, for its mark. Omitted only if it cannot be resolved. */
  token?: Token | Balance;
  /** The hub the position sits in, shown as the other side of the move. */
  contextName?: string;
  /** Measured network fee in XLM, from the simulation. */
  feeXlm?: string | null;
  /** A line under the amount, e.g. that this clears the debt outright. */
  note?: string;
  securityAssessment: SecurityAssessment;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm?: boolean;
}

/**
 * Confirms a withdrawal or a repayment before it is signed.
 *
 * The amount leads, because it is the one thing worth checking twice, and the
 * rest is a plain list of where it goes and what it costs. There is no rate
 * projection here, unlike the deposit's review: neither amount is earning
 * once it settles.
 */
export const EarnActionReviewBottomSheet: React.FC<
  EarnActionReviewBottomSheetProps
> = ({
  variant,
  amount,
  tokenCode,
  token,
  contextName,
  feeXlm,
  note,
  securityAssessment,
  onCancel,
  onConfirm,
  canConfirm = false,
}) => {
  const { t } = useAppTranslation();

  const { isMalicious, isSuspicious, isUnableToScan } = securityAssessment;
  const bannerText = (() => {
    if (isMalicious) {
      return t("transactionAmountScreen.errors.malicious");
    }
    if (isSuspicious) {
      return t("transactionAmountScreen.errors.suspicious");
    }
    return t("securityWarning.proceedWithCaution");
  })();

  const isRepay = variant === "repay";
  const wallet = isRepay
    ? t("earnRepay.yourWallet")
    : t("earnWithdraw.yourWallet");

  /**
   * Source and destination, in the order the asset actually travels: a
   * withdrawal leaves the hub for the wallet, a repayment leaves the wallet
   * for the hub. The hub row is dropped when its name is unknown rather than
   * shown as a blank.
   */
  const rows: { label: string; value: string }[] = [
    isRepay
      ? { label: t("earnRepay.from"), value: wallet }
      : { label: t("earnWithdraw.to"), value: wallet },
    ...(contextName
      ? [
          {
            label: isRepay ? t("earnWithdraw.to") : t("earnRepay.from"),
            value: contextName,
          },
        ]
      : []),
    ...(feeXlm
      ? [
          {
            label: t("swapScreen.review.fee"),
            value: formatTokenForDisplay(feeXlm, "XLM"),
          },
        ]
      : []),
  ];

  return (
    <View className="gap-6">
      <View className="items-center gap-3">
        {token && <TokenIcon token={token} size="lg" />}
        <View className="items-center gap-1">
          <Text sm secondary>
            {isRepay
              ? t("earnRepay.reviewTitle")
              : t("earnWithdraw.reviewTitle")}
          </Text>
          <Display xs medium testID="earn-review-amount">
            {formatTokenForDisplay(amount, tokenCode)}
          </Display>
          {note && (
            <Text sm secondary textAlign="center" testID="earn-review-note">
              {note}
            </Text>
          )}
        </View>
      </View>

      {(isMalicious || isSuspicious || isUnableToScan) && (
        <Banner
          testID="earn-review-security-banner"
          variant={isSuspicious || isUnableToScan ? "warning" : "error"}
          text={bannerText}
        />
      )}

      <View
        className="rounded-[16px] px-4 py-2 gap-3 bg-background-tertiary"
        testID="earn-review-details"
      >
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={`flex-row items-center justify-between py-2 ${
              index === 0 ? "" : "border-t border-border-primary"
            }`}
          >
            <Text sm secondary>
              {row.label}
            </Text>
            <Text sm medium primary numberOfLines={1}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button secondary xl onPress={onCancel} testID="earn-review-cancel">
            {t("earnWithdraw.cancel")}
          </Button>
        </View>
        <View className="flex-1">
          <Button
            tertiary
            xl
            disabled={!canConfirm}
            onPress={onConfirm}
            testID="earn-review-confirm"
          >
            {t("earnWithdraw.confirm")}
          </Button>
        </View>
      </View>
    </View>
  );
};
