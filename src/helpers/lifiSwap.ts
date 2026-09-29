import { scValToBigInt, xdr } from "@stellar/stellar-sdk";
import {
  LIFI_AQUARIUS,
  LIFI_FEE_BPS,
  LIFI_FEE_RECIPIENT,
  LIFI_SOROSWAP,
  LIFI_SWAP_ROUTER,
} from "config/lifiSwap";
import type { AggregatorSwapExpectation } from "helpers/aggregatorSwap";
import { addressToString } from "helpers/soroban";

const fail = (): never => {
  throw new Error(
    "Unsafe swap transaction: LI.FI trade or authorization differs",
  );
};
const address = (v?: xdr.ScVal): string | null =>
  v?.type === "scvAddress" ? addressToString(v.address) : null;
const integer = (v?: xdr.ScVal): bigint =>
  v?.type === "scvI128" ? scValToBigInt(v) : fail();
const unsignedInteger = (v?: xdr.ScVal): bigint =>
  v?.type === "scvU128" ? scValToBigInt(v) : fail();
const vector = (v?: xdr.ScVal): xdr.ScVal[] =>
  v?.type === "scvVec" && v.vec ? v.vec : fail();
const fields = (v: xdr.ScVal, names: string[]): Map<string, xdr.ScVal> => {
  if (v.type !== "scvMap" || v.map?.length !== names.length) return fail();
  const result = new Map<string, xdr.ScVal>();
  v.map.forEach((e) => {
    if (e.key.type !== "scvSymbol") fail();
    const key = xdr.expectUnionVariant(e.key, "scvSymbol").sym.toString();
    if (!names.includes(key) || result.has(key)) fail();
    result.set(key, e.val);
  });
  return result;
};
const contractCall = (
  node: xdr.SorobanAuthorizedInvocation,
): xdr.InvokeContractArgs =>
  node.function.type === "sorobanAuthorizedFunctionTypeContractFn"
    ? node.function.contractFn
    : fail();

const checkTransfer = (
  node: xdr.SorobanAuthorizedInvocation,
  expected: AggregatorSwapExpectation,
  recipient: string,
  amount: bigint,
) => {
  const call = contractCall(node);
  if (
    addressToString(call.contractAddress) !== expected.sourceToken ||
    call.functionName.toString() !== "transfer" ||
    call.args.length !== 3 ||
    node.subInvocations.length !== 0 ||
    address(call.args[0]) !== expected.sender ||
    address(call.args[1]) !== recipient ||
    integer(call.args[2]) !== amount ||
    amount < 0n
  )
    fail();
};

const checkAquariusRoute = (
  distribution: xdr.ScVal,
  authorizedHops: xdr.ScVal,
  expected: AggregatorSwapExpectation,
) => {
  const route = fields(distribution, ["bytes", "parts", "path", "protocol_id"]);
  const protocol = route.get("protocol_id");
  const parts = route.get("parts");
  if (
    protocol?.type !== "scvU32" ||
    protocol.u32 !== 2 ||
    parts?.type !== "scvU32" ||
    parts.u32 <= 0
  )
    return fail();
  const path = vector(route.get("path"));
  const pools = vector(route.get("bytes"));
  const hops = vector(authorizedHops);
  if (
    path.length < 2 ||
    address(path[0]) !== expected.sourceToken ||
    address(path[path.length - 1]) !== expected.destinationToken ||
    pools.length !== path.length - 1 ||
    hops.length !== pools.length
  )
    return fail();
  pools.forEach((pool, i) => {
    if (pool.type !== "scvBytes" || pool.bytes.toBytes().length !== 32) fail();
    const hop = vector(hops[i]);
    if (hop.length !== 3) fail();
    const pair = vector(hop[0]);
    if (pair.length !== 2) return fail();
    const equal = (a: xdr.ScVal, b: xdr.ScVal) =>
      a.toXDR("base64") === b.toXDR("base64");
    const samePair =
      (equal(pair[0], path[i]) && equal(pair[1], path[i + 1])) ||
      (equal(pair[1], path[i]) && equal(pair[0], path[i + 1]));
    if (!samePair || !equal(hop[1], pool) || !equal(hop[2], path[i + 1]))
      return fail();
    return undefined;
  });
  return undefined;
};

