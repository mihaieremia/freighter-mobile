import Blockaid from "@blockaid/client";
import {
  Address,
  Transaction,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { mapNetworkToNetworkDetails } from "config/constants";
import { Balance } from "config/types";
import { getXoxnoControllerId } from "config/xoxno";
import { XoxnoActionParams } from "config/xoxnoTypes";
import { calculateSpendableAmount } from "helpers/balances";
import { stroopToXlm } from "helpers/formatAmount";
import { getNativeContractDetails } from "helpers/soroban";
import { buildXoxnoAssetEntries, xoxnoAmountToUnits } from "helpers/xoxno";
import { t } from "i18next";

export type EarnAction = "deposit" | "withdraw" | "repay";
export type EarnReviewParams = XoxnoActionParams & {
  hubId: number;
  accountId?: string;
  spokeId?: number;
  withdrawAll?: boolean;
};

/**
 * The shape of each action's controller call, stated once. Everything that
 * differs between the three — the method, where its arguments sit, what it
 * permits — is an entry here, so adding an action is one entry rather than a
 * new `action ===` branch at every point that differs.
 */
export const EARN_CALLS: Record<
  EarnAction,
  {
    /** The controller method the action invokes. */
    method: string;
    /** Argument position of the (hub, asset, amount) entries vector. */
    entriesIndex: number;
    /** Argument position of the risk spoke, when the call names one. */
    spokeIndex?: number;
    /** Argument position of the payout recipient, when the call names one. */
    recipientIndex?: number;
    /** Only a withdrawal reads amount 0 as "the whole leg". */
    allowsWithdrawAll: boolean;
    /** Only a deposit is built against a resolved position target. */
    usesDepositTarget: boolean;
  }
> = {
  deposit: {
    method: "supply",
    entriesIndex: 3,
    spokeIndex: 2,
    allowsWithdrawAll: false,
    usesDepositTarget: true,
  },
  withdraw: {
    method: "withdraw",
    entriesIndex: 2,
    recipientIndex: 3,
    allowsWithdrawAll: true,
    usesDepositTarget: false,
  },
  repay: {
    method: "repay",
    entriesIndex: 2,
    allowsWithdrawAll: false,
    usesDepositTarget: false,
  },
};

/** What the envelope alone establishes, before anything the screen adds. */
export interface VerifiedEarnCall {
  action: EarnAction;
  params: EarnReviewParams;
  accountId: string;
  amountUnits: string;
  preparedXdr: string;
  requestId: string;
  expiresAt: number;
  feeXlm: string;
}

export interface PreparedEarnReview extends VerifiedEarnCall {
  assetCode: string;
  positionBeforeTokens: string;
  apy: number | null;
  scanResult: Blockaid.StellarTransactionScanResponse | undefined;
}

/** Verify the actual operation before describing it or permitting signing. */
export const prepareEarnReview = (
  action: EarnAction,
  params: EarnReviewParams,
  preparedXdr: string,
  requestId: string,
): VerifiedEarnCall => {
  const network = mapNetworkToNetworkDetails(params.network);
  const tx = TransactionBuilder.fromXDR(preparedXdr, network.networkPassphrase);
  if (
    !(tx instanceof Transaction) ||
    tx.source !== params.senderAddress ||
    tx.operations.length !== 1 ||
    tx.operations[0].type !== "invokeHostFunction"
  ) {
    throw new Error(t("earnSafety.envelopeMismatch"));
  }
  const { func } = tx.operations[0];
  if (func.type !== "hostFunctionTypeInvokeContract")
    throw new Error(t("earnSafety.envelopeMismatch"));
  const invocation = func.invokeContract;
  const rawArgs = invocation.args;
  const args = rawArgs.map(scValToNative);
  const call = EARN_CALLS[action];
  const accountId = String(args[1]);
  const units =
    call.allowsWithdrawAll && params.withdrawAll
      ? "0"
      : xoxnoAmountToUnits(params.amount, params.decimals);
  // The asset, hub and amount are compared as the bytes the app would have
  // encoded, not as decoded JavaScript. `scValToNative` turns the contract's
  // struct into an object whose keys depend on the SDK build, and on the
  // device that projection did not survive: a correct transaction failed the
  // asset check on every attempt. The bytes are the thing that must match.
  const expectedEntries = buildXoxnoAssetEntries(
    params.hubId,
    params.assetId,
    units,
  ).toXDR("base64");
  // Checked field by field rather than as one boolean: when this fires the
  // only useful thing to know is WHICH part of the built call disagreed with
  // the screen, and a single combined condition threw that away.
  const checks: [field: string, ok: boolean][] = [
    ["function", invocation.functionName.toString() === call.method],
    [
      "contract",
      Address.fromScAddress(invocation.contractAddress).toString() ===
        getXoxnoControllerId(network),
    ],
    ["caller", args[0] === params.senderAddress],
    [
      "position",
      params.accountId === undefined || accountId === params.accountId,
    ],
    [
      "spoke",
      call.spokeIndex === undefined ||
        Number(args[call.spokeIndex]) === params.spokeId,
    ],
    [
      "entries",
      rawArgs[call.entriesIndex]?.toXDR("base64") === expectedEntries,
    ],
    [
      "recipient",
      call.recipientIndex === undefined ||
        args[call.recipientIndex] === params.senderAddress,
    ],
  ];
  const mismatch = checks.find(([, ok]) => !ok);
  if (mismatch) {
    // The field name is appended rather than translated: it names the part of
    // the call that disagreed, which is for whoever reads the report.
    throw new Error(
      `${String(t("earnSafety.operationMismatch"))} (${String(mismatch[0])})`,
    );
  }
  const expiresAt = Number(tx.timeBounds?.maxTime ?? 0) * 1000;
  const fee = stroopToXlm(tx.fee);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    !fee.isFinite() ||
    fee.lte(0)
  ) {
    throw new Error(t("earnSafety.expired"));
  }
  return {
    action,
    params: { ...params },
    accountId,
    amountUnits: units,
    preparedXdr,
    requestId,
    expiresAt,
    feeXlm: fee.toFixed(),
  };
};

export const assertEarnFeeAffordable = (
  review: VerifiedEarnCall,
  balance: Balance | undefined,
  subentryCount: number,
) => {
  const spendable = balance
    ? calculateSpendableAmount({ balance, subentryCount, transactionFee: "0" })
    : new BigNumber(0);
  const nativeOutgoing =
    review.action !== "withdraw" &&
    review.params.assetId ===
      getNativeContractDetails(review.params.network).contract
      ? new BigNumber(review.amountUnits).shiftedBy(-review.params.decimals)
      : new BigNumber(0);
  if (
    !spendable.isFinite() ||
    spendable.minus(nativeOutgoing).lt(review.feeXlm)
  ) {
    throw new Error(t("earnSafety.insufficientFee"));
  }
};
