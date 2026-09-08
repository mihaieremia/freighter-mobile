import { BottomSheetModal } from "@gorhom/bottom-sheet";
import xoxnoIcon from "assets/logos/xoxno-icon.png";
import { TokenIcon } from "components/TokenIcon";
import {
  displayCode,
  formatCompactUsd,
  formatRate,
  getHubDescriptionKey,
} from "components/screens/EarnScreen/helpers";
import { Button } from "components/sds/Button";
import Icon from "components/sds/Icon";
import { Text } from "components/sds/Typography";
import { NATIVE_TOKEN_CODE } from "config/constants";
import { Token } from "config/types";
import { XoxnoHub, XoxnoHubReserve } from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import { getNativeContractDetails } from "helpers/soroban";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";

export interface HubDetailsBottomSheetProps {
  hub: XoxnoHub | null;
  bottomSheetModalRef?: React.RefObject<BottomSheetModal | null>;
}

interface HubDetailRow {
  key: string;
  label: string;
  /** Either a plain string value, or a custom renderer (the "Accepted
   *  tokens" row's icon stack). Exactly one is provided. */
  value?: string;
  renderValue?: () => React.ReactNode;
  /** Explicit value color, e.g. the green "Current Net APY" figure. */
  valueColor?: string;
  testID?: string;
}

/** The design's own icon-stack width (`9448:19027`, 4 icons at a 12px pitch)
 *  -- more reserves than this collapse into a "+N" trailer rather than
 *  spilling the row onto a second line. */
const MAX_VISIBLE_RESERVE_ICONS = 4;

/**
 * Builds the `Token` shape `TokenIcon` expects from a XOXNO hub reserve.
 *
 * Mirrors `EarnTokenRow`'s zero-balance fallback (there is no held balance to
 * read a real token shape from here either): native XLM is decided by
 * comparing the reserve's own contract address to the network's derived
 * native SAC -- never by code, since any issuer can mint a classic asset
 * coded "XLM".
 */
const reserveToToken = (
  reserve: XoxnoHubReserve,
  nativeContractId: string,
): Token =>
  reserve.assetId === nativeContractId
    ? { type: "native" as const, code: NATIVE_TOKEN_CODE as "XLM" }
    : {
        code: displayCode(reserve.symbol, reserve.assetId),
        issuer: { key: reserve.assetId },
      };

/**
 * Renders one `HubDetailRow[]` inside a rounded card, with a hairline
 * divider between rows (never after the last one) -- shared by both stat
 * cards (design node `9448:19005` / `9448:19023`).
 */
const PoolDetailsCard: React.FC<{ rows: HubDetailRow[] }> = ({ rows }) => (
  <View className="rounded-[16px] bg-background-tertiary px-4">
    {rows.map((row, index) => (
      <View key={row.key}>
        <View className="flex-row items-center justify-between py-3">
          <Text md medium secondary>
            {row.label}
          </Text>
          {row.renderValue ? (
            row.renderValue()
          ) : (
            <Text md medium primary color={row.valueColor} testID={row.testID}>
              {row.value}
            </Text>
          )}
        </View>
        {index < rows.length - 1 && (
          <View className="h-px bg-border-primary w-full" />
        )}
      </View>
    ))}
  </View>
);

/**
 * Content for the Earn hub-details sheet. Previously presented from
 * `EarnTokenPickerScreen`'s header info button, which was never in the
 * design and has been removed there. Now triggered from the amount screen's
 * `HubCard` chevron (design node `9448:29157`/`9448:18518`) -- the design's
 * only route into this sheet -- mirroring the extension's
 * `EarnAmount/HubCard.tsx` `onOpenDetails`.
 *
 * Modeled on `XlmReserveBottomSheet`: pure content (the caller wraps it in
 * `components/BottomSheet` and owns the modal ref); `bottomSheetModalRef` is
 * used here for both the close button and the bottom "Close" CTA.
 *
 * Structure follows the render (`9448:18518`) rather than the raw 360×600
 * popup geometry verbatim, per the design owner's ratios-of-canvas rule:
 * header (hub artwork + name/"by XOXNO" + close) -> "Description" eyebrow +
 * prose -> "Hub Details" eyebrow -> two stat cards -> full-width "Close"
 * CTA.
 */
