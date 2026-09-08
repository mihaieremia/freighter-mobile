import {
  Asset as SdkToken,
  Contract,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { AxiosError } from "axios";
import { BigNumber } from "bignumber.js";
import {
  DEFAULT_DECIMALS,
  MINIMUM_CREATE_ACCOUNT_XLM,
  NETWORKS,
  NetworkDetails,
  mapNetworkToNetworkDetails,
} from "config/constants";
import { logger } from "config/logger";
import { PricedBalance } from "config/types";
import { getXoxnoControllerId } from "config/xoxno";
import { XoxnoActionParams, XoxnoDepositTarget } from "config/xoxnoTypes";
import {
  isNativeAssetId,
  isNativeBalance,
  isNativeToken,
  getNativeContractId,
} from "helpers/assetIdentity";
import { isLiquidityPool } from "helpers/balances";
import {
  getPerOperationBaseFeeStroops,
  xlmToStroop,
} from "helpers/formatAmount";
import {
  determineMuxedDestination,
  checkContractMuxedSupport,
} from "helpers/muxedAddress";
import { isContractId } from "helpers/soroban";
import {
  isValidStellarAddress,
  isSameAccount,
  getBaseAccount,
  isMuxedAccount,
} from "helpers/stellar";
import {
  xoxnoAmountToUnits,
  buildXoxnoRepayOp,
  buildXoxnoSupplyOp,
  buildXoxnoWithdrawOp,
} from "helpers/xoxno";
import { t } from "i18next";
import { analytics } from "services/analytics";
import { SimulationTransactionType } from "services/analytics/types";
import { simulateTokenTransfer, simulateTransaction } from "services/backend";
import { buildChangeTrustOperation, stellarSdkServer } from "services/stellar";
import { getXoxnoDepositTarget, getXoxnoEarnOptions } from "services/xoxno";

export interface BuildPaymentTransactionParams {
  tokenAmount: string;
  selectedBalance?: PricedBalance;
  recipientAddress?: string;
  transactionMemo?: string;
  transactionMemoType?: string;
  transactionFee?: string;
  transactionTimeout?: number;
  network?: NETWORKS;
  senderAddress?: string;
}

export interface BuildSwapTransactionParams {
  sourceAmount: string;
  sourceBalance: PricedBalance;
  destinationBalance: PricedBalance;
  path: string[];
  destinationAmount: string;
  destinationAmountMin: string;
  transactionFee?: string;
  transactionTimeout?: number;
  network?: NETWORKS;
  senderAddress?: string;
  /**
   * When present, the builder prepends a `changeTrust` op as op #0 so the
   * trustline and the path payment submit atomically as a single transaction.
   * Used for swaps to a new (non-held) destination token. Pass this only when
   * `destinationToken.requiresTrustline === true` (i.e. the user does not yet hold a
   * trustline for the destination asset).
   */
  includeTrustline?: { tokenCode: string; issuer: string };
}

export interface BuildSendCollectibleParams {
  collectionAddress: string;
  recipientAddress: string;
  transactionMemo?: string;
  transactionFee?: string;
  transactionTimeout?: number;
  tokenId: number;
  network?: NETWORKS;
  senderAddress?: string;
}

interface IValidateTransactionParams {
  senderAddress: string;
  balance: PricedBalance;
  amount: string;
  destination: string;
  fee: string;
  timeout: number;
  skipAmountValidation?: boolean;
}

/**
 * Validates all transaction parameters
 * Returns an error message if any validation fails
 */
export const validateTransactionParams = (
  params: IValidateTransactionParams,
): string | null => {
  const { senderAddress, balance, amount, destination, fee, timeout } = params;
  // Validate amount is positive (skipped for Soroban fee estimation with amount 0)
  if (!params.skipAmountValidation && Number(amount) <= 0) {
    return t("transaction.errors.amountRequired");
  }

  // Validate fee is positive
  if (Number(fee) <= 0) {
    return t("transaction.errors.feeRequired");
  }

  // Validate timeout
  if (timeout <= 0) {
    return t("transaction.errors.timeoutRequired");
  }

  // Check if the recipient address is valid
  if (!isValidStellarAddress(destination)) {
    return t("transaction.errors.invalidRecipientAddress");
  }

  // Prevent sending to self
  if (isSameAccount(senderAddress, destination)) {
    return t("transaction.errors.cannotSendToSelf");
  }

  // Validate sufficient balance
  const transactionAmount = new BigNumber(amount);
  const balanceAmount = new BigNumber(balance.total);

  if (transactionAmount.isGreaterThan(balanceAmount)) {
    return t("transaction.errors.insufficientBalance");
  }

  return null;
};

/**
 * Validates swap transaction parameters
 * Returns an error message if any validation fails
 */
export const validateSwapTransactionParams = (params: {
  sourceBalance: PricedBalance;
  destinationBalance: PricedBalance;
  sourceAmount: string;
  destinationAmount: string;
  fee: string;
  timeout: number;
}): string | null => {
  const {
    sourceBalance,
    destinationBalance,
    sourceAmount,
    destinationAmount,
    fee,
    timeout,
  } = params;

  // Validate amount is positive
  if (Number(sourceAmount) <= 0) {
    return t("transaction.errors.amountRequired");
  }

  // Validate destination amount is positive
  if (Number(destinationAmount) <= 0) {
    return t("transaction.errors.destinationAmountRequired");
  }

  // Validate fee is positive
  if (Number(fee) <= 0) {
    return t("transaction.errors.feeRequired");
  }

  // Validate timeout
  if (timeout <= 0) {
    return t("transaction.errors.timeoutRequired");
  }

  // Validate sufficient balance
  const transactionAmount = new BigNumber(sourceAmount);
  const balanceAmount = new BigNumber(sourceBalance.total);

  if (transactionAmount.isGreaterThan(balanceAmount)) {
    return t("transaction.errors.insufficientBalanceForSwap");
  }

  // Validate different tokens
  if (sourceBalance.id === destinationBalance.id) {
    return t("transaction.errors.cannotSwapSameToken");
  }

  return null;
};

/**
 * Validates send collectible transaction parameters
 * Returns an error message if any validation fails
 */
export const validateSendCollectibleTransactionParams = (params: {
  fee: string;
  timeout: number;
}): string | null => {
  const { fee, timeout } = params;

  // Validate fee is positive
  if (Number(fee) <= 0) {
    return t("transaction.errors.feeRequired");
  }

  // Validate timeout
  if (timeout <= 0) {
    return t("transaction.errors.timeoutRequired");
  }

  return null;
};

/**
 * Gets the appropriate token for payment
 */
export const getTokenForPayment = (balance: PricedBalance): SdkToken => {
  if (isNativeBalance(balance)) {
    return SdkToken.native();
  }

  // For non-native tokens and non-liquidity pools
  if (!isLiquidityPool(balance) && "token" in balance && balance.token) {
    if (
      "type" in balance.token &&
      typeof balance.token.type === "string" &&
      !isNativeToken(balance.token) &&
      "code" in balance.token &&
      "issuer" in balance.token &&
      balance.token.issuer &&
      "key" in balance.token.issuer
    ) {
      return new SdkToken(balance.token.code, balance.token.issuer.key);
    }
  }

  throw new Error("Unsupported token type for payment");
};

/**
 * Returns the native token contract ID for a given network.
 * Derived from the network passphrase so it is correct on every network.
 */
export const getContractIdForNativeToken = (network: NETWORKS): string =>
  getNativeContractId(mapNetworkToNetworkDetails(network).networkPassphrase);

interface IBuildSorobanTransferOperation {
  sourceAccount: string;
  destinationAddress: string;
  amount: string;
  contractId: string; // Contract ID for the token (custom token contractId or native token contractId)
  transactionBuilder: TransactionBuilder;
  memo?: string; // Optional memo for creating muxed address
  contractSupportsMuxed?: boolean; // Whether contract supports muxed addresses
}

/**
 * Builds a Soroban token transfer operation for sending to contract addresses
 * Supports muxed addresses (M... format) for CAP-0067 memo support
 *
 * @param params Transfer operation parameters
 * @returns Final destination address (may be muxed if memo was provided and contract supports it)
 * @note transactionBuilder is mutated in place, so it doesn't need to be returned
 */
const buildSorobanTransferOperation = (
  params: IBuildSorobanTransferOperation,
): string => {
  const {
    sourceAccount,
    destinationAddress,
    amount,
    contractId,
    transactionBuilder,
    memo,
    contractSupportsMuxed = false,
  } = params;

  try {
    const contract = new Contract(contractId);

    // Determine final destination at the very last step - right before building the operation
    const finalDestination = determineMuxedDestination({
      recipientAddress: destinationAddress,
      transactionMemo: memo,
      contractSupportsMuxed,
    });

    const transaction = contract.call(
      "transfer",
      new Address(sourceAccount).toScVal(),
      new Address(finalDestination).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    );

    // transactionBuilder is mutated in place
    transactionBuilder.addOperation(transaction);

    return finalDestination;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Error building Soroban transfer operation: ${errorMessage}`,
    );
  }
};

interface BuildPaymentTransactionResult {
  tx: Transaction;
  xdr: string;
  contractId?: string;
  finalDestination?: string;
  amountInBaseUnits?: string;
}

export const buildPaymentTransaction = async (
  params: BuildPaymentTransactionParams,
): Promise<BuildPaymentTransactionResult> => {
  const {
    tokenAmount: amount,
    selectedBalance,
    recipientAddress,
    transactionMemo: memo,
    transactionMemoType: memoType,
    transactionFee,
    transactionTimeout,
    network,
    senderAddress,
  } = params;
  try {
    if (
      !senderAddress ||
      !network ||
      !selectedBalance ||
      !recipientAddress ||
      !transactionFee ||
      !transactionTimeout
    ) {
      throw new Error("Missing required parameters for building transaction");
    }

    // Soroban fee estimation can use amount 0 — resource fees are
    // independent of the transfer amount. Skip only the amount check;
    // all other validations (fee, timeout, address, balance) still run.
    const isSorobanTransfer =
      (selectedBalance &&
        "contractId" in selectedBalance &&
        Boolean(selectedBalance.contractId)) ||
      isContractId(recipientAddress);

    const validationError = validateTransactionParams({
      senderAddress,
      balance: selectedBalance,
      amount,
      destination: recipientAddress,
      fee: transactionFee,
      timeout: transactionTimeout,
      skipAmountValidation: isSorobanTransfer && Number(amount) === 0,
    });

    if (validationError) {
      throw new Error(validationError);
    }
    const networkDetails = mapNetworkToNetworkDetails(network);
    const server = stellarSdkServer(networkDetails.networkUrl);
    const sourceAccount = await server.loadAccount(senderAddress);
    const fee = xlmToStroop(transactionFee).toString();

    const transactionBuilder = new TransactionBuilder(sourceAccount, {
      fee,
      timebounds: await server.fetchTimebounds(transactionTimeout),
      networkPassphrase: networkDetails.networkPassphrase,
    });

    const isCustomToken =
      selectedBalance &&
      "contractId" in selectedBalance &&
      selectedBalance.contractId;

    const isToContractAddress = isContractId(recipientAddress);
    const shouldUseSorobanTransfer = isToContractAddress || isCustomToken;
    const isRecipientMuxed = isMuxedAccount(recipientAddress);
    // Don't add memo for M addresses (memo is encoded in the address)
    // For normal transactions (non-Soroban), only add memo if recipient is not M address
    // For Soroban transactions, memo handling is done in buildSorobanTransferOperation
    if (memo && !shouldUseSorobanTransfer && !isRecipientMuxed) {
      // Honour the memo type returned by the federation server so that exchange
      // destinations that require memo_type:"id" receive the correct Stellar memo.
      if (memoType === "id") {
        // Memo.id validates numeric range (0..2^64-1); throw on invalid value so
        // the send is aborted rather than silently downgraded to a text memo.
        // A silent downgrade would cause exchange deposits to arrive at the omnibus
        // address without being credited to the user's sub-account.
        if (!/^\d+$/.test(memo)) {
          throw new Error(t("transaction.errors.invalidFederationMemo"));
        }
        try {
          transactionBuilder.addMemo(Memo.id(memo));
        } catch {
          throw new Error(t("transaction.errors.invalidFederationMemo"));
        }
      } else if (memoType === "hash") {
        try {
          const hashBytes = Buffer.from(memo, "base64");
          if (hashBytes.length !== 32) {
            throw new Error(t("transaction.errors.invalidFederationMemo"));
          }
          transactionBuilder.addMemo(Memo.hash(hashBytes));
        } catch (error) {
          throw error instanceof Error
            ? error
            : new Error(t("transaction.errors.invalidFederationMemo"));
        }
      } else {
        transactionBuilder.addMemo(Memo.text(memo));
      }
    }

    if (shouldUseSorobanTransfer) {
      let contractId: string;

      if (isCustomToken) {
        contractId = selectedBalance.contractId;
      } else {
        // The token contract is a property of the ASSET being sent, never of
        // the recipient. For a classic asset that contract is its Stellar
        // Asset Contract, whose address derives deterministically from
        // (code, issuer, network passphrase). Using the recipient here would
        // invoke an arbitrary contract chosen by the destination address and
        // move whichever asset that contract governs, not the selected one.
        const token = getTokenForPayment(selectedBalance);
        contractId = token.isNative()
          ? getContractIdForNativeToken(network)
          : token.contractId(networkDetails.networkPassphrase);
      }

      // Defence in depth against the above being wired wrongly again: a token
      // transferred to its own token contract is credited to the contract's
      // own address, where nothing can ever spend it again — the SAC only
      // moves a balance on `from.require_auth()` and never authorizes on
      // behalf of itself. Refuse rather than build an irreversible burn.
      if (contractId === recipientAddress) {
        throw new Error(t("transaction.errors.recipientIsTokenContract"));
      }

      const contractSupportsMuxed = await checkContractMuxedSupport({
        contractId,
        networkDetails,
      });

      // For custom tokens, use the token's decimals; for native tokens, use DEFAULT_DECIMALS
      // The amount parameter is in human-readable format (e.g., "1.33" for 1.33 tokens)
      // We need to convert it to base units by multiplying by 10^decimals
      let decimals: number;
      if (isCustomToken) {
        // For SorobanBalance, decimals is a required property
        const balanceDecimals =
          "decimals" in selectedBalance ? selectedBalance.decimals : undefined;

        if (
          typeof balanceDecimals === "number" &&
          !Number.isNaN(balanceDecimals) &&
          balanceDecimals >= 0
        ) {
          decimals = balanceDecimals;
        } else {
          // Track error and throw - decimals is required for custom tokens
          const errorMessage = t("transaction.errors.invalidDecimals");
          logger.error(
            "buildPaymentTransaction",
            errorMessage,
            new Error(errorMessage),
          );
          throw new Error(errorMessage);
        }
      } else {
        // For native tokens or non-custom tokens, use DEFAULT_DECIMALS
        decimals = DEFAULT_DECIMALS;
      }

      // Convert human-readable amount to base units
      // Example: 1.33 tokens with 6 decimals = 1.33 * 10^6 = 1,330,000 base units
      const amountInBaseUnits = BigNumber(amount)
        .shiftedBy(decimals)
        .toFixed(0);

      const finalDestination = buildSorobanTransferOperation({
        sourceAccount: senderAddress,
        destinationAddress: recipientAddress,
        amount: amountInBaseUnits,
        contractId,
        transactionBuilder,
        memo,
        contractSupportsMuxed,
      });

      const transaction = transactionBuilder.build();
      const transactionXDR = transaction.toXdr();

      return {
        tx: transaction,
        xdr: transactionXDR,
        contractId,
        finalDestination,
        amountInBaseUnits,
      };
    }

    const token = getTokenForPayment(selectedBalance);
    const paymentDestination = recipientAddress;

    const baseAccount = getBaseAccount(recipientAddress)!;

    if (token.isNative()) {
      try {
        await server.loadAccount(baseAccount);
      } catch (e) {
        const error = e as AxiosError;

        if (error.response && error.response.status === 404) {
          // If destination is unfunded and amount < 1 XLM, let the transaction proceed
          // so Blockaid can flag it as expected-to-fail during review instead of failing early.
          if (BigNumber(amount).isLessThan(MINIMUM_CREATE_ACCOUNT_XLM)) {
            // Skip createAccount and fall through to add a standard payment operation below.
          } else {
            transactionBuilder.addOperation(
              Operation.createAccount({
                destination: baseAccount,
                startingBalance: amount,
              }),
            );

            const transaction = transactionBuilder.build();

            return {
              tx: transaction,
              xdr: transaction.toXdr(),
              finalDestination: recipientAddress,
            };
          }
        } else {
          throw error;
        }
      }
    }

    // If account is funded or asset is not XLM, use standard payment
    transactionBuilder.addOperation(
      Operation.payment({
        destination: paymentDestination,
        asset: token,
        amount,
      }),
    );

    const transaction = transactionBuilder.build();

    return {
      tx: transaction,
      xdr: transaction.toXdr(),
      finalDestination: recipientAddress,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to build payment transaction: ${errorMessage}`);
  }
};

