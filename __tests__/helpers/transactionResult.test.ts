/* eslint-disable @fnando/consistent-import/consistent-import */
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  findPathPaymentStrictSendIndex,
  getReceivedTokenAmountFromMeta,
  getSettledPathPaymentStrictSendAmount,
  isRouterSlippageFailure,
  isTransactionResultSuccess,
} from "helpers/transactionResult";

import {
  failedMetaAsV3,
  poolErrorFailedMeta,
  routerSlippageFailedMeta,
  withDiagnosticEvents,
  withErrorTopic,
} from "../../__mocks__/routerFailedSwap";
import {
  OTHER_ACCOUNT,
  ROUTER,
  SWAPPER,
  XAUM_CONTRACT,
  asV3,
  realV4,
  usdcToXaumMeta,
  withLastEvent,
} from "../../__mocks__/routerSwapHistory";

/** The result of a pathPaymentStrictSend that settled `stroops` of the destination asset. */
const pathPaymentOk = (stroops: string) =>
  xdr.OperationResult.opInner(
    xdr.OperationResultTr.pathPaymentStrictSend(
      xdr.PathPaymentStrictSendResult.pathPaymentStrictSendSuccess(
        new xdr.PathPaymentStrictSendResultSuccess({
          offers: [],
          last: new xdr.SimplePaymentResult({
            destination: xdr.PublicKey.publicKeyTypeEd25519(
              Keypair.random().rawPublicKey(),
            ),
            asset: Asset.native().toXdrObject(),
            amount: BigInt(stroops),
          }),
        }),
      ),
    ),
  );

const resultXdr = (result: xdr.TransactionResultResult) =>
  new xdr.TransactionResult({
    feeCharged: BigInt("100"),
    result,
    ext: xdr.TransactionResultExt.v0(),
  }).toXdr("base64");

/** Builds a TransactionResult XDR (base64) whose op at `index` settled a
 * pathPaymentStrictSend for `stroops`, padded with plain payment successes. */
const buildPathPaymentSuccessResultXdr = (
  stroops: string,
  index: number,
  opCount: number,
): string => {
  const plainPaymentOpResult = xdr.OperationResult.opInner(
    xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
  );

  return resultXdr(
    xdr.TransactionResultResult.txSuccess(
      Array.from({ length: opCount }, (_, i) =>
        i === index ? pathPaymentOk(stroops) : plainPaymentOpResult,
      ),
    ),
  );
};

describe("getSettledPathPaymentStrictSendAmount", () => {
  it("reads the settled destination amount in whole units", () => {
    const success = buildPathPaymentSuccessResultXdr("50000000", 0, 1);
    const amount = getSettledPathPaymentStrictSendAmount(success, 0);
    expect(amount?.toString()).toBe("5");
  });

  it("selects the operation by index when preceded by other operations (e.g. a changeTrust)", () => {
    const success = buildPathPaymentSuccessResultXdr("12345000", 1, 2);
    expect(getSettledPathPaymentStrictSendAmount(success, 1)?.toString()).toBe(
      "1.2345",
    );
    // The other operation at index 0 is a plain payment success, not a path
    // payment — reading it as one fails cleanly rather than misreading data.
    expect(getSettledPathPaymentStrictSendAmount(success, 0)).toBeNull();
  });

  it("returns null for a negative or missing operation index", () => {
    const success = buildPathPaymentSuccessResultXdr("50000000", 0, 1);
    expect(getSettledPathPaymentStrictSendAmount(success, -1)).toBeNull();
    expect(getSettledPathPaymentStrictSendAmount(success, 5)).toBeNull();
  });

  it("returns null (never throws) for garbage XDR", () => {
    expect(
      getSettledPathPaymentStrictSendAmount("not-valid-xdr", 0),
    ).toBeNull();
    expect(
      getSettledPathPaymentStrictSendAmount(undefined as unknown as string, 0),
    ).toBeNull();
  });

  it("returns null when the operation didn't succeed", () => {
    const failedResult = xdr.OperationResult.opInner(
      xdr.OperationResultTr.pathPaymentStrictSend(
        xdr.PathPaymentStrictSendResult.pathPaymentStrictSendUnderfunded(),
      ),
    );

    expect(
      getSettledPathPaymentStrictSendAmount(
        resultXdr(xdr.TransactionResultResult.txFailed([failedResult])),
        0,
      ),
    ).toBeNull();
  });

  it("returns null when the path payment succeeded but a later operation failed", () => {
    // Stellar transactions are atomic: a txFailed result still reports the
    // earlier operation's own success, but that path payment was rolled back
    // and nothing settled. Reading the amount out of it would report volume
    // for a swap that never happened.
    const laterFailedOp = xdr.OperationResult.opInner(
      xdr.OperationResultTr.payment(xdr.PaymentResult.paymentUnderfunded()),
    );

    expect(
      getSettledPathPaymentStrictSendAmount(
        resultXdr(
          xdr.TransactionResultResult.txFailed([
            pathPaymentOk("50000000"),
            laterFailedOp,
          ]),
        ),
        0,
      ),
    ).toBeNull();
  });
});

