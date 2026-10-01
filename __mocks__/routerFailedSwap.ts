import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

/**
 * The transaction meta of the failed mainnet router swap 22543508 as Stellar
 * Expert serves it (`/explorer/public/tx/<hash>`, field `meta`): a v4
 * TransactionMeta trimmed to two diagnostic events, the host's `error` events
 * that the router (CCVENFSV..., see `ROUTER` in `routerSwapHistory`) emitted
 * when it failed the swap with its contract error 5, `SlippageExceeded`.
 * Horizon reported the same transaction only as `tx_failed` with a
 * `function_trapped` operation.
 */
export const routerSlippageFailedMeta =
  "AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAGqRpZVEHAz1cARc3Y1uKuztarvzinV0Rxv1Tu5Ua4H8gAAAAIAAAAAAAAAAgAAAA8AAAAFZXJyb3IAAAAAAAACAAAAAAAAAAUAAAAQAAAAAQAAAAIAAAAOAAAAG2ZhaWxpbmcgd2l0aCBjb250cmFjdCBlcnJvcgAAAAADAAAABQAAAAAAAAAAAAAAAapGllUQcDPVwBFzdjW4q7O1qu/OKdXRHG/VO7lRrgfyAAAAAgAAAAAAAAACAAAADwAAAAVlcnJvcgAAAAAAAAIAAAAAAAAABQAAAA4AAABLZXNjYWxhdGluZyBlcnJvciB0byBWTSB0cmFwIGZyb20gZmFpbGVkIGhvc3QgZnVuY3Rpb24gY2FsbDogZmFpbF93aXRoX2Vycm9yAA==";

/**
 * The same transaction's diagnostic events 6 and 7, trimmed the same way: the
 * `error` events of a pool contract (CARCKZ66...), not the router, failing
 * with its contract error 13.
 */
export const poolErrorFailedMeta =
  "AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAEiJWfepwCNd51suRAXn4VJc23xiIYO6PyGyjiA0mP4GAAAAAIAAAAAAAAAAgAAAA8AAAAFZXJyb3IAAAAAAAACAAAAAAAAAA0AAAAQAAAAAQAAAAIAAAAOAAAAJnRydXN0bGluZSBlbnRyeSBpcyBtaXNzaW5nIGZvciBhY2NvdW50AAAAAAASAAAAAAAAAAB9QaTEDYr27dJfZVu1T+a/+LhGmiRjVX2Tom7m89Gs1QAAAAAAAAAAAAAAAQp1nNm7qtEYqfjddf0jawIiZUNG1y62MD7NcXxSQyGTAAAAAgAAAAAAAAACAAAADwAAAAVlcnJvcgAAAAAAAAIAAAAAAAAADQAAABAAAAABAAAAAwAAAA4AAAAYY29udHJhY3QgdHJ5X2NhbGwgZmFpbGVkAAAADwAAAAdiYWxhbmNlAAAAABAAAAABAAAAAQAAABIAAAAAAAAAAH1BpMQNivbt0l9lW7VP5r/4uEaaJGNVfZOibubz0azV";

type MetaWire = ReturnType<xdr.TransactionMeta["toXdrObject"]>;
type V4Wire = Extract<MetaWire, { v: 4 }>["v4"];
type DiagnosticEventWire = V4Wire["diagnosticEvents"][number];

/** The decoded v4 meta of `routerSlippageFailedMeta`. */
const failedV4 = (): V4Wire => {
  const wire = xdr.TransactionMeta.fromXDR(
    routerSlippageFailedMeta,
    "base64",
  ).toXdrObject();
  if (wire.v !== 4) throw new Error("the fixture is a v4 meta");

  return wire.v4;
};

/** `routerSlippageFailedMeta` with its diagnostic events edited. */
export const withDiagnosticEvents = (
  edit: (events: DiagnosticEventWire[]) => DiagnosticEventWire[],
): string => {
  const v4 = failedV4();
  v4.diagnosticEvents = edit(v4.diagnosticEvents);

  return xdr.TransactionMeta.fromXdrObject({ v: 4, v4 }).toXDR("base64");
};

/** `routerSlippageFailedMeta` with its second topic (the error) replaced. */
export const withErrorTopic = (error: xdr.ScVal): string =>
  withDiagnosticEvents((events) =>
    events.map((diagnostic) => {
      const { v0 } = diagnostic.event.body;

      return {
        ...diagnostic,
        event: {
          ...diagnostic.event,
          body: {
            ...diagnostic.event.body,
            v0: { ...v0, topics: [v0.topics[0], error.toXdrObject()] },
          },
        },
      };
    }),
  );

/** `routerSlippageFailedMeta` rewritten as a v3 meta, whose diagnostics sit on its Soroban meta. */
export const failedMetaAsV3 = (): string => {
  const v4 = failedV4();

  return xdr.TransactionMeta.fromXdrObject({
    v: 3,
    v3: {
      ext: v4.ext,
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: {
        ext: { v: 0 },
        events: [],
        returnValue: nativeToScVal(null).toXdrObject(),
        diagnosticEvents: v4.diagnosticEvents,
      },
    },
  }).toXDR("base64");
};
