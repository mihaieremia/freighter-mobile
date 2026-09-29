import { Horizon, scValToBigInt } from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { AssetDiffSummary } from "components/screens/HistoryScreen/types";
import { NetworkDetails } from "config/constants";
import { TokenTypeWithCustomToken } from "config/types";
import { XOXNO_SWAP_ROUTER } from "config/xoxnoSwap";
import { useTokenCatalogStore } from "ducks/tokenCatalog";
import { ROUTER_SWAP_FUNCTION, readRouteTokens } from "helpers/aggregatorSwap";
import { addressToString, getInvokedContract } from "helpers/soroban";
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
 * The router swap a history operation makes, read from the operation's own
 * envelope: the router contract, the `execute_strategy` function and the tokens
 * and amount in its arguments. Returns null for any other operation.
 */
const readRouterSwapCall = (
  operation: Horizon.ServerApi.OperationRecord,
  networkDetails: NetworkDetails,
): RouterSwapCall | null => {
  const router = XOXNO_SWAP_ROUTER[networkDetails.network];
  const invoked = getInvokedContract(operation, networkDetails);
  if (
    !router ||
    invoked?.contractId !== router ||
    invoked.fnName !== ROUTER_SWAP_FUNCTION ||
    invoked.args.length !== 3
  ) {
    return null;
  }

  const [sender, amountIn, payload] = invoked.args;
  if (
    sender.type !== "scvAddress" ||
    amountIn.type !== "scvI128" ||
    payload.type !== "scvBytes"
  ) {
    return null;
  }
  const tokens = readRouteTokens(payload.bytes.toBytes());
  if (!tokens) return null;

  return {
    sender: addressToString(sender.address),
    amountIn: scValToBigInt(amountIn),
    ...tokens,
  };
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
 * Rewrites an aggregator swap as the path payment record the history swap
 * mapper reads, so it lists as a swap. The call is recognised from the
 * operation's envelope: the pinned router's `execute_strategy` made by the
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
