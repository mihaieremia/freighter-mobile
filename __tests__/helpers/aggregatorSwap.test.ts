/* eslint-disable @fnando/consistent-import/consistent-import */
import { TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { NETWORKS } from "config/constants";
import { readRouteTokens, verifyAggregatorSwap } from "helpers/aggregatorSwap";

import {
  CONTRACT,
  ISSUER,
  SENDER,
  USDC_SAC,
  XLM_SAC,
} from "../../__mocks__/swapFixtures";
import classicFixture from "../../__mocks__/xoxnoSwapFixture.json";
import sorobanFixture from "../../__mocks__/xoxnoSwapSorobanFixture.json";

/**
 * A real, unsigned, simulated aggregator envelope for 10 XLM to USDC on pubnet,
 * as returned by the XOXNO quote server. It carries no secret: the sender is the
 * public USDC issuer account and nothing here is signed.
 */
const fx = {
  envelopeXdr: classicFixture.envelopeXdr,
  sender: ISSUER,
  sourceToken: XLM_SAC,
  destinationToken: USDC_SAC,
  sourceAmount: 100000000n,
  minDestinationAmount: 22719551n,
  feeStroops: 98024n,
  resourceFeeStroops: 97924n,
};

/**
 * A real, unsigned, simulated envelope for 100 XLM to deJTRSY, a Soroban-native token
 * with 18 decimals, from the same server and sender as the fixture above.
 */
const sorobanFx = {
  envelopeXdr: sorobanFixture.envelopeXdr,
  destinationToken: CONTRACT,
  minDestinationAmount: 22225325112351813029n,
};

const expected = {
  network: NETWORKS.PUBLIC,
  sender: fx.sender,
  sourceToken: fx.sourceToken,
  destinationToken: fx.destinationToken,
  sourceAmount: fx.sourceAmount,
  minDestinationAmount: fx.minDestinationAmount,
};

describe("verifyAggregatorSwap", () => {
  it("accepts the envelope the aggregator returned and reports its fees", () => {
    const verified = verifyAggregatorSwap(fx.envelopeXdr, expected);

    expect(verified.feeStroops).toBe(fx.feeStroops);
    expect(verified.resourceFeeStroops).toBe(fx.resourceFeeStroops);
  });

  it("accepts a lower expected minimum than the route promises", () => {
    expect(() =>
      verifyAggregatorSwap(fx.envelopeXdr, {
        ...expected,
        minDestinationAmount: fx.minDestinationAmount - 1n,
      }),
    ).not.toThrow();
  });

  const rejects: Record<string, Partial<typeof expected>> = {
    "another sender": {
      sender: SENDER,
    },
    "another input amount": { sourceAmount: fx.sourceAmount + 1n },
    "a minimum above the route's promise": {
      minDestinationAmount: fx.minDestinationAmount + 1n,
    },
    "another destination token": {
      destinationToken: XLM_SAC,
    },
    "another source token": {
      sourceToken: USDC_SAC,
    },
    "a network with another router": { network: NETWORKS.TESTNET },
    "a network without a router": { network: NETWORKS.FUTURENET },
  };

  Object.entries(rejects).forEach(([name, override]) => {
    it(`rejects an envelope checked against ${name}`, () => {
      expect(() =>
        verifyAggregatorSwap(fx.envelopeXdr, { ...expected, ...override }),
      ).toThrow(/Unsafe swap transaction/);
    });
  });

  it("rejects malformed input", () => {
    expect(() => verifyAggregatorSwap("AAAA", expected)).toThrow();
  });

  it.each([
    ["an unrelated authorization", "set_admin"],
    ["an unrecognized spending method", "withdraw"],
    ["an approval", "approve"],
  ])("rejects %s", (_name, functionName) => {
    const env = xdr.TransactionEnvelope.fromXDR(fx.envelopeXdr, "base64");
    const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
    const op = xdr.expectUnionVariant(
      tx.operations[0].body,
      "invokeHostFunction",
    );
    const transfer =
      op.invokeHostFunctionOp.auth[0].rootInvocation.subInvocations[0];
    Reflect.set(
      xdr.expectUnionVariant(
        transfer.function,
        "sorobanAuthorizedFunctionTypeContractFn",
      ).contractFn,
      "functionName",
      Buffer.from(functionName),
    );

    expect(() => verifyAggregatorSwap(env.toXDR("base64"), expected)).toThrow(
      /Unsafe swap transaction/,
    );
  });

  it.each([
    "malformed",
    "negative",
    "another recipient",
    "another root",
    "nested",
    "missing",
  ])("rejects %s transfer authorization", (mutation) => {
    const env = xdr.TransactionEnvelope.fromXDR(fx.envelopeXdr, "base64");
    const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
    const op = xdr.expectUnionVariant(
      tx.operations[0].body,
      "invokeHostFunction",
    );
    const root = op.invokeHostFunctionOp.auth[0].rootInvocation;
    const transfer = xdr.expectUnionVariant(
      root.subInvocations[0].function,
      "sorobanAuthorizedFunctionTypeContractFn",
    ).contractFn;
    const [from, to] = transfer.args;
    if (mutation === "malformed") transfer.args.pop();
    if (mutation === "negative") {
      transfer.args[2] = xdr.ScVal.scvI128(
        new xdr.Int128Parts({ hi: -1n, lo: 0xffffffffffffffffn }),
      );
    }
    if (mutation === "another recipient") transfer.args[1] = from;
    if (mutation === "another root") {
      xdr.expectUnionVariant(
        root.function,
        "sorobanAuthorizedFunctionTypeContractFn",
      ).contractFn.args[0] = to;
    }
    if (mutation === "nested")
      root.subInvocations[0].subInvocations.push(
        xdr.SorobanAuthorizedInvocation.fromXDR(root.subInvocations[0].toXDR()),
      );
    if (mutation === "missing") op.invokeHostFunctionOp.auth.splice(0);
    expect(() => verifyAggregatorSwap(env.toXDR("base64"), expected)).toThrow(
      /Unsafe swap transaction/,
    );
  });

  describe("to a Soroban-native token", () => {
    const sorobanExpected = {
      ...expected,
      sourceAmount: 1000000000n,
      destinationToken: sorobanFx.destinationToken,
      minDestinationAmount: sorobanFx.minDestinationAmount,
    };

    it("accepts the envelope the aggregator returned", () => {
      expect(() =>
        verifyAggregatorSwap(sorobanFx.envelopeXdr, sorobanExpected),
      ).not.toThrow();
    });

    it("rejects it when the token bought is another contract", () => {
      expect(() =>
        verifyAggregatorSwap(sorobanFx.envelopeXdr, {
          ...sorobanExpected,
          destinationToken: fx.destinationToken,
        }),
      ).toThrow(/Unsafe swap transaction/);
    });

    it("rejects it when the wallet expects more than the route promises", () => {
      expect(() =>
        verifyAggregatorSwap(sorobanFx.envelopeXdr, {
          ...sorobanExpected,
          minDestinationAmount: sorobanFx.minDestinationAmount + 1n,
        }),
      ).toThrow(/Unsafe swap transaction/);
    });
  });
});

describe.each([
  ["classic", fx, expected],
  [
    "Soroban",
    sorobanFx,
    {
      ...expected,
      sourceAmount: 1000000000n,
      destinationToken: sorobanFx.destinationToken,
      minDestinationAmount: sorobanFx.minDestinationAmount,
    },
  ],
])("captured %s envelope validation", (_name, fixture, trade) => {
  it.each([
    "negative resource fee",
    "excess resource fee",
    "duplicate field",
    "extra field",
    "unordered fields",
    "shared spend",
    "excess shared spend",
  ])("checks %s with a matching authorization root", (mutation) => {
    const env = xdr.TransactionEnvelope.fromXDR(fixture.envelopeXdr, "base64");
    const { tx } = xdr.expectUnionVariant(env, "envelopeTypeTx").v1;
    const op = xdr.expectUnionVariant(
      tx.operations[0].body,
      "invokeHostFunction",
    ).invokeHostFunctionOp;
    const call = xdr.expectUnionVariant(
      op.hostFunction,
      "hostFunctionTypeInvokeContract",
    ).invokeContract;
    if (mutation.includes("resource fee")) {
      Reflect.set(
        xdr.expectUnionVariant(tx.ext, "sorobanData").sorobanData,
        "resourceFee",
        mutation === "negative resource fee" ? -1n : BigInt(tx.fee) + 1n,
      );
    } else if (mutation.includes("field")) {
      const payload = xdr.ScVal.fromXDR(
        xdr.expectUnionVariant(call.args[2], "scvBytes").bytes.toBytes(),
      );
      const entries = xdr.expectUnionVariant(payload, "scvMap").map;
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
      call.args[2] = nativeToScVal(payload.toXDR(), { type: "bytes" });
    } else {
      op.auth.push(xdr.SorobanAuthorizationEntry.fromXDR(op.auth[0].toXDR()));
      op.auth.forEach((entry, i) => {
        const transfer = xdr.expectUnionVariant(
          entry.rootInvocation.subInvocations[0].function,
          "sorobanAuthorizedFunctionTypeContractFn",
        ).contractFn;
        const amount = (trade.sourceAmount * (i === 0 ? 60n : 40n)) / 100n;
        transfer.args[2] = nativeToScVal(
          amount + (mutation === "excess shared spend" && i === 1 ? 1n : 0n),
          { type: "i128" },
        );
      });
    }
    Reflect.set(op.auth[0].rootInvocation.function, "contractFn", call);
    const verify = () => verifyAggregatorSwap(env.toXDR("base64"), trade);
    if (mutation === "shared spend") expect(verify).not.toThrow();
    else expect(verify).toThrow();
  });
});

describe("readRouteTokens", () => {
  const payloadOf = (envelopeXdr: string): Uint8Array => {
    const tx = TransactionBuilder.fromXDR(
      envelopeXdr,
      "Public Global Stellar Network ; September 2015",
    );
    const [op] = tx.operations;
    if (op.type !== "invokeHostFunction") throw new Error("not an invocation");
    if (op.func.type !== "hostFunctionTypeInvokeContract") {
      throw new Error("not a contract call");
    }
    const payload = op.func.invokeContract.args[2];
    if (payload.type !== "scvBytes") throw new Error("no payload");

    return payload.bytes.toBytes();
  };

  it("names the input and output token of a real route", () => {
    expect(readRouteTokens(payloadOf(fx.envelopeXdr))).toEqual({
      tokenIn: fx.sourceToken,
      tokenOut: fx.destinationToken,
    });
  });

  it("reads a route to a Soroban token", () => {
    expect(readRouteTokens(payloadOf(sorobanFx.envelopeXdr))).toEqual({
      tokenIn: fx.sourceToken,
      tokenOut: sorobanFx.destinationToken,
    });
  });

  it.each([
    ["not XDR", new Uint8Array([1, 2, 3])],
    ["not a struct", xdr.ScVal.scvU32(1).toXDR()],
    ["a struct without the route fields", xdr.ScVal.scvMap([]).toXDR()],
  ])("returns null for a payload that is %s", (_, payload) => {
    expect(readRouteTokens(payload)).toBeNull();
  });
});