describe("findPathPaymentStrictSendIndex", () => {
  it("finds the operation's position, after an optional changeTrust", () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.changeTrust({
          asset: new Asset("USDC", Keypair.random().publicKey()),
        }),
      )
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: Asset.native(),
          sendAmount: "5",
          destination: kp.publicKey(),
          destAsset: new Asset("USDC", Keypair.random().publicKey()),
          destMin: "1",
          path: [],
        }),
      )
      .setTimeout(30)
      .build();

    expect(findPathPaymentStrictSendIndex(tx)).toBe(1);
  });

  it("returns -1 when no operation is a pathPaymentStrictSend", () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: kp.publicKey(),
          asset: Asset.native(),
          amount: "5",
        }),
      )
      .setTimeout(30)
      .build();

    expect(findPathPaymentStrictSendIndex(tx)).toBe(-1);
  });
});

describe("getReceivedTokenAmountFromMeta", () => {
  // usdcToXaumMeta: a real mainnet v4 meta whose last event is the XAUM
  // transfer of 1608622 base units from the router to the swapper.
  const RECEIVED = 1608622n;

  it("reads the amount the viewer received from a real v4 meta", () => {
    expect(
      getReceivedTokenAmountFromMeta(usdcToXaumMeta, XAUM_CONTRACT, SWAPPER),
    ).toBe(RECEIVED);
  });

  it("reads a v3 meta from its Soroban meta events", () => {
    expect(getReceivedTokenAmountFromMeta(asV3(), XAUM_CONTRACT, SWAPPER)).toBe(
      RECEIVED,
    );
  });

  it("reads event data that is a bare i128", () => {
    const meta = withLastEvent((event) => ({
      ...event,
      body: {
        ...event.body,
        v0: {
          ...event.body.v0,
          data: nativeToScVal(RECEIVED, { type: "i128" }).toXdrObject(),
        },
      },
    }));

    expect(getReceivedTokenAmountFromMeta(meta, XAUM_CONTRACT, SWAPPER)).toBe(
      RECEIVED,
    );
  });

  it("sums every transfer of the token to the viewer", () => {
    const v4 = realV4();
    const [{ events }] = v4.operations;
    events.push(events[events.length - 1]);
    const meta = xdr.TransactionMeta.fromXdrObject({ v: 4, v4 }).toXDR(
      "base64",
    );

    expect(getReceivedTokenAmountFromMeta(meta, XAUM_CONTRACT, SWAPPER)).toBe(
      RECEIVED * 2n,
    );
  });

  it("is null for a transfer to another recipient", () => {
    const meta = withLastEvent((event) => ({
      ...event,
      body: {
        ...event.body,
        v0: {
          ...event.body.v0,
          topics: [
            event.body.v0.topics[0],
            event.body.v0.topics[1],
            new Address(OTHER_ACCOUNT).toScVal().toXdrObject(),
          ],
        },
      },
    }));

    expect(
      getReceivedTokenAmountFromMeta(meta, XAUM_CONTRACT, SWAPPER),
    ).toBeNull();
  });

  it("is null when another token contract emitted the transfer", () => {
    const meta = withLastEvent((event) => ({
      ...event,
      contractId: StrKey.decodeContract(ROUTER),
    }));

    expect(
      getReceivedTokenAmountFromMeta(meta, XAUM_CONTRACT, SWAPPER),
    ).toBeNull();
  });

  it("is null when the viewer is not the account that received", () => {
    expect(
      getReceivedTokenAmountFromMeta(
        usdcToXaumMeta,
        XAUM_CONTRACT,
        OTHER_ACCOUNT,
      ),
    ).toBeNull();
  });

  it("is null, not a throw, for malformed XDR", () => {
    expect(
      getReceivedTokenAmountFromMeta("not-xdr", XAUM_CONTRACT, SWAPPER),
    ).toBeNull();
    expect(
      getReceivedTokenAmountFromMeta("", XAUM_CONTRACT, SWAPPER),
    ).toBeNull();
  });
});