export const buildSwapTransaction = async (
  params: BuildSwapTransactionParams,
): Promise<BuildPaymentTransactionResult> => {
  const {
    sourceAmount,
    sourceBalance,
    destinationBalance,
    path,
    destinationAmount,
    destinationAmountMin,
    transactionFee,
    transactionTimeout,
    network,
    senderAddress,
    includeTrustline,
  } = params;

  try {
    if (!senderAddress || !network || !transactionFee || !transactionTimeout) {
      throw new Error("Missing required parameters for building transaction");
    }

    const validationError = validateSwapTransactionParams({
      sourceBalance,
      destinationBalance,
      sourceAmount,
      destinationAmount,
      fee: transactionFee,
      timeout: transactionTimeout,
    });

    if (validationError) {
      throw new Error(validationError);
    }

    const networkDetails = mapNetworkToNetworkDetails(network);
    const server = stellarSdkServer(networkDetails.networkUrl);
    const sourceAccount = await server.loadAccount(senderAddress);
    // transactionFee is the TOTAL the user set; the SDK fee is per-operation
    // and the network charges baseFee × numOps. Adding a changeTrust op makes
    // this a 2-op tx, so split the total across ops to keep the charged total
    // equal to what the user set/sees.
    const fee = getPerOperationBaseFeeStroops(
      transactionFee,
      includeTrustline ? 2 : 1,
    );

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee,
      timebounds: await server.fetchTimebounds(transactionTimeout),
      networkPassphrase: networkDetails.networkPassphrase,
    });

    const sourceToken = getTokenForPayment(sourceBalance);
    const destToken = getTokenForPayment(destinationBalance);
    const pathTokens = path.map((pathItem) => {
      if (isNativeAssetId(pathItem)) {
        return SdkToken.native();
      }

      const [code, issuer] = pathItem.split(":");

      return new SdkToken(code, issuer);
    });

    // Op ordering is load-bearing: changeTrust must be op #0 so the trustline
    // is established before the path-payment op consumes the destination asset.
    if (includeTrustline) {
      txBuilder.addOperation(
        buildChangeTrustOperation({
          tokenCode: includeTrustline.tokenCode,
          issuer: includeTrustline.issuer,
        }),
      );
    }

    txBuilder.addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: sourceToken,
        sendAmount: sourceAmount,
        destination: senderAddress,
        destAsset: destToken,
        destMin: destinationAmountMin,
        path: pathTokens,
      }),
    );

    const transaction = txBuilder.build();
    return { tx: transaction, xdr: transaction.toXdr() };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to build swap transaction: ${errorMessage}`);
  }
};

interface BuildSendCollectibleTransactionResult {
  tx: Transaction;
  xdr: string;
  finalDestination?: string;
}

/**
 * Builds a collectible transfer transaction
 */
export const buildSendCollectibleTransaction = async (
  params: BuildSendCollectibleParams,
): Promise<BuildSendCollectibleTransactionResult> => {
  const {
    collectionAddress,
    transactionFee,
    transactionTimeout,
    tokenId,
    network,
    recipientAddress,
    senderAddress,
    transactionMemo,
  } = params;

  try {
    if (!senderAddress || !network || !transactionFee || !transactionTimeout) {
      throw new Error("Missing required parameters for building transaction");
    }

    const validationError = validateSendCollectibleTransactionParams({
      fee: transactionFee,
      timeout: transactionTimeout,
    });

    if (validationError) {
      throw new Error(validationError);
    }

    const networkDetails = mapNetworkToNetworkDetails(network);
    const server = stellarSdkServer(networkDetails.networkUrl);
    const sourceAccount = await server.loadAccount(senderAddress);
    const fee = xlmToStroop(transactionFee).toString();
    const contract = new Contract(collectionAddress);

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee,
      timebounds: await server.fetchTimebounds(transactionTimeout),
      networkPassphrase: networkDetails.networkPassphrase,
    });

    const contractSupportsMuxed = await checkContractMuxedSupport({
      contractId: collectionAddress,
      networkDetails,
    });

    const finalDestination = determineMuxedDestination({
      recipientAddress,
      transactionMemo,
      contractSupportsMuxed,
    });

    const transferParams = [
      new Address(senderAddress).toScVal(), // from
      new Address(finalDestination).toScVal(), // to
      xdr.ScVal.scvU32(tokenId), // token_id
    ];

    txBuilder.addOperation(contract.call("transfer", ...transferParams));

    const transaction = txBuilder.build();

    return {
      tx: transaction,
      xdr: transaction.toXdr(),
      finalDestination,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to build send collectible transaction: ${errorMessage}`,
    );
  }
};

