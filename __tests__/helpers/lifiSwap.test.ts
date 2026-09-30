/* eslint-disable @fnando/consistent-import/consistent-import */
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { PUBLIC_NETWORK_DETAILS } from "config/constants";
import { readLifiSwap } from "helpers/lifiSwap";

import fixture from "../../__mocks__/lifiSwapFixture.json";

const original = TransactionBuilder.fromXDR(
  fixture.transactionRequest.data,
  PUBLIC_NETWORK_DETAILS.networkPassphrase,
) as Transaction;
const expected = {
  sender: fixture.action.fromAddress,
  sourceAmount: BigInt(fixture.action.fromAmount),
  sourceToken: fixture.action.fromToken.address,
  destinationToken: fixture.action.toToken.address,
};
it("reads LI.FI history independently of XOXNO", () => {
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
