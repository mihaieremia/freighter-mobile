/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORKS, PUBLIC_NETWORK_DETAILS } from "config/constants";
import { verifyAggregatorSwap } from "helpers/aggregatorSwap";
import { readLifiSwap } from "helpers/lifiSwap";
import { scValFields } from "helpers/soroban";
import { SwapQuoteSource } from "services/backend";

import distributionCases from "../../__mocks__/lifiDistributionCases.json";
import fixture from "../../__mocks__/lifiSwapFixture.json";
import reverseFixture from "../../__mocks__/lifiSwapReverseFixture.json";
import { CONTRACT } from "../../__mocks__/swapFixtures";

const expected = {
  network: NETWORKS.PUBLIC,
  source: SwapQuoteSource.LIFI,
  sender: fixture.action.fromAddress,
  sourceToken: fixture.action.fromToken.address,
  destinationToken: fixture.action.toToken.address,
  sourceAmount: BigInt(fixture.action.fromAmount),
  minDestinationAmount: BigInt(fixture.estimate.toAmountMin),
};
const original = TransactionBuilder.fromXDR(
  fixture.transactionRequest.data,
  PUBLIC_NETWORK_DETAILS.networkPassphrase,
) as Transaction;
const deadline = Number(original.timeBounds?.maxTime);

beforeEach(() =>
  jest.spyOn(Date, "now").mockReturnValue((deadline - 180) * 1000),
);
afterEach(() => jest.restoreAllMocks());

it("accepts the real unsigned LI.FI envelope and reads identical swap history fields", () => {
  expect(
    verifyAggregatorSwap(fixture.transactionRequest.data, expected).feeStroops,
  ).toBe(BigInt(original.fee));
  const op = original.operations[0];
  if (
    op.type !== "invokeHostFunction" ||
    op.func.type !== "hostFunctionTypeInvokeContract"
  )
    throw new Error("fixture");
  expect(readLifiSwap(op.func.invokeContract.args)).toEqual({
    sender: expected.sender,
    amountIn: expected.sourceAmount,
    tokenIn: expected.sourceToken,
    tokenOut: expected.destinationToken,
  });
});

it.each(["input", "minimum", "sender", "output", "network", "source"])(
  "rejects an unexpected %s",
  (field) => {
    const changed = { ...expected };
    if (field === "input") changed.sourceAmount += 1n;
    if (field === "minimum") changed.minDestinationAmount += 1n;
    if (field === "sender") changed.sender = "other";
    if (field === "output") changed.destinationToken = expected.sourceToken;
    if (field === "network") changed.network = NETWORKS.TESTNET;
    if (field === "source") changed.source = SwapQuoteSource.XOXNO;
    expect(() =>
      verifyAggregatorSwap(fixture.transactionRequest.data, changed),
    ).toThrow();
  },
);

it.each([
  "expiry",
  "fee",
  "resourceFee",
  "authRoot",
  "extraAuth",
  "feeTheft",
  "otherVenue",
  "approval",
  "extraSpend",
  "otherPath",
])("rejects tampered %s", (mutation) => {
  const env = xdr.TransactionEnvelope.fromXDR(
    fixture.transactionRequest.data,
    "base64",
  );
  const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
  const op = xdr.expectUnionVariant(
    tx.operations[0].body,
    "invokeHostFunction",
  ).invokeHostFunctionOp;
  const root = op.auth[0].rootInvocation;
  const fn = (n: xdr.SorobanAuthorizedInvocation) =>
    xdr.expectUnionVariant(
      n.function,
      "sorobanAuthorizedFunctionTypeContractFn",
    ).contractFn;
  const venue = root.subInvocations[1].subInvocations[0];
  if (mutation === "expiry")
    Reflect.set(
      xdr.expectUnionVariant(tx.cond, "precondTime").timeBounds,
      "maxTime",
      0n,
    );
  if (mutation === "fee") Reflect.set(tx, "fee", 20000001);
  if (mutation === "resourceFee")
    Reflect.set(
      xdr.expectUnionVariant(tx.ext, "sorobanData").sorobanData,
      "resourceFee",
      BigInt(original.fee) + 1n,
    );
  if (mutation === "authRoot")
    Reflect.set(fn(root), "functionName", Buffer.from("other"));
  if (mutation === "extraAuth") op.auth.push(op.auth[0]);
  if (mutation === "feeTheft")
    fn(root.subInvocations[0]).args[2] = nativeToScVal(1000000000n, {
      type: "i128",
    });
  if (mutation === "otherVenue")
    Reflect.set(fn(venue), "contractAddress", fn(root).contractAddress);
  if (mutation === "approval")
    Reflect.set(
      fn(venue.subInvocations[0]),
      "functionName",
      Buffer.from("approve"),
    );
  if (mutation === "extraSpend")
    venue.subInvocations.push(venue.subInvocations[0]);
  if (mutation === "otherPath") fn(venue).args[1] = xdr.ScVal.scvVec([]);
  expect(() => verifyAggregatorSwap(env.toXDR("base64"), expected)).toThrow();
});

