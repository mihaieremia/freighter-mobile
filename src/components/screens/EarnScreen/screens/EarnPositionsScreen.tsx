import { NativeStackScreenProps } from "@react-navigation/native-stack";
import Spinner from "components/Spinner";
import { BaseLayout } from "components/layout/BaseLayout";
import { EarnPositionRow } from "components/screens/EarnScreen/components/EarnPositionRow";
import { PositionRiskBadge } from "components/screens/EarnScreen/components/PositionRiskBadge";
import { legDisplayCode } from "components/screens/EarnScreen/helpers";
import { useEarnPositions } from "components/screens/EarnScreen/hooks/useEarnPositions";
import { Button } from "components/sds/Button";
import { Text } from "components/sds/Typography";
import { mapNetworkToNetworkDetails } from "config/constants";
import { EARN_ROUTES, EarnStackParamList } from "config/routes";
import { XoxnoPositionLeg } from "config/xoxnoTypes";
import { useAuthenticationStore } from "ducks/auth";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import React, { useCallback, useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

type EarnPositionsScreenProps = NativeStackScreenProps<
  EarnStackParamList,
  typeof EARN_ROUTES.EARN_POSITIONS_SCREEN
>;

/**
 * The Earn flow's home: what this account currently supplies, and the way
 * into both a new deposit and a withdrawal.
 *
 * Positions are listed per position NFT, because that is the unit the
 * contract withdraws from — two legs of the same asset in different
 * positions are two separate balances, not one summed figure, and merging
 * them would name an amount no single `withdraw` call could take.
 */
export const EarnPositionsScreen: React.FC<EarnPositionsScreenProps> = ({
  navigation,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();
  const { network } = useAuthenticationStore();
  const { positions, isLoading, error, refetch } = useEarnPositions();

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  const handleDeposit = useCallback(() => {
    navigation.navigate(EARN_ROUTES.EARN_TOKEN_PICKER_SCREEN);
  }, [navigation]);

  const handleRepay = useCallback(
    (leg: XoxnoPositionLeg) => {
      if (leg.tokens === null || leg.decimals === null) return;
      navigation.navigate(EARN_ROUTES.EARN_REPAY_SCREEN, {
        accountId: leg.accountId,
        hubId: leg.hubId,
        hubName: leg.hubName,
        assetId: leg.assetId,
        tokenCode: legDisplayCode(leg),
        decimals: leg.decimals,
        borrowedTokens: leg.tokens,
      });
    },
    [navigation],
  );

  const handleWithdraw = useCallback(
    (leg: XoxnoPositionLeg) => {
      if (leg.tokens === null || leg.decimals === null) return;
      navigation.navigate(EARN_ROUTES.EARN_WITHDRAW_SCREEN, {
        accountId: leg.accountId,
        hubId: leg.hubId,
        hubName: leg.hubName,
        assetId: leg.assetId,
        tokenCode: legDisplayCode(leg),
        decimals: leg.decimals,
        suppliedTokens: leg.tokens,
        withdrawableTokens: leg.withdrawableTokens,
        apy: leg.apy,
      });
    },
    [navigation],
  );

  const layoutProps = {
    useSafeArea: true,
    backgroundColor: themeColors.background.primary,
    // `top: false` — the shared navigation header above this screen
    // already covers the safe area, and asking for it twice left a band of
    // empty space between the header and the content.
    insets: { top: false, bottom: true, left: false, right: false },
  };

  if (isLoading && positions === null) {
    return (
      <BaseLayout {...layoutProps}>
        <View className="flex-1 px-6 items-center justify-center">
          <Spinner testID="earn-positions-spinner" />
        </View>
      </BaseLayout>
    );
  }

  if (error && positions === null) {
    return (
      <BaseLayout {...layoutProps}>
        <View className="flex-1 px-6">
          <View className="flex-1 items-center justify-center gap-2">
            <Text lg medium primary textAlign="center">
              {t("earnPositions.error.title")}
            </Text>
            <Text sm secondary textAlign="center">
              {t("earnPositions.error.body")}
            </Text>
            <View className="h-6" />
            <Button secondary onPress={refetch} testID="earn-positions-retry">
              {t("earnPositions.error.retry")}
            </Button>
          </View>
        </View>
      </BaseLayout>
    );
  }

  const hasPositions = (positions ?? []).length > 0;

  return (
    <BaseLayout {...layoutProps}>
      <View className="flex-1 px-6">
        <View className="flex-1">
          <View className="mb-4 mt-2">
            <Text sm regular secondary>
              {t("earnPositions.subheading")}
            </Text>
          </View>

          {hasPositions ? (
            <ScrollView
              refreshControl={
                <RefreshControl refreshing={isLoading} onRefresh={refetch} />
              }
              showsVerticalScrollIndicator={false}
              contentContainerClassName="gap-6 pb-6"
              testID="earn-positions-list"
            >
              {(positions ?? []).map((position) => (
                <View
                  key={position.accountId}
                  // Dashed rather than solid: it groups the legs of one
                  // position NFT without competing with the rows inside it,
                  // which carry the solid surfaces.
                  className="gap-2 rounded-2xl border border-dashed border-border-primary p-3"
                  testID={`earn-position-group-${position.accountId}`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2 flex-1">
                      <Text sm secondary numberOfLines={1}>
                        {position.spokeName ?? t("earnPositions.heading")}
                      </Text>
                      {/* The position NFT's id. One address can hold several,
                          and this is the one the contract acts on. */}
                      <Text sm secondary>
                        {`#${position.accountId}`}
                      </Text>
                    </View>
                    <PositionRiskBadge
                      healthFactor={position.healthFactor}
                      hasDebt={position.borrow.length > 0}
                    />
                  </View>

                  {position.supply.map((leg) => (
                    <EarnPositionRow
                      key={`${leg.hubId}-${leg.assetId}`}
                      leg={leg}
                      networkDetails={networkDetails}
                      onPress={
                        leg.tokens !== null && leg.decimals !== null
                          ? () => handleWithdraw(leg)
                          : undefined
                      }
                      testID={`earn-position-${leg.assetId}`}
                    />
                  ))}

                  {/* Freighter can repay debt. A position
                      opened elsewhere can carry debt, and that debt is what
                      bounds every withdrawal from it. Hiding it would leave
                      the bound looking arbitrary. */}
                  {position.borrow.length > 0 && (
                    <View className="gap-2 mt-2">
                      <Text sm secondary>
                        {t("earnPositions.borrowed")}
                      </Text>
                      {position.borrow.map((leg) => (
                        <EarnPositionRow
                          variant="borrow"
                          key={`borrow-${leg.hubId}-${leg.assetId}`}
                          leg={leg}
                          networkDetails={networkDetails}
                          onPress={
                            leg.tokens !== null && leg.decimals !== null
                              ? () => handleRepay(leg)
                              : undefined
                          }
                          testID={`earn-position-debt-${leg.assetId}`}
                        />
                      ))}
                      <Text sm secondary>
                        {t("earnPositions.repayHint")}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View className="flex-1 items-center justify-center gap-1">
              <Text md medium primary textAlign="center">
                {t("earnPositions.empty.title")}
              </Text>
              <Text sm secondary textAlign="center">
                {t("earnPositions.empty.body")}
              </Text>
            </View>
          )}
        </View>

        <View className="w-full mb-2">
          <Button
            tertiary
            xl
            onPress={handleDeposit}
            testID="earn-positions-deposit"
          >
            {t("earnPositions.deposit")}
          </Button>
        </View>
      </View>
    </BaseLayout>
  );
};

export default EarnPositionsScreen;