/** Checks both layers and the whole sender spend tree; no envelope rewriting. */
export const checkLifiSwap = (
  call: xdr.InvokeContractArgs,
  auth: xdr.SorobanAuthorizationEntry[],
  expected: AggregatorSwapExpectation,
  deadline: bigint,
) => {
  if (
    expected.sourceAmount <= 0n ||
    expected.minDestinationAmount <= 0n ||
    expected.sourceToken === expected.destinationToken
  )
    return fail();

  if (
    addressToString(call.contractAddress) !== LIFI_SWAP_ROUTER ||
    call.functionName.toString() !== "swap" ||
    call.args.length !== 2 ||
    address(call.args[1]) !== expected.sender
  )
    return fail();
  const payload = fields(call.args[0], [
    "args",
    "fees",
    "interface",
    "min_amount_out",
    "token_in",
    "token_out",
    "tracking_id",
  ]);
  const iface = payload.get("interface");
  const minimum = integer(payload.get("min_amount_out"));
  if (
    iface?.type !== "scvSymbol" ||
    iface.sym.toString() !== "soroswap_aggregator" ||
    address(payload.get("token_in")) !== expected.sourceToken ||
    address(payload.get("token_out")) !== expected.destinationToken ||
    minimum <= 0n ||
    minimum < expected.minDestinationAmount
  )
    return fail();
  const args = vector(payload.get("args"));
  if (
    args.length !== 7 ||
    address(args[0]) !== expected.sourceToken ||
    address(args[1]) !== expected.destinationToken ||
    integer(args[2]) !== expected.sourceAmount ||
    integer(args[3]) !== minimum ||
    address(args[5]) !== expected.sender ||
    args[6].type !== "scvU64" ||
    args[6].u64 !== deadline ||
    vector(args[4]).length === 0
  )
    return fail();
  const fees = vector(payload.get("fees"));
  if (fees.length !== 1) return fail();
  const feeFields = fields(fees[0], ["fee_bps", "fee_destination"]);
  const bps = feeFields.get("fee_bps");
  if (
    integer(bps) !== LIFI_FEE_BPS ||
    address(feeFields.get("fee_destination")) !== LIFI_FEE_RECIPIENT
  )
    return fail();
  const fee = (expected.sourceAmount * LIFI_FEE_BPS) / 10_000n;
  const net = expected.sourceAmount - fee;
  if (
    auth.length !== 1 ||
    auth[0].credentials.type !== "sorobanCredentialsSourceAccount"
  )
    return fail();
  const root = auth[0].rootInvocation;
  if (
    contractCall(root).toXDR("base64") !== call.toXDR("base64") ||
    root.subInvocations.length !== 2
  )
    return fail();
  checkTransfer(root.subInvocations[0], expected, LIFI_FEE_RECIPIENT, fee);
  const swap = root.subInvocations[1];
  const swapCall = contractCall(swap);
  if (
    addressToString(swapCall.contractAddress) !== LIFI_SOROSWAP ||
    swapCall.functionName.toString() !== "swap_exact_tokens_for_tokens" ||
    swapCall.args.length !== args.length ||
    integer(swapCall.args[2]) !== net ||
    swapCall.args.some(
      (v, i) => i !== 2 && v.toXDR("base64") !== args[i].toXDR("base64"),
    ) ||
    swap.subInvocations.length === 0
  )
    return fail();
  const routes = vector(args[4]);
  if (routes.length !== swap.subInvocations.length) return fail();
  let spent = 0n;
  // ponytail: Aquarius only; add other venue authorization ABIs when verified.
  swap.subInvocations.forEach((venue, i) => {
    const venueCall = contractCall(venue);
    const a = venueCall.args;
    if (
      addressToString(venueCall.contractAddress) !== LIFI_AQUARIUS ||
      venueCall.functionName.toString() !== "swap_chained" ||
      a.length !== 5 ||
      address(a[0]) !== expected.sender ||
      address(a[2]) !== expected.sourceToken ||
      venue.subInvocations.length !== 1 ||
      unsignedInteger(a[4]) < 0n
    )
      fail();
    checkAquariusRoute(routes[i], a[1], expected);
    const amount = unsignedInteger(a[3]);
    if (amount <= 0n) fail();
    checkTransfer(venue.subInvocations[0], expected, LIFI_AQUARIUS, amount);
    spent += amount;
    if (spent > net) fail();
  });
  if (spent !== net) return fail();
  return undefined;
};

/** History only: signing always uses the full verifier above. */
export const readLifiSwap = (args: xdr.ScVal[]) => {
  try {
    if (args.length !== 2) return null;
    const payload = fields(args[0], [
      "args",
      "fees",
      "interface",
      "min_amount_out",
      "token_in",
      "token_out",
      "tracking_id",
    ]);
    const trade = vector(payload.get("args"));
    const sender = address(args[1]);
    const tokenIn = address(payload.get("token_in"));
    const tokenOut = address(payload.get("token_out"));
    return sender && tokenIn && tokenOut
      ? { sender, tokenIn, tokenOut, amountIn: integer(trade[2]) }
      : null;
  } catch {
    return null;
  }
};
