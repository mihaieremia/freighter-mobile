import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
  scValToBigInt,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORKS, mapNetworkToNetworkDetails } from "config/constants";
import { LIFI_MAX_LIFETIME_SECONDS } from "config/lifiSwap";
import { XOXNO_SWAP_ROUTER } from "config/xoxnoSwap";
import { checkLifiSwap } from "helpers/lifiSwap";
import {
  addressToString,
  getInvokeContractArgs,
  scValFields,
} from "helpers/soroban";
import { SwapQuoteSource } from "services/backend";

export const ROUTER_SWAP_FUNCTION = "execute_strategy";
const ROUTE_PAYLOAD_VERSION = 1;
const ROUTE_HEADER_LENGTH = 10;
// Route header layout: the version byte, the registry indices of the input token,
// the output token and the minimum output, then a four-byte referral field.
const ROUTE_VERSION_INDEX = 0;
const ROUTE_TOKEN_IN_INDEX = 1;
const ROUTE_TOKEN_OUT_INDEX = 2;
const ROUTE_MIN_OUT_INDEX = 3;
const ROUTE_REFERRAL_START = 4;
const ROUTE_REFERRAL_END = 8;
// Base plus Soroban resource fees for a swap sit far below this; a larger fee is a bug or an attack.
const MAX_AGGREGATOR_FEE_STROOPS = 20_000_000;

export interface AggregatorSwapExpectation {
  source?: SwapQuoteSource;
  network: NETWORKS;
  sender: string;
  /** Stellar Asset Contract id of the token sold. */
  sourceToken: string;
  /** Stellar Asset Contract id of the token bought. */
  destinationToken: string;
  /** Amount sold, in stroops. */
  sourceAmount: bigint;
  /** Lowest amount the user accepts, in stroops. */
  minDestinationAmount: bigint;
}

interface VerifiedAggregatorSwap {
  feeStroops: bigint;
  resourceFeeStroops: bigint;
}

const fail = (reason: string): never => {
  throw new Error(`Unsafe swap transaction: ${reason}`);
};

const scValAddress = (val?: xdr.ScVal): string | null =>
  val?.type === "scvAddress" ? addressToString(val.address) : null;

interface RoutePayload {
  assets: xdr.ScVal[];
  amounts: xdr.ScVal[];
  header: Uint8Array;
}

/**
 * Splits the router payload into its asset registry, amount registry and route
 * header, and checks the header is a whole version-1 header. Throws on a payload
 * of any other shape.
 */
const parseRoutePayload = (payload: Uint8Array): RoutePayload => {
  const payloadVal = xdr.ScVal.fromXDR(Buffer.from(payload));
  if (payloadVal.type !== "scvMap" || !payloadVal.map) {
    return fail("route payload is not a struct");
  }

  const fields = scValFields(payloadVal, ["amounts", "assets", "ops"]);

  const assets = fields.get("assets");
  const amounts = fields.get("amounts");
  const ops = fields.get("ops");
  if (
    assets?.type !== "scvVec" ||
    amounts?.type !== "scvVec" ||
    ops?.type !== "scvBytes"
  ) {
    return fail("route payload is incomplete");
  }
  const header = ops.bytes.toBytes();
  if (header.length < ROUTE_HEADER_LENGTH)
    return fail("route header truncated");
  if (header[ROUTE_VERSION_INDEX] !== ROUTE_PAYLOAD_VERSION)
    return fail("route version");

  return { assets: assets.vec ?? [], amounts: amounts.vec ?? [], header };
};

/**
 * Reads the fields of the router payload that decide what the sender receives:
 * the tokens and the minimum output. The router pays the output to the sender and
 * reverts below the minimum, so a payload naming the expected tokens and a floor
 * at least the quoted one cannot leave the sender with less.
 */
const checkRoutePayload = (
  payload: Uint8Array,
  expected: AggregatorSwapExpectation,
) => {
  const { assets, amounts, header } = parseRoutePayload(payload);
  if (
    header
      .slice(ROUTE_REFERRAL_START, ROUTE_REFERRAL_END)
      .some((byte) => byte !== 0)
  ) {
    return fail("route carries a referral");
  }

  const tokenIn = scValAddress(assets[header[ROUTE_TOKEN_IN_INDEX]]);
  const tokenOut = scValAddress(assets[header[ROUTE_TOKEN_OUT_INDEX]]);
  if (tokenIn !== expected.sourceToken) return fail("route input token");
  if (tokenOut !== expected.destinationToken) return fail("route output token");

  const minOutVal = amounts[header[ROUTE_MIN_OUT_INDEX]];
  const minOut =
    minOutVal?.type === "scvI128" ? scValToBigInt(minOutVal) : null;
  if (minOut === null || minOut < expected.minDestinationAmount) {
    return fail("route minimum output is below the quoted minimum");
  }
  return undefined;
};

/**
 * The input and output token contract ids a router payload names, or null when
 * the payload is not a route this wallet understands. Read-only: it judges
 * nothing, so it serves history, where no signature depends on it.
 */
export const readRouteTokens = (
  payload: Uint8Array,
): { tokenIn: string; tokenOut: string } | null => {
  try {
    const { assets, header } = parseRoutePayload(payload);
    const tokenIn = scValAddress(assets[header[ROUTE_TOKEN_IN_INDEX]]);
    const tokenOut = scValAddress(assets[header[ROUTE_TOKEN_OUT_INDEX]]);

    return tokenIn && tokenOut ? { tokenIn, tokenOut } : null;
  } catch {
    return null;
  }
};

/**
 * Only direct source-token transfers from the sender to the router may be
 * authorized beneath the approved router call, totalling at most the input.
 */
