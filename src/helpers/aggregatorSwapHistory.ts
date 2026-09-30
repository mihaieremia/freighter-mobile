import { Horizon, TransactionBuilder } from "@stellar/stellar-sdk";
import { decodeStellarSwapEnvelope } from "@xoxno/sdk-js/stellar-swap";
import BigNumber from "bignumber.js";
import { AssetDiffSummary } from "components/screens/HistoryScreen/types";
import { NETWORKS, NetworkDetails } from "config/constants";
import { LIFI_SWAP_ROUTER } from "config/lifiSwap";
import { TokenTypeWithCustomToken, BalanceMap } from "config/types";
import { XOXNO_SWAP_ROUTER } from "config/xoxnoSwap";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { useTokenIconsStore } from "ducks/tokenIcons";
import { getNativeContractId } from "helpers/assetIdentity";
import { readLifiSwap } from "helpers/lifiSwap";
import { getInvokedContract } from "helpers/soroban";
import { getCatalogContractId, getCatalogIconUrl } from "helpers/tokenCatalog";
import { getReceivedTokenAmountFromMeta } from "helpers/transactionResult";
import { getTokenDetails } from "services/backend";
import { fetchTransactionMeta } from "services/stellarExpert";

const CLASSIC_ASSET_TYPE_SHORT_CODE_MAX_LENGTH = 4;

/**
 * Received amounts read from a transaction's events, by transaction, output
 * token and viewer. A transaction is immutable, so a hit never goes stale;
 * lookups that fail are not stored and retry on the next refresh.
 */
const receivedAmountCache = new Map<string, bigint>();

/** What a router `execute_strategy` call says about the swap it makes. */
interface RouterSwapCall {
  /** The account the router takes the input from and pays the output to. */
  sender: string;
  /** The input amount, in the input token's base units. */
  amountIn: bigint;
  /** Contract id of the token sold. */
  tokenIn: string;
  /** Contract id of the token bought. */
  tokenOut: string;
}

/** One side of a swap, as the swap history row reads it. */
interface SwapLeg {
  code: string;
  /** The issuer of a classic asset, the contract id of a Soroban token, null for XLM. */
  issuer: string | null;
  type: TokenTypeWithCustomToken;
  /** Decimal amount; null when it cannot be known. */
  amount: string | null;
  iconUrl?: string;
}

interface TokenMeta {
  code: string;
  decimals: number;
  iconUrl?: string;
}

type Catalog = ReturnType<typeof getCatalog>;

interface SwapContext {
  network: NetworkDetails["network"];
  networkPassphrase: string;
  publicKey: string;
  catalog: Catalog;
}

const getCatalog = (network: NetworkDetails["network"]) =>
  useTokenCatalogStore.getState().byNetwork[network]?.byContractId;

const classicAssetType = (assetCode: string) =>
  assetCode.length <= CLASSIC_ASSET_TYPE_SHORT_CODE_MAX_LENGTH
    ? TokenTypeWithCustomToken.CREDIT_ALPHANUM4
    : TokenTypeWithCustomToken.CREDIT_ALPHANUM12;

const toDecimalAmount = (raw: bigint, decimals: number): string =>
  new BigNumber(raw.toString()).shiftedBy(-decimals).toFixed();

/**
 * The LI.FI swap a history operation makes, read from its envelope.
 * XOXNO recognition uses the synchronous SDK path below.
 */
const readRouterSwapCall = (
  operation: Horizon.ServerApi.OperationRecord,
  networkDetails: NetworkDetails,
): RouterSwapCall | null => {
  const invoked = getInvokedContract(operation, networkDetails);
  if (
    networkDetails.network === NETWORKS.PUBLIC &&
    invoked?.contractId === LIFI_SWAP_ROUTER &&
    invoked.fnName === "swap"
  ) {
    return readLifiSwap(invoked.args);
  }
  return null;
};

/**
 * Symbol and decimals of a token contract: the catalog first, then the
 * backend's token details. Null when neither knows the contract.
 */
const resolveTokenMeta = async (
  contractId: string,
  { network, publicKey, catalog }: SwapContext,
): Promise<TokenMeta | null> => {
  const entry = catalog?.[contractId];
  if (entry) {
    return {
      code: entry.code,
      decimals: entry.decimals,
      iconUrl: getCatalogIconUrl(entry),
    };
  }

  const details = await getTokenDetails({ contractId, publicKey, network });

  return details?.symbol
    ? { code: details.symbol, decimals: details.decimals }
    : null;
};

/**
 * The amount of a Soroban token the viewer received in a transaction, read
 * from the transfer events of the transaction meta that Stellar Expert serves.
 * Returns null when the meta cannot be fetched or decoded, or holds no such
 * transfer, so the row keeps showing the sold amount only.
 */
const fetchReceivedAmount = async (
  hash: string,
  tokenContractId: string,
  { network, publicKey }: SwapContext,
): Promise<bigint | null> => {
  const cacheKey = `${network}:${hash}:${tokenContractId}:${publicKey}`;
  const cached = receivedAmountCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const metaXdr = await fetchTransactionMeta(hash, network);
  if (!metaXdr) return null;

  const received = getReceivedTokenAmountFromMeta(
    metaXdr,
    tokenContractId,
    publicKey,
  );
  if (received !== null) {
    receivedAmountCache.set(cacheKey, received);
  }

  return received;
};