export const HubDetailsBottomSheet: React.FC<HubDetailsBottomSheetProps> = ({
  hub,
  bottomSheetModalRef,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();
  const { network } = useAuthenticationStore();

  const handleClose = () => {
    bottomSheetModalRef?.current?.dismiss();
  };

  // Guards a race where the sheet is presented before (or after) the hub
  // has resolved — e.g. a stale ref call while useEarnTokens is still
  // loading. The wrapping BottomSheet keeps working; there's simply nothing
  // to render here.
  if (!hub) {
    return null;
  }

  // getHubDescriptionKey's return is deliberately widened to `string | null`
  // (Task 7) so the hub-id map can grow without narrowing callers — but that
  // means it can't type-check against i18next's literal key union the way a
  // hardcoded key can. The cast below is scoped to exactly this one dynamic
  // lookup; every other `t(...)` call in this file uses a literal key and is
  // fully type-checked.
  const descriptionKey = getHubDescriptionKey(hub.id);
  const description = descriptionKey ? t(descriptionKey as never) : null;

  const nativeContractId = getNativeContractDetails(network).contract;
  const visibleReserves = hub.reserves.slice(0, MAX_VISIBLE_RESERVE_ICONS);
  const overflowReserveCount = hub.reserves.length - visibleReserves.length;

  const statRows: HubDetailRow[] = [
    {
      key: "lendingInterest",
      // The hub's weighted supply rate: each market's APY weighted by what is
      // supplied to it, so it reads as what a depositor spread across the hub
      // would earn rather than an unweighted average of its markets.
      label: t("earnHubDetails.lendingInterest"),
      value: formatRate(hub.interestApy),
      testID: "hub-details-lendingInterest",
    },
  ];

  const detailRows: HubDetailRow[] = [
    {
      key: "acceptedTokens",
      label: t("earnHubDetails.acceptedTokens"),
      renderValue: () =>
        hub.reserves.length === 0 ? (
          // Empty reserve list: nothing resolved yet (e.g. a hub row built
          // before `useEarnTokens` populates it). Same "unavailable" signal
          // as every other null figure on this sheet, not a bare blank.
          <Text md medium primary testID="hub-details-acceptedTokens">
            --
          </Text>
        ) : (
          <View
            className="flex-row items-center"
            testID="hub-details-acceptedTokens"
          >
            <View className="flex-row items-center">
              {visibleReserves.map((reserve, index) => (
                <View
                  key={reserve.assetId}
                  className={
                    index === 0 ? "rounded-full" : "rounded-full -ml-[4px]"
                  }
                >
                  <TokenIcon
                    token={reserveToToken(reserve, nativeContractId)}
                    size="sm"
                  />
                </View>
              ))}
            </View>
            {overflowReserveCount > 0 && (
              <View className="ml-[4px]">
                <Text
                  xs
                  medium
                  secondary
                  testID="hub-details-acceptedTokens-overflow"
                >
                  {`+${overflowReserveCount}`}
                </Text>
              </View>
            )}
          </View>
        ),
    },
    {
      key: "supplied",
      label: t("earnHubDetails.supplied"),
      value: formatCompactUsd(hub.suppliedUsd),
      testID: "hub-details-supplied",
    },
  ];

  return (
    <View className="gap-[24px]">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-4">
          {/* The XOXNO mark, shared with `HubCard` and the token
              picker's badge. This was a lilac `InfoCircle` placeholder while
              no artwork existed, sized 28 to match `HubCard`'s identical
              stand-in; now that the asset exists each surface takes its own
              designed size, so this follows this sheet's own header-icon
              geometry (`9448:18861`) at 32 rather than the amount screen's
              40. */}
          <Image
            source={xoxnoIcon}
            className="size-8 rounded"
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <View className="ml-4 flex-1">
            {hub.name && (
              <Text md medium primary numberOfLines={1}>
                {hub.name}
              </Text>
            )}
            <Text sm regular secondary numberOfLines={1}>
              {t("earnHubDetails.byXoxno")}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleClose} testID="hub-details-close">
          <Icon.X
            color={themeColors.foreground.secondary}
            size={22}
            circle
            circleBorder={themeColors.background.tertiary}
            circleBackground={themeColors.background.tertiary}
          />
        </TouchableOpacity>
      </View>

      {description && (
        <View className="gap-[6px]">
          <Text xs secondary>
            {t("earnHubDetails.description")}
          </Text>
          <Text sm regular secondary testID="hub-details-description">
            {description}
          </Text>
        </View>
      )}

      <View className="gap-[12px]">
        <Text xs secondary>
          {t("earnHubDetails.hubDetails")}
        </Text>
        <PoolDetailsCard rows={statRows} />
        <PoolDetailsCard rows={detailRows} />
      </View>

      <Button
        secondary
        xl
        isFullWidth
        onPress={handleClose}
        testID="hub-details-close-cta"
      >
        {t("common.close")}
      </Button>
    </View>
  );
};

export default HubDetailsBottomSheet;