it("rejects an expired review transaction", () => {
  jest.spyOn(Date, "now").mockReturnValue(deadline * 1000);
  expect(() =>
    verifyAggregatorSwap(fixture.transactionRequest.data, expected),
  ).toThrow();
});

it("accepts a real USDC to XLM route with a sorted Aquarius token pair", () => {
  const tx = TransactionBuilder.fromXDR(
    reverseFixture.transactionRequest.data,
    PUBLIC_NETWORK_DETAILS.networkPassphrase,
  ) as Transaction;
  jest
    .spyOn(Date, "now")
    .mockReturnValue((Number(tx.timeBounds?.maxTime) - 180) * 1000);
  expect(() =>
    verifyAggregatorSwap(reverseFixture.transactionRequest.data, {
      ...expected,
      sender: reverseFixture.action.fromAddress,
      sourceToken: reverseFixture.action.fromToken.address,
      destinationToken: reverseFixture.action.toToken.address,
      sourceAmount: BigInt(reverseFixture.action.fromAmount),
      minDestinationAmount: BigInt(reverseFixture.estimate.toAmountMin),
    }),
  ).not.toThrow();
});

const contractFn = (node: xdr.SorobanAuthorizedInvocation) =>
  xdr.expectUnionVariant(
    node.function,
    "sorobanAuthorizedFunctionTypeContractFn",
  ).contractFn;
const vector = (value: xdr.ScVal) =>
  xdr.expectUnionVariant(value, "scvVec").vec ?? [];
const setField = (value: xdr.ScVal, name: string, replacement: xdr.ScVal) => {
  const entry = xdr
    .expectUnionVariant(value, "scvMap")
    .map?.find(
      (e) => e.key.type === "scvSymbol" && e.key.sym.toString() === name,
    );
  if (!entry) throw new Error("fixture field");
  Reflect.set(entry, "val", replacement);
};

