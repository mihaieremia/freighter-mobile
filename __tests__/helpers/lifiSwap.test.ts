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
import { SwapQuoteSource } from "services/backend";

import fixture from "../../__mocks__/lifiSwapFixture.json";
import reverseFixture from "../../__mocks__/lifiSwapReverseFixture.json";

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