describe("isTransactionResultSuccess", () => {
  it("is true for a successful transaction result", () => {
    expect(
      isTransactionResultSuccess(buildPathPaymentSuccessResultXdr("1", 0, 1)),
    ).toBe(true);
  });

  it("is false for a failed transaction result", () => {
    const failed = new xdr.TransactionResult({
      feeCharged: BigInt("100"),
      result: xdr.TransactionResultResult.txFailed([]),
      ext: xdr.TransactionResultExt.v0(),
    }).toXdr("base64");

    expect(isTransactionResultSuccess(failed)).toBe(false);
  });

  it("is false, not a throw, for malformed XDR", () => {
    expect(isTransactionResultSuccess("not-xdr")).toBe(false);
  });
});

describe("isRouterSlippageFailure", () => {
  // routerSlippageFailedMeta: the real meta of a failed mainnet router swap;
  // the router itself emitted its SlippageExceeded (contract error 5).
  const TESTNET_ROUTER =
    "CDNTWMWW2WGYTKIZTJYNGNVQQZI4KTC5BQRZ3275KESRX5T4O3AYECL5";

  it("is true when the router itself failed the swap with SlippageExceeded", () => {
    expect(isRouterSlippageFailure(routerSlippageFailedMeta, ROUTER)).toBe(
      true,
    );
  });

  it("is false when the error came from a contract other than the router", () => {
    expect(
      isRouterSlippageFailure(routerSlippageFailedMeta, XAUM_CONTRACT),
    ).toBe(false);
    expect(
      isRouterSlippageFailure(routerSlippageFailedMeta, TESTNET_ROUTER),
    ).toBe(false);
  });

  it("is false for another contract's error, with another code", () => {
    expect(isRouterSlippageFailure(poolErrorFailedMeta, ROUTER)).toBe(false);
  });

  it("is false when the router failed with another contract error code", () => {
    const meta = withErrorTopic(
      xdr.ScVal.scvError(xdr.ScError.sceContract(13)),
    );

    expect(isRouterSlippageFailure(meta, ROUTER)).toBe(false);
  });

  it("is false when the router failed with an error that is not a contract error", () => {
    const meta = withErrorTopic(
      xdr.ScVal.scvError(
        xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction),
      ),
    );

    expect(isRouterSlippageFailure(meta, ROUTER)).toBe(false);
  });

  it("is false for a bare host_fn_failed event with no emitting contract", () => {
    const meta = withDiagnosticEvents((events) =>
      events.map((diagnostic) => {
        const { v0 } = diagnostic.event.body;

        return {
          ...diagnostic,
          event: {
            ...diagnostic.event,
            contractId: null,
            body: {
              ...diagnostic.event.body,
              v0: {
                ...v0,
                topics: [
                  xdr.ScVal.scvSymbol("host_fn_failed").toXdrObject(),
                  v0.topics[1],
                ],
              },
            },
          },
        };
      }),
    );

    expect(isRouterSlippageFailure(meta, ROUTER)).toBe(false);
  });

  it("is false for a meta without diagnostic events", () => {
    expect(
      isRouterSlippageFailure(
        withDiagnosticEvents(() => []),
        ROUTER,
      ),
    ).toBe(false);
  });

  it("is false for a v3 meta, which is unknown", () => {
    expect(isRouterSlippageFailure(failedMetaAsV3(), ROUTER)).toBe(false);
  });

  it("is false, not a throw, for a meta that cannot be decoded", () => {
    expect(isRouterSlippageFailure("not-xdr", ROUTER)).toBe(false);
    expect(isRouterSlippageFailure("", ROUTER)).toBe(false);
  });
});