it.each([
  "valid multihop",
  "non-address intermediate",
  "tracking ID type",
  "venue minimum",
  "duplicate field",
  "extra field",
  "unordered fields",
])("checks %s with matching payload and authorization", (mutation) => {
  const env = xdr.TransactionEnvelope.fromXDR(
    fixture.transactionRequest.data,
    "base64",
  );
  const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
  const op = xdr.expectUnionVariant(
    tx.operations[0].body,
    "invokeHostFunction",
  ).invokeHostFunctionOp;
  const call = xdr.expectUnionVariant(
    op.hostFunction,
    "hostFunctionTypeInvokeContract",
  ).invokeContract;
  const root = op.auth[0].rootInvocation;
  const swap = root.subInvocations[1];
  const venue = swap.subInvocations[0];
  const args = vector(
    scValFields(call.args[0], [
      "args",
      "fees",
      "interface",
      "min_amount_out",
      "token_in",
      "token_out",
      "tracking_id",
    ]).get("args") as xdr.ScVal,
  );
  if (mutation === "tracking ID type")
    setField(call.args[0], "tracking_id", xdr.ScVal.scvVoid());
  if (mutation === "venue minimum")
    contractFn(venue).args[4] = nativeToScVal(1n, { type: "u128" });
  if (mutation.includes("field")) {
    const entries = xdr.expectUnionVariant(call.args[0], "scvMap").map;
    if (!entries) throw new Error("fixture map");
    if (mutation === "duplicate field") entries.push(entries[0]);
    if (mutation === "extra field")
      entries.push(
        new xdr.ScMapEntry({
          key: nativeToScVal("zzz", { type: "symbol" }),
          val: xdr.ScVal.scvVoid(),
        }),
      );
    if (mutation === "unordered fields") entries.reverse();
  }
  if (
    mutation === "valid multihop" ||
    mutation === "non-address intermediate"
  ) {
    const route = vector(args[4])[0];
    const fields = scValFields(route, [
      "bytes",
      "parts",
      "path",
      "protocol_id",
    ]);
    const path = vector(fields.get("path") as xdr.ScVal);
    const pools = vector(fields.get("bytes") as xdr.ScVal);
    const middle =
      mutation === "valid multihop"
        ? nativeToScVal(CONTRACT, { type: "address" })
        : nativeToScVal(0n, { type: "i128" });
    setField(route, "path", xdr.ScVal.scvVec([path[0], middle, path[1]]));
    setField(route, "bytes", xdr.ScVal.scvVec([pools[0], pools[0]]));
    contractFn(venue).args[1] = xdr.ScVal.scvVec([
      xdr.ScVal.scvVec([xdr.ScVal.scvVec([path[0], middle]), pools[0], middle]),
      xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([middle, path[1]]),
        pools[0],
        path[1],
      ]),
    ]);
    [, , , , contractFn(swap).args[4]] = args;
  }
  Reflect.set(root.function, "contractFn", call);
  const verify = () => verifyAggregatorSwap(env.toXDR("base64"), expected);
  // Synthetic ABI shape only; these pools have not been simulated for this path.
  if (mutation === "valid multihop") expect(verify).not.toThrow();
  else expect(verify).toThrow();
});

it.each(distributionCases)("checks allocation: $name", (tc) => {
  const env = xdr.TransactionEnvelope.fromXDR(
    fixture.transactionRequest.data,
    "base64",
  );
  const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
  const op = xdr.expectUnionVariant(
    tx.operations[0].body,
    "invokeHostFunction",
  ).invokeHostFunctionOp;
  const call = xdr.expectUnionVariant(
    op.hostFunction,
    "hostFunctionTypeInvokeContract",
  ).invokeContract;
  const root = op.auth[0].rootInvocation;
  const swap = root.subInvocations[1];
  const args = vector(
    scValFields(call.args[0], [
      "args",
      "fees",
      "interface",
      "min_amount_out",
      "token_in",
      "token_out",
      "tracking_id",
    ]).get("args") as xdr.ScVal,
  );
  const baseRoute = vector(args[4])[0];
  const baseVenue = swap.subInvocations[0];
  const input = BigInt(tc.input);
  const fee = (input * 25n) / 10000n;
  args[2] = nativeToScVal(input, { type: "i128" });
  contractFn(root.subInvocations[0]).args[2] = nativeToScVal(fee, {
    type: "i128",
  });
  const routes = tc.parts.map((part) => {
    const route = xdr.ScVal.fromXDR(baseRoute.toXDR());
    setField(route, "parts", nativeToScVal(part, { type: "u32" }));
    return route;
  });
  Reflect.set(
    swap,
    "subInvocations",
    tc.amounts.map((amount) => {
      const venue = xdr.SorobanAuthorizedInvocation.fromXDR(baseVenue.toXDR());
      contractFn(venue).args[3] = nativeToScVal(BigInt(amount), {
        type: "u128",
      });
      contractFn(venue.subInvocations[0]).args[2] = nativeToScVal(
        BigInt(amount),
        {
          type: "i128",
        },
      );
      return venue;
    }),
  );
  args[4] = xdr.ScVal.scvVec(routes);
  Reflect.set(contractFn(swap), "args", [...args]);
  contractFn(swap).args[2] = nativeToScVal(input - fee, { type: "i128" });
  Reflect.set(root.function, "contractFn", call);
  const verify = () =>
    verifyAggregatorSwap(env.toXDR("base64"), {
      ...expected,
      sourceAmount: input,
    });
  // Same known-answer corpus as the backend; no claim of executable split pools.
  if (tc.accept) expect(verify).not.toThrow();
  else expect(verify).toThrow();
});