interface SimulateContractTransferParams {
  transaction: Transaction;
  networkDetails: NetworkDetails;
  memo: string;
  fee?: string;
  params: {
    publicKey: string;
    destination: string;
    amount: string;
  };
  contractAddress: string;
}

export const simulateContractTransfer = async ({
  transaction,
  networkDetails,
  memo,
  fee,
  params,
  contractAddress,
}: SimulateContractTransferParams) => {
  if (!transaction.source) {
    throw new Error("Transaction source is not defined");
  }

  if (!networkDetails.sorobanRpcUrl) {
    throw new Error("Soroban RPC URL is not defined for this network");
  }

  try {
    // Follow the extension pattern: use /simulate-token-transfer which
    // builds and simulates the transaction on the backend.
    const result = await simulateTokenTransfer({
      address: contractAddress,
      pub_key: transaction.source,
      memo, // This may be redundant if destination is muxed, but kept for compatibility
      fee: fee ? xlmToStroop(fee).toString() : undefined,
      params,
      network_url: networkDetails.sorobanRpcUrl,
      network_passphrase: networkDetails.networkPassphrase,
    });

    // Use the preparedTransaction XDR directly from the backend
    // The backend builds, simulates, and prepares the transaction
    return {
      preparedTransaction: result.preparedTransaction,
      minResourceFee: result.simulationResponse?.minResourceFee,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    analytics.trackSimulationError(
      errorMessage,
      SimulationTransactionType.ContractTransfer,
    );

    throw error;
  }
};

interface SimulateCollectibleTransferParams {
  transactionXdr: string;
  networkDetails: NetworkDetails;
  analyticsCategory?: SimulationTransactionType;
}

export const simulateCollectibleTransfer = async ({
  transactionXdr,
  networkDetails,
  analyticsCategory = SimulationTransactionType.CollectibleTransfer,
}: SimulateCollectibleTransferParams) => {
  if (!networkDetails.sorobanRpcUrl) {
    throw new Error("Soroban RPC URL is not defined for this network");
  }

  try {
    const result = await simulateTransaction({
      xdr: transactionXdr,
      network_url: networkDetails.sorobanRpcUrl,
      network_passphrase: networkDetails.networkPassphrase,
    });

    return {
      preparedTransaction: result.preparedTransaction,
      minResourceFee: result.simulationResponse?.minResourceFee,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    analytics.trackSimulationError(errorMessage, analyticsCategory);
    throw error;
  }
};

interface BuildXoxnoDepositParams extends XoxnoActionParams {
  /** The hub the asset is listed in. */
  hubId: number;
  /** The spoke a new position would open in. */
  spokeId: number;
  /** Every spoke that accepts this asset, including `spokeId`. */
  acceptingSpokeIds: number[];
}

interface BuildXoxnoTransactionResult {
  depositTarget?: XoxnoDepositTarget;
  xdr: string;
  preparedXdr: string;
  /**
   * Resource fee in stroops reported by simulation, or `null` when the
   * simulation response omits it. `SorobanSimulationResponse.minResourceFee`
   * is optional; a missing value is left unknown here rather than coerced to
   * "0" — a zero resource fee would understate the real cost and is
   * indistinguishable from a genuine zero. Callers render this as "fee
   * unavailable" rather than a real number.
   */
  minResourceFee: string | null;
  /**
   * The inclusion fee actually bid, in XLM — the caller's, floored. Returned
   * rather than re-derived by the caller so the store records the fee this
   * transaction was signed with instead of the one that was asked for.
   */
  inclusionFeeXlm: string;
}

/**
 * The least this app will bid to have a lending invocation included.
 *
 * The fee on a Stellar transaction is a maximum, not a price: the network
 * charges the market rate and keeps the difference nowhere, so bidding above
 * the base fee costs nothing while the network is quiet and buys inclusion
 * while it is busy. The protocol floor of 100 stroops is what a transaction
 * offers when nothing has told it otherwise, and it is routinely outbid — a
 * lending withdrawal refused with tx_insufficient_fee is what prompted this.
 *
 * The network's own recommendation still wins whenever it is higher; this is
 * only the point below which we will not go.
 */
const EARN_MIN_INCLUSION_FEE_XLM = "0.00005";

/**
 * Builds and simulates one XOXNO controller invocation.
 *
 * The three entry points differ only in the operation they carry and what
 * they call a failure, so everything around that — the controller lookup, the
 * account load, the inclusion-fee-only envelope and the simulation — lives
 * here once.
 *
 * The account is loaded from Horizon rather than soroban-rpc: the app does not
 * call Soroban RPC directly, which is why simulation goes through the v1
 * backend's `/simulate-tx` proxy.
 */
const buildXoxnoTransaction = async ({
  senderAddress,
  network,
  transactionFee,
  transactionTimeout,
  buildOp,
  simulationErrorMessage,
}: Pick<
  XoxnoActionParams,
  "senderAddress" | "network" | "transactionFee" | "transactionTimeout"
> & {
  /** The controller call this transaction carries. */
  buildOp: (args: {
    controllerId: string;
    networkDetails: NetworkDetails;
  }) => Promise<xdr.Operation> | xdr.Operation;
  simulationErrorMessage: string;
}): Promise<BuildXoxnoTransactionResult> => {
  const networkDetails = mapNetworkToNetworkDetails(network);

  const controllerId = getXoxnoControllerId(networkDetails);
  if (!controllerId) {
    throw new Error(t("transaction.errors.earnNotSupported"));
  }
  if (!networkDetails.sorobanRpcUrl) {
    throw new Error(t("transaction.errors.sorobanRpcMissing"));
  }

  const server = stellarSdkServer(networkDetails.networkUrl);
  const sourceAccount = await server.loadAccount(senderAddress);

  const inclusionFeeXlm = BigNumber.max(
    transactionFee,
    EARN_MIN_INCLUSION_FEE_XLM,
  ).toFixed();

  const builtTx = new TransactionBuilder(sourceAccount, {
    // Inclusion fee only — the prepared transaction carries the resource fee
    // once simulation reports it — and never below the floor above.
    fee: xlmToStroop(inclusionFeeXlm).toString(),
    networkPassphrase: networkDetails.networkPassphrase,
  })
    .addOperation(await buildOp({ controllerId, networkDetails }))
    // A finite timeout, unlike the token-transfer helpers' TimeoutInfinite: a
    // deposit priced against a live APY should expire rather than sit signable.
    .setTimeout(transactionTimeout)
    .build();

  const simulation = await simulateTransaction({
    xdr: builtTx.toXDR(),
    network_url: networkDetails.sorobanRpcUrl,
    network_passphrase: networkDetails.networkPassphrase,
  });

  if (!simulation?.preparedTransaction) {
    // A 200 with no prepared transaction is the contract rejecting the call —
    // an insolvent position, a frozen market, a supply cap. Its diagnostic is
    // the only explanation the user gets, so it is surfaced verbatim.
    throw new Error(
      simulation?.simulationResponse?.error || simulationErrorMessage,
    );
  }

  return {
    xdr: builtTx.toXDR(),
    preparedXdr: simulation.preparedTransaction,
    minResourceFee: simulation.simulationResponse?.minResourceFee ?? null,
    inclusionFeeXlm,
  };
};

/**
 * Builds and simulates a XOXNO deposit — `controller.supply` with one
 * `(hub, asset)` entry.
 *
 * The position to credit is resolved here rather than passed in: `supply`
 * needs an account id and a risk spoke, and building against a stale or absent
 * one would be rejected on chain. `getXoxnoDepositTarget` reuses the account
 * already supplying this market, falls back to any account in the pinned
 * spoke, and otherwise passes "0" to open a fresh position.
 *
 * Returns the prepared (assembled) XDR ready to sign, plus `minResourceFee` so
 * callers can render the fee breakdown.
 *
 * The account is loaded from Horizon rather than soroban-rpc: the app does not
 * call Soroban RPC directly, which is why simulation goes through the v1
 * backend's `/simulate-tx` proxy.
 */
export const buildXoxnoDepositTransaction = async ({
  senderAddress,
  hubId,
  spokeId,
  acceptingSpokeIds,
  assetId,
  amount,
  decimals,
  network,
  transactionFee,
  transactionTimeout,
}: BuildXoxnoDepositParams): Promise<BuildXoxnoTransactionResult> => {
  let depositTarget: XoxnoDepositTarget | undefined;
  const result = await buildXoxnoTransaction({
    senderAddress,
    network,
    transactionFee,
    transactionTimeout,
    simulationErrorMessage: t("transaction.errors.simulateDepositFailed"),
    buildOp: async ({ controllerId, networkDetails }) => {
      const options = await getXoxnoEarnOptions({ networkDetails });
      const current = options.find((option) => option.assetId === assetId);
      const spoke = current?.offers
        .find((offer) => offer.hubId === hubId)
        ?.spokes.find((entry) => entry.id === spokeId);
      if (
        !spoke ||
        current?.decimals !== decimals ||
        !acceptingSpokeIds.includes(spokeId)
      )
        throw new Error(t("earnSafety.listingChanged"));
      const target = await getXoxnoDepositTarget({
        publicKey: senderAddress,
        hubId,
        assetId,
        spokeId,
        acceptingSpokeIds,
        networkDetails,
      });

      depositTarget = target;
      return buildXoxnoSupplyOp({
        controllerId,
        publicKey: senderAddress,
        accountId: target.accountId,
        spokeId: target.spokeId,
        hubId,
        assetId,
        amount: xoxnoAmountToUnits(amount, decimals),
      });
    },
  });
  return { ...result, depositTarget };
};

interface BuildXoxnoWithdrawParams extends XoxnoActionParams {
  /** The position NFT to withdraw from. */
  accountId: string;
  hubId: number;
  /**
   * True when the user asked for the whole leg. The contract reads amount 0
   * as "withdraw everything", which is the only way to empty a leg exactly:
   * a supply balance accrues with the index between this build and the
   * ledger that executes it, so a figure computed here is already stale.
   */
  withdrawAll: boolean;
}

/**
 * Builds and simulates a XOXNO withdrawal — `controller.withdraw` of one
 * `(hub, asset)` leg, paid back to the position's owner.
 *
 * Unlike a deposit, the position is not resolved here: a withdrawal names an
 * account the caller already holds, and the positions list the user picked
 * from supplies it. Withdrawing more than the leg holds, or enough to make
 * the position insolvent, is rejected in simulation and surfaces as the
 * contract's own error.
 */
export const buildXoxnoWithdrawTransaction = async ({
  senderAddress,
  accountId,
  hubId,
  assetId,
  amount,
  decimals,
  withdrawAll,
  network,
  transactionFee,
  transactionTimeout,
}: BuildXoxnoWithdrawParams): Promise<BuildXoxnoTransactionResult> =>
  buildXoxnoTransaction({
    senderAddress,
    network,
    transactionFee,
    transactionTimeout,
    simulationErrorMessage: t("transaction.errors.simulateWithdrawFailed"),
    buildOp: ({ controllerId }) =>
      buildXoxnoWithdrawOp({
        controllerId,
        publicKey: senderAddress,
        accountId,
        hubId,
        assetId,
        amount: withdrawAll ? "0" : xoxnoAmountToUnits(amount, decimals),
      }),
  });

interface BuildXoxnoRepayParams extends XoxnoActionParams {
  accountId: string;
  hubId: number;
}

/**
 * Builds and simulates a XOXNO repayment — `controller.repay` of one
 * `(hub, asset)` debt leg, paid from the caller's own balance.
 *
 * Repaying more than is owed is safe and is how a debt is cleared exactly:
 * the pool refunds the excess to the payer within the same transaction. The
 * screen relies on that when the wallet can cover it, because a debt left at
 * a few units still blocks a full withdrawal.
 */
export const buildXoxnoRepayTransaction = async ({
  senderAddress,
  accountId,
  hubId,
  assetId,
  amount,
  decimals,
  network,
  transactionFee,
  transactionTimeout,
}: BuildXoxnoRepayParams): Promise<BuildXoxnoTransactionResult> =>
  buildXoxnoTransaction({
    senderAddress,
    network,
    transactionFee,
    transactionTimeout,
    simulationErrorMessage: t("transaction.errors.simulateRepayFailed"),
    buildOp: ({ controllerId }) =>
      buildXoxnoRepayOp({
        controllerId,
        publicKey: senderAddress,
        accountId,
        hubId,
        assetId,
        amount: xoxnoAmountToUnits(amount, decimals),
      }),
  });
