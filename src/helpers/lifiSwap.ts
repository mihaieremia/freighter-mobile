import { scValToBigInt, xdr } from "@stellar/stellar-sdk";
import { addressToString, scValFields } from "helpers/soroban";

const fail = (): never => {
  throw new Error(
    "Unsafe swap transaction: LI.FI trade or authorization differs",
  );
};
const address = (v?: xdr.ScVal): string | null =>
  v?.type === "scvAddress" ? addressToString(v.address) : null;
const integer = (v?: xdr.ScVal): bigint =>
  v?.type === "scvI128" ? scValToBigInt(v) : fail();
const vector = (v?: xdr.ScVal): xdr.ScVal[] =>
  v?.type === "scvVec" && v.vec ? v.vec : fail();
export const readLifiSwap = (args: xdr.ScVal[]) => {
  try {
    if (args.length !== 2) return null;
    const payload = scValFields(args[0], [
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