const checkTransferAuthorization = (
  node: xdr.SorobanAuthorizedInvocation,
  expected: AggregatorSwapExpectation,
  spentBefore: bigint,
): bigint => {
  if (
    node.function.type !== "sorobanAuthorizedFunctionTypeContractFn" ||
    node.subInvocations.length !== 0
  ) {
    return fail("authorization is not a token transfer");
  }
  const call = node.function.contractFn;
  const { args } = call;
  if (
    call.functionName.toString() !== "transfer" ||
    addressToString(call.contractAddress) !== expected.sourceToken ||
    args.length !== 3 ||
    scValAddress(args[0]) !== expected.sender ||
    scValAddress(args[1]) !== XOXNO_SWAP_ROUTER[expected.network] ||
    args[2].type !== "scvI128"
  ) {
    return fail(
      "authorization is not the sender's source-token transfer to the router",
    );
  }
  const amount = scValToBigInt(args[2]);
  const spent = spentBefore + amount;
  if (amount < 0n || spent > expected.sourceAmount) {
    return fail("authorization transfer amount is out of range");
  }

  return spent;
};

/**
 * Verifies that an aggregator envelope does exactly one thing: call
 * `router.execute_strategy(sender, amount, payload)` on the pinned router from
 * the user's own account, moving no more than the input amount of the source
 * token out of it, for the expected tokens and at least the quoted minimum.
 * Throws on anything else, so an unverified envelope is never signed.
 */
export const verifyAggregatorSwap = (
  envelopeXdr: string,
  expected: AggregatorSwapExpectation,
): VerifiedAggregatorSwap => {
  const router = XOXNO_SWAP_ROUTER[expected.network];
  const isLifi = expected.source === SwapQuoteSource.LIFI;
  if (isLifi && expected.network !== NETWORKS.PUBLIC)
    return fail("LI.FI network");
  if (!isLifi && !router) return fail("no aggregator router on this network");

  const parsed = TransactionBuilder.fromXDR(
    envelopeXdr,
    mapNetworkToNetworkDetails(expected.network).networkPassphrase,
  );
  if (parsed instanceof FeeBumpTransaction) return fail("fee bump");
  const tx: Transaction = parsed;

  if (tx.source !== expected.sender) return fail("source is not the sender");
  if (tx.signatures.length > 0) return fail("already signed");
  if (tx.memo.type !== "none") return fail("memo");
  if (tx.operations.length !== 1) return fail("operation count");

  const feeStroops = BigInt(tx.fee);
  if (
    feeStroops <= BigInt(0) ||
    feeStroops > BigInt(MAX_AGGREGATOR_FEE_STROOPS)
  ) {
    return fail("fee is out of range");
  }
  const envelope = xdr.expectUnionVariant(tx.toEnvelope(), "envelopeTypeTx");
  const { ext } = envelope.v1.tx;
  if (ext.type !== "sorobanData") return fail("no Soroban resource data");
  const resourceFeeStroops = ext.sorobanData.resourceFee;
  if (resourceFeeStroops < 0n || resourceFeeStroops > feeStroops) {
    return fail("resource fee is out of range");
  }

  const [op] = tx.operations;
  if (op.type !== "invokeHostFunction" || op.source) {
    return fail("operation is not a plain contract invocation");
  }
  const call = getInvokeContractArgs(op);
  if (!call) return fail("host function is not a contract invocation");
  if (isLifi) {
    const bounds = tx.timeBounds;
    const now = Math.floor(Date.now() / 1000);
    if (
      envelope.v1.tx.cond.type !== "precondTime" ||
      !bounds ||
      bounds.minTime !== "0" ||
      BigInt(bounds.maxTime) <= BigInt(now + 20) ||
      BigInt(bounds.maxTime) > BigInt(now + LIFI_MAX_LIFETIME_SECONDS) ||
      op.func.type !== "hostFunctionTypeInvokeContract"
    )
      return fail("LI.FI expiry");
    checkLifiSwap(
      op.func.invokeContract,
      op.auth ?? [],
      expected,
      BigInt(bounds.maxTime),
    );
    return { feeStroops, resourceFeeStroops };
  }
  if (call.contractId !== router) {
    return fail("contract is not the swap router");
  }
  if (call.fnName !== ROUTER_SWAP_FUNCTION) {
    return fail("function is not the router swap");
  }
  const { args } = call;
  if (args.length !== 3) return fail("argument count");
  if (scValAddress(args[0]) !== expected.sender) return fail("sender argument");
  if (
    args[1].type !== "scvI128" ||
    scValToBigInt(args[1]) !== expected.sourceAmount
  ) {
    return fail("input amount");
  }
  if (args[2].type !== "scvBytes") return fail("route payload type");
  checkRoutePayload(args[2].bytes.toBytes(), expected);

  if (!op.auth?.length) return fail("missing source-account authorization");
  let spent = BigInt(0);
  (op.auth ?? []).forEach((entry) => {
    if (entry.credentials.type !== "sorobanCredentialsSourceAccount") {
      fail("authorization needs a signature the wallet does not produce");
    }
    const root = entry.rootInvocation;
    if (
      root.function.type !== "sorobanAuthorizedFunctionTypeContractFn" ||
      op.func.type !== "hostFunctionTypeInvokeContract" ||
      root.function.contractFn.toXDR("base64") !==
        op.func.invokeContract.toXDR("base64")
    ) {
      fail("authorization root differs from the router invocation");
    }
    spent = root.subInvocations.reduce(
      (total, sub) => checkTransferAuthorization(sub, expected, total),
      spent,
    );
  });

  return { feeStroops, resourceFeeStroops };
};