/**
 * The leg a balance change shows, if it is the token the route names. Returns
 * null when it is a different token, which is not a swap of this route.
 */
const legFromDiff = (
  diff: AssetDiffSummary,
  contractId: string,
  networkPassphrase: string,
): SwapLeg | null => {
  const tokenId = diff.assetIssuer
    ? `${diff.assetCode}:${diff.assetIssuer}`
    : diff.assetCode;
  if (getCatalogContractId(tokenId, networkPassphrase) !== contractId) {
    return null;
  }

  return {
    code: diff.assetCode,
    issuer: diff.assetIssuer,
    type: diff.assetIssuer
      ? classicAssetType(diff.assetCode)
      : TokenTypeWithCustomToken.NATIVE,
    amount: diff.amount,
  };
};

/**
 * One side of the swap: from the user's balance change when there is one, else
 * from the token's own metadata (a Soroban token, which balance changes do not
 * list). Null when the side cannot be identified.
 */
const buildLeg = async (
  diff: AssetDiffSummary | undefined,
  contractId: string,
  context: SwapContext,
): Promise<{ leg: SwapLeg; decimals?: number } | null> => {
  if (diff) {
    const leg = legFromDiff(diff, contractId, context.networkPassphrase);

    return leg && { leg };
  }

  const meta = await resolveTokenMeta(contractId, context);

  return (
    meta && {
      leg: {
        code: meta.code,
        issuer: contractId,
        type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
        amount: null,
        iconUrl: meta.iconUrl,
      },
      decimals: meta.decimals,
    }
  );
};

/**
 * Rewrites a LI.FI swap as the path payment record the history swap
 * mapper reads, so it lists as a swap. The call is recognised from the
 * operation's envelope: the pinned LI.FI router's `swap` made by the
 * viewer. Legs come from the user's balance changes when they list them. A leg
 * they miss is a Soroban token: the sold amount is the call's input amount, and
 * symbols and decimals come from the token catalog or the token's own details.
 * A bought Soroban token's amount is the sum of the token's transfer events to
 * the viewer in the transaction, read from Stellar Expert; it is left empty,
 * never guessed, when that lookup fails.
 *
 * Returns null for anything that is not one swap of the viewer's: another
 * contract or function, more than one debit or credit, a balance change of a
 * token the route does not name, or a token whose symbol cannot be resolved.
 *
 * @param params.operation - The history operation record
 * @param params.publicKey - The viewer's account
 * @param params.networkDetails - The network of the record
 * @param params.assetDiffs - The viewer's balance changes in the operation
 */
export const toAggregatorSwapOperation = async ({
  operation,
  publicKey,
  networkDetails,
  assetDiffs,
}: {
  operation: Horizon.ServerApi.OperationRecord;
  publicKey: string;
  networkDetails: NetworkDetails;
  assetDiffs: AssetDiffSummary[];
}): Promise<Record<string, unknown> | null> => {
  const call = readRouterSwapCall(operation, networkDetails);
  const debits = assetDiffs.filter((diff) => !diff.isCredit);
  const credits = assetDiffs.filter((diff) => diff.isCredit);
  if (
    !call ||
    call.sender !== publicKey ||
    debits.length > 1 ||
    credits.length > 1
  ) {
    return null;
  }

  const { network, networkPassphrase } = networkDetails;
  await useTokenCatalogStore.getState().fetchCatalog(network);
  const context: SwapContext = {
    network,
    networkPassphrase,
    publicKey,
    catalog: getCatalog(network),
  };

  const [sent, received] = await Promise.all([
    buildLeg(debits[0], call.tokenIn, context),
    buildLeg(credits[0], call.tokenOut, context),
  ]);
  if (!sent || !received) return null;

  if (sent.leg.amount === null && sent.decimals !== undefined) {
    sent.leg.amount = toDecimalAmount(call.amountIn, sent.decimals);
  }
  if (received.leg.amount === null && received.decimals !== undefined) {
    const raw = await fetchReceivedAmount(
      operation.transaction_hash,
      call.tokenOut,
      context,
    );
    if (raw !== null) {
      received.leg.amount = toDecimalAmount(raw, received.decimals);
    }
  }
  // A sold amount that stayed unknown leaves nothing to show for the swap.
  if (sent.leg.amount === null) return null;

  return {
    ...operation,
    source_amount: sent.leg.amount,
    source_asset_code: sent.leg.code,
    source_asset_issuer: sent.leg.issuer ?? undefined,
    source_asset_type: sent.leg.type,
    source_icon_url: sent.leg.iconUrl,
    amount: received.leg.amount ?? "",
    asset_code: received.leg.code,
    asset_issuer: received.leg.issuer ?? undefined,
    asset_type: received.leg.type,
    icon_url: received.leg.iconUrl,
  };
};

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

export const toXoxnoSwapOperation = ({
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
  const routerAddress = XOXNO_SWAP_ROUTER[networkDetails.network];
  const record = operation as Horizon.ServerApi.OperationRecord & {
    transaction_attr?: { envelope_xdr?: string };
  };
  const operationIndex = getHistoryOperationIndex(
    operation,
    networkDetails.networkPassphrase,
  );
  if (!routerAddress || operationIndex === null) return null;
  const call = decodeStellarSwapEnvelope({
    envelopeXdr: record.transaction_attr?.envelope_xdr ?? "",
    networkPassphrase: networkDetails.networkPassphrase,
    routerAddress,
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
    xoxnoReceipt: {
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
