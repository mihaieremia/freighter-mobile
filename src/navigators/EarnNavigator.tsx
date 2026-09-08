/* eslint-disable react/no-unstable-nested-components */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CustomHeaderButton } from "components/layout/CustomHeaderButton";
import CustomNavigationHeader from "components/layout/CustomNavigationHeader";
import {
  EarnAmountScreen,
  EarnPositionsScreen,
  EarnRepayScreen,
  EarnTokenPickerScreen,
  EarnWithdrawScreen,
} from "components/screens/EarnScreen/screens";
import Icon from "components/sds/Icon";
import { EARN_ROUTES, EarnStackParamList } from "config/routes";
import { useAuthenticationStore } from "ducks/auth";
import { useEarnStore } from "ducks/earn";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { useTransactionSettingsStore } from "ducks/transactionSettings";
import { getScreenOptionsWithCustomHeader } from "helpers/navigationOptions";
import useAppTranslation from "hooks/useAppTranslation";
import { clearNetworkFeesCache, useNetworkFees } from "hooks/useNetworkFees";
import { usePricedBalancesPolling } from "hooks/usePricedBalancesPolling";
import React, { useEffect } from "react";

const EarnStack = createNativeStackNavigator<EarnStackParamList>();

export const EarnStackNavigator = () => {
  const { t } = useAppTranslation();
  const { account, network } = useAuthenticationStore();
  usePricedBalancesPolling({
    publicKey: account?.publicKey ?? "",
    network,
    refreshOnFocus: true,
  });

  // Prewarm the network-fee snapshot on flow entry so the amount screen and
  // review read frozen values from cache rather than fetching (and flickering)
  // on open. Same rationale as SwapNavigator.
  useNetworkFees();

  // Every exit clears Earn selection, prepared transactions and shared fee settings.
  useEffect(
    () => () => {
      useTransactionSettingsStore.getState().resetSettings();
      useTransactionBuilderStore.getState().resetTransaction();
      useEarnStore.getState().resetEarn();
      clearNetworkFeesCache();
    },
    [],
  );

  return (
    <EarnStack.Navigator
      key={`${account?.publicKey}:${network}`}
      initialRouteName={EARN_ROUTES.EARN_POSITIONS_SCREEN}
      screenOptions={{
        header: (props) => <CustomNavigationHeader {...props} />,
      }}
    >
      {/* The flow opens on what the account already holds: a wallet with a
          position lands on it, and one without lands on its empty state,
          whose only action is the same Deposit button that leads into the
          picker below.

          Headed like every other screen in the app — centred title, close
          button on the left — rather than drawing its own, so it sits at the
          same height and reads the same as Send, Swap and Add funds. */}
      <EarnStack.Screen
        name={EARN_ROUTES.EARN_POSITIONS_SCREEN}
        component={EarnPositionsScreen}
        options={{
          ...getScreenOptionsWithCustomHeader(t("earnPositions.heading")),
          headerLeft: () => <CustomHeaderButton icon={Icon.X} />,
        }}
      />
      {/* Headed like the rest of the app. The screen turns the header off
          for the two full-screen views it renders inline — the first-run
          intro and the swap's processing step — which own the whole surface
          and carry their own close. */}
      <EarnStack.Screen
        name={EARN_ROUTES.EARN_TOKEN_PICKER_SCREEN}
        component={EarnTokenPickerScreen}
        options={{
          ...getScreenOptionsWithCustomHeader(t("earnTokenPicker.heading")),
          headerLeft: () => <CustomHeaderButton icon={Icon.X} />,
        }}
      />
      <EarnStack.Screen
        name={EARN_ROUTES.EARN_AMOUNT_SCREEN}
        component={EarnAmountScreen}
        // Design `9448:29091` calls for a back arrow here, not the X the
        // picker route above gets from `getScreenBottomNavigateOptions`.
        // `getScreenOptionsWithCustomHeader` sets no `headerLeft` override,
        // so `CustomNavigationHeader` falls back to its own default --
        // `<CustomHeaderButton position="left" />`, i.e. `Icon.ArrowLeft` +
        // `navigation.goBack()` -- an existing, general (not Earn-specific)
        // back-arrow variant rather than a new one-off helper.
        // Titled with the asset the user picked one screen back, so the
        // header says which deposit this is rather than repeating the
        // flow's name.
        options={({ route }) =>
          getScreenOptionsWithCustomHeader(
            t("earnAmount.titleWithToken", {
              tokenCode: route.params.tokenCode,
            }),
          )
        }
      />
      <EarnStack.Screen
        name={EARN_ROUTES.EARN_WITHDRAW_SCREEN}
        component={EarnWithdrawScreen}
        options={({ route }) =>
          getScreenOptionsWithCustomHeader(
            t("earnWithdraw.titleWithToken", {
              tokenCode: route.params.tokenCode,
            }),
          )
        }
      />
      <EarnStack.Screen
        name={EARN_ROUTES.EARN_REPAY_SCREEN}
        component={EarnRepayScreen}
        options={({ route }) =>
          getScreenOptionsWithCustomHeader(
            t("earnRepay.titleWithToken", {
              tokenCode: route.params.tokenCode,
            }),
          )
        }
      />
    </EarnStack.Navigator>
  );
};
