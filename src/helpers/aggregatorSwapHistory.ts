import { Horizon, TransactionBuilder } from "@stellar/stellar-sdk";
import { decodeSwapEnvelope } from "@xoxno/stellar-swap";
import BigNumber from "bignumber.js";
import { NetworkDetails } from "config/constants";
import { TokenTypeWithCustomToken, BalanceMap } from "config/types";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { useTokenIconsStore } from "ducks/tokenIcons";
import { getNativeContractId } from "helpers/assetIdentity";
import { getCatalogContractId, getCatalogIconUrl } from "helpers/tokenCatalog";

const getCatalog = (network: NetworkDetails["network"]) =>
  useTokenCatalogStore.getState().byNetwork[network]?.byContractId;
const classicAssetType = (code: string) =>
  code.length <= 4
    ? TokenTypeWithCustomToken.CREDIT_ALPHANUM4
    : TokenTypeWithCustomToken.CREDIT_ALPHANUM12;

/** Horizon TOID encodes the one-based operation order in its low 12 bits. */
export const getHistoryOperationIndex = (
  operation: Horizon.ServerApi.OperationRecord,
  networkPassphrase: string,
): number | null => {
  const record = operation as Horizon.ServerApi.OperationRecord & {
    operation_index?: number;
    operationIndex?: number;
    transaction_attr?: { envelope_xdr?: string };
  };
  const explicit = record.operation_index ?? record.operationIndex;
  if (explicit !== undefined)
    return Number.isSafeInteger(explicit) && explicit >= 0 ? explicit : null;
  if (/^[1-9][0-9]*$/.test(record.id)) {
    const order = Number(BigInt(record.id) % 4096n);
    if (order > 0) return order - 1;
  }
  try {
    const tx = TransactionBuilder.fromXDR(
      record.transaction_attr?.envelope_xdr ?? "",
      networkPassphrase,
    );
    const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
    return inner.operations.length === 1 ? 0 : null;
  } catch {
    return null;
  }
};

/** Cached display metadata only; no token or receipt request on the list path. */
export const getCachedSwapToken = (
  contractId: string,
  networkDetails: NetworkDetails,
  accountBalances: BalanceMap,
) => {
  const entry = getCatalog(networkDetails.network)?.[contractId];
  const balanceEntry = Object.entries(accountBalances).find(
    ([id]) =>
      getCatalogContractId(id, networkDetails.networkPassphrase) === contractId,
  );
  const balance = balanceEntry?.[1];
  const native =
    contractId === getNativeContractId(networkDetails.networkPassphrase);
  const classic = balance && "token" in balance && !("contractId" in balance);
  let code = entry?.code || contractId;
  if (!entry?.code && balance && "token" in balance) code = balance.token.code;
  if (!entry?.code && balance && "symbol" in balance) code = balance.symbol;
  if (native) code = "XLM";
  let issuer = native ? undefined : contractId;
  if (classic && "issuer" in balance.token) issuer = balance.token.issuer.key;
  const decimals =
    native || classic
      ? 7
      : (entry?.decimals ??
        (balance && "decimals" in balance ? balance.decimals : undefined));
  let type = TokenTypeWithCustomToken.CUSTOM_TOKEN;
  if (classic) type = classicAssetType(code);
  if (native) type = TokenTypeWithCustomToken.NATIVE;
  const icon = useTokenIconsStore.getState().icons[`${code}:${issuer ?? ""}`];
  return {
    code,
    issuer,
    decimals:
      decimals !== undefined &&
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 255
        ? decimals
        : undefined,
    type,
    iconUrl:
      (entry && getCatalogIconUrl(entry)) ||
      (icon?.network === networkDetails.network
        ? icon.lastValidImageUrl || icon.imageUrl
        : undefined),
  };
};

export const toAggregatorSwapOperation = ({
  operation,
  publicKey,
  networkDetails,
  accountBalances,
}: {
  operation: Horizon.ServerApi.OperationRecord;
  publicKey: string;
  networkDetails: NetworkDetails;
  accountBalances: BalanceMap;
}): Record<string, unknown> | null => {
  if (operation.transaction_successful === false) return null;
  const record = operation as Horizon.ServerApi.OperationRecord & {
    transaction_attr?: { envelope_xdr?: string };
  };
  const operationIndex = getHistoryOperationIndex(
    operation,
    networkDetails.networkPassphrase,
  );
  if (operationIndex === null) return null;
  const call = decodeSwapEnvelope({
    envelopeXdr: record.transaction_attr?.envelope_xdr ?? "",
    networkPassphrase: networkDetails.networkPassphrase,
    viewer: publicKey,
    operationIndex,
  });
  if (!call) return null;
  const sent = getCachedSwapToken(
    call.tokenIn,
    networkDetails,
    accountBalances,
  );
  const received = getCachedSwapToken(
    call.tokenOut,
    networkDetails,
    accountBalances,
  );
  return {
    ...operation,
    source_amount:
      sent.decimals === undefined
        ? call.amountInAtoms
        : new BigNumber(call.amountInAtoms).shiftedBy(-sent.decimals).toFixed(),
    source_asset_code: sent.code,
    source_asset_issuer: sent.issuer,
    source_asset_type: sent.type,
    source_icon_url: sent.iconUrl,
    amount: "",
    asset_code: received.code,
    asset_issuer: received.issuer,
    asset_type: received.type,
    icon_url: received.iconUrl,
    swapReceipt: {
      network: networkDetails.network,
      transactionHash: operation.transaction_hash,
      viewer: publicKey,
      operationIndex,
      tokenIn: call.tokenIn,
      tokenOut: call.tokenOut,
      sourceAtoms: call.amountInAtoms,
      sourceDecimals: sent.decimals,
      destinationDecimals: received.decimals,
    },
  };
};
