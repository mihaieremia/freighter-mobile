import { useNavigation } from "@react-navigation/native";
import xoxnoIcon from "assets/logos/xoxno-icon.png";
import Spinner from "components/Spinner";
import { TokenIcon } from "components/TokenIcon";
import { BaseLayout } from "components/layout/BaseLayout";
import { useEarnPositions } from "components/screens/EarnScreen/hooks/useEarnPositions";
import { useEarnTokens } from "components/screens/EarnScreen/hooks/useEarnTokens";
import { EarnTransactionStatus } from "components/screens/EarnScreen/hooks/useEarnTransaction";
import { Button } from "components/sds/Button";
import Icon from "components/sds/Icon";
import { Display, Text } from "components/sds/Typography";
import { AnalyticsEvent, buildScreenViewedProps } from "config/analyticsConfig";
import { mapNetworkToNetworkDetails } from "config/constants";
import { logger } from "config/logger";
import { Balance, Token } from "config/types";
import { useAuthenticationStore } from "ducks/auth";
import { useBalancesStore } from "ducks/balances";
import { useEarnStore } from "ducks/earn";
import { getBalanceByContractId } from "helpers/balances";
import { formatTokenForDisplay } from "helpers/formatAmount";
import { getStellarExpertUrl } from "helpers/stellarExpert";
import useAppTranslation from "hooks/useAppTranslation";
import useColors from "hooks/useColors";
import { useInAppBrowser } from "hooks/useInAppBrowser";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Image, View } from "react-native";
import { track } from "services/analytics/core";

export interface EarnProcessingScreenProps {
  /** Failures return to the originating form with a local retry banner. */
  status: Extract<EarnTransactionStatus, "submitting" | "success">;
  /** The amount entered on the amount screen, in display (non-raw) units. */
  tokenAmount: string;
  /**
   * Set once `submit()` resolves successfully; null while still submitting.
   * Threaded through as a prop for the same reason `tokenAmount` is (see
   * below): it lives in `useEarnTransaction`'s local state, not a duck.
   * Powers the "View transaction" explorer link on the success state.
   */
  transactionHash: string | null;
  /** Close during submission and abandon local result handling. */
  onCloseWhileSubmitting: () => void;
  /** Success's "Done" action: resets the earn duck and returns Home. */
  onDone: () => void;
  /**
   * Which direction this screen is reporting. Only the copy differs: a
   * withdrawal moves the same asset the other way, out of the same hub, so
   * the layout, icons and explorer link are identical.
   */
  variant?: "deposit" | "withdraw" | "repay";
  /**
   * Asset code and counterparty name, for a flow that does not go through the
   * earn duck's deposit selection. The withdraw flow is entered straight from
   * the positions list, so `selectedAssetCode`/`hub` are never set for it and
   * the screen would otherwise render a bare amount with nothing after "from".
   */
  tokenCode?: string;
  contextName?: string;
  /** The asset's icon, for the same reason as `tokenCode`. */
  token?: Token | Balance;
}

/**
 * Earn deposit terminal screen. Mirrors `SwapProcessingScreen`'s structure
 * (icon + status text + a card summarizing what happened) but, like
 * `EarnReviewBottomSheet`, reads the hub/asset it's summarizing directly
 * off `useEarnStore` and `useBalancesStore` rather than threading them
 * through props — `tokenAmount` and `transactionHash` are the exceptions,
 * since they live in the amount screen's local hook state
 * (`useTokenFiatConverter` / `useEarnTransaction`), not a duck.
 *
 * Rendered INLINE from `EarnAmountScreen` (not a registered route) whenever
 * status is "submitting" or "success" — see `useEarnTransaction`. This
 * structurally prevents a swipe-back gesture from abandoning an in-flight
 * submit, which is stronger than relying on a navigator's
 * `gestureEnabled: false`. There used to be a third, "error" state rendered
 * here (a full-screen "Deposit failed" step) — the design (`9599:40192`) has
 * no such screen, so it was removed; `EarnAmountScreen` now returns
 * automatically to the normal amount screen on failure instead.
 */
const EarnProcessingScreen: React.FC<EarnProcessingScreenProps> = ({
  status,
  tokenAmount,
  transactionHash,
  onCloseWhileSubmitting,
  onDone,
  variant = "deposit",
  tokenCode,
  contextName,
  token,
}) => {
  const { t } = useAppTranslation();
  const { themeColors } = useColors();
  const navigation = useNavigation();
  const { network } = useAuthenticationStore();
  const {
    pricedBalances,
    fetchAccountBalances,
    isLoading: balancesLoading,
    error: balancesError,
  } = useBalancesStore();
  const { refetch: refreshPositions, error: positionsError } =
    useEarnPositions();
  const { refetch: refreshCatalog } = useEarnTokens();
  useEffect(() => {
    if (status === "success") {
      refreshPositions();
      refreshCatalog();
    }
  }, [status, refreshPositions, refreshCatalog]);
  const { open: openInAppBrowser } = useInAppBrowser();

  const { account } = useAuthenticationStore();
  const selectedAssetId = useEarnStore((state) => state.selectedAssetId);
  const selectedAssetCode = useEarnStore((state) => state.selectedAssetCode);
  const hub = useEarnStore((state) => state.hub);
  const hasEmittedSuccessView = useRef(false);

  const networkDetails = useMemo(
    () => mapNetworkToNetworkDetails(network),
    [network],
  );

  const depositBalance = useMemo(
    () =>
      getBalanceByContractId(selectedAssetId, pricedBalances, networkDetails),
    [selectedAssetId, pricedBalances, networkDetails],
  );

  // Neither this screen nor the review sheet it follows is a registered
  // route (see the component doc above), so screen.viewed for the
  // earn_processing funnel stage doesn't come free from route-based
  // analytics -- emit it manually. The component only ever mounts once
  // `status` has left "idle" (see `EarnAmountScreen`'s inline gate), so a
  // bare mount effect fires this exactly once per submission, mirroring
  // `TransactionProcessingScreen`'s VIEW_SEND_PROCESSING emission.
  useEffect(() => {
    track(
      AnalyticsEvent.SCREEN_VIEWED,
      buildScreenViewedProps(AnalyticsEvent.VIEW_EARN_PROCESSING),
    );
  }, []);

  // This same screen also renders the terminal success state (see
  // `getStatusText`/`getStatusIcon` below), so emit the earn_success funnel
  // stage when `status` settles into "success" -- completing
  // select_token -> amount -> review -> processing -> success cross-platform.
  // Guarded to fire at most once per mount, mirroring
  // `TransactionProcessingScreen`'s VIEW_SEND_SUCCESS emission.
  useEffect(() => {
    if (status === "success" && !hasEmittedSuccessView.current) {
      hasEmittedSuccessView.current = true;
      track(
        AnalyticsEvent.SCREEN_VIEWED,
        buildScreenViewedProps(AnalyticsEvent.VIEW_EARN_SUCCESS),
      );
    }
  }, [status]);

  // This screen replaces EarnAmountScreen's body inline, but that screen
  // still has a registered header (via EarnNavigator) — hide it while this
  // is showing and restore it on unmount, same as SwapProcessingScreen.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(
    () => () =>
      navigation.setOptions({
        headerShown: true,
      }),
    [navigation],
  );

  const isWithdraw = variant === "withdraw";

  const getStatusText = () => {
    if (variant === "repay") {
      return status === "success"
        ? t("earnProcessing.repaid")
        : t("earnProcessing.repaying");
    }
    if (isWithdraw) {
      return status === "success"
        ? t("earnProcessing.withdrawn")
        : t("earnProcessing.withdrawing");
    }
    return status === "success"
      ? t("earnProcessing.deposited")
      : t("earnProcessing.depositing");
  };

  const getStatusIcon = () =>
    status === "success" ? (
      <Icon.CheckCircle size={24} color={themeColors.status.success} />
    ) : (
      <Spinner size="large" color={themeColors.base[1]} />
    );

  // "View transaction" (success only, design node `9449:29739`). Same
  // stellar.expert URL construction `SwapProcessingScreen`'s transaction
  // details sheet and `ManageAccounts`' "view on explorer" action use —
  // reused directly rather than hand-building the URL.
  const handleViewTransaction = useCallback(() => {
    if (!transactionHash) {
      return;
    }

    const explorerUrl = `${getStellarExpertUrl(network)}/tx/${transactionHash}`;

    openInAppBrowser(explorerUrl).catch((err) =>
      logger.error(
        "EarnProcessingScreen",
        "Error opening transaction explorer",
        err,
      ),
    );
  }, [transactionHash, network, openInAppBrowser]);

  return (
    <BaseLayout insets={{ top: false }}>
      <View className="flex-1 justify-between" testID="earn-processing-screen">
        <View className="flex-1 items-center justify-center">
          <View className="items-center gap-[8px] w-full">
            {getStatusIcon()}

            <View className="mb-2">
              <Display xs medium>
                {getStatusText()}
              </Display>
            </View>

            {/* Triptych (design node `9449:29733`/`9449:29814`): the
             deposit asset's icon, a secondary double-chevron connector, then
             the hub's identity icon — the XOXNO mark, shared with
             `HubCard`, the review sheet, the hub details sheet, and the
             token picker's badge. Sized 40 to match the deposit asset's
             `TokenIcon size="lg"` beside it; the lilac `InfoCircle`
             placeholder it replaces was 28, so the two never matched.
             Rendered for both the submitting and success states — this block
             sits outside the status branch below. */}
            <View className="rounded-[16px] p-[24px] gap-[16px] bg-background-tertiary w-full">
              <View className="flex-row items-center justify-center gap-[16px]">
                {(token ?? depositBalance) && (
                  <TokenIcon token={(token ?? depositBalance)!} size="lg" />
                )}
                <Icon.ChevronRightDouble
                  size={16}
                  color={themeColors.text.secondary}
                />
                <Image
                  source={xoxnoIcon}
                  className="size-10 rounded"
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              </View>

              <View className="items-center">
                <Text
                  xl
                  medium
                  primary
                  textAlign="center"
                  testID="earn-processing-caption"
                >
                  {formatTokenForDisplay(
                    tokenAmount,
                    tokenCode ?? selectedAssetCode,
                  )}
                  <Text xl medium secondary>
                    {` ${
                      isWithdraw
                        ? t("earnProcessing.from")
                        : t("earnProcessing.to")
                    } `}
                  </Text>
                  {contextName ?? hub?.name}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {status === "success" && (
          <View className="gap-[16px]">
            <Text
              sm
              secondary
              textAlign="center"
              testID="earn-processing-updating"
            >
              {t("earnSafety.updatingBalances")}
            </Text>
            {(balancesError || positionsError) && (
              <Text sm secondary>
                {t("earnSafety.refreshFailed")}
              </Text>
            )}
            <Button
              secondary
              disabled={balancesLoading}
              onPress={() => {
                if (account?.publicKey)
                  fetchAccountBalances({
                    publicKey: account.publicKey,
                    network,
                  });
                refreshPositions();
                refreshCatalog();
              }}
              testID="earn-processing-refresh"
            >
              {t("earnSafety.refresh")}
            </Button>
            {transactionHash && (
              <Button
                secondary
                xl
                onPress={handleViewTransaction}
                testID="earn-processing-view-transaction-button"
              >
                {t("earnProcessing.viewTransaction")}
              </Button>
            )}
            <Button
              tertiary
              xl
              onPress={onDone}
              testID="earn-processing-done-button"
            >
              {t("common.done")}
            </Button>
          </View>
        )}

        {status === "submitting" && (
          <View className="gap-[16px]">
            <Text sm medium secondary textAlign="center">
              {t("earnProcessing.closeMessage")}
            </Text>
            <Button
              secondary
              xl
              onPress={onCloseWhileSubmitting}
              testID="earn-processing-close-button"
            >
              {t("common.close")}
            </Button>
          </View>
        )}
      </View>
    </BaseLayout>
  );
};

export default EarnProcessingScreen;
