import { NETWORKS } from "config/constants";
import { useTransactionBuilderStore } from "ducks/transactionBuilder";
import { verifyAggregatorSwap } from "helpers/aggregatorSwap";
import { getPerOperationBaseFeeStroops } from "helpers/formatAmount";
import { buildChangeTrustTx } from "services/stellar";

jest.mock("helpers/aggregatorSwap", () => ({
  verifyAggregatorSwap: jest.fn(),
}));
jest.mock("services/stellar", () => ({
  ...jest.requireActual("services/stellar"),
  buildChangeTrustTx: jest.fn(),
}));

const mockVerify = verifyAggregatorSwap as jest.Mock;
const mockBuildTrustline = buildChangeTrustTx as jest.Mock;

const expectation = {
  network: NETWORKS.PUBLIC,
  sender: "G",
  sourceToken: "C1",
  destinationToken: "C2",
  sourceAmount: 1n,
  minDestinationAmount: 1n,
};

describe("useTransactionBuilderStore — aggregator swap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTransactionBuilderStore.getState().resetTransaction();
  });

  describe("prepareAggregatorSwap", () => {
    it("makes the verified transaction the one to sign and splits its fee", () => {
      mockVerify.mockReturnValue({
        feeStroops: 98024n,
        resourceFeeStroops: 97924n,
      });

      const xdr = useTransactionBuilderStore
        .getState()
        .prepareAggregatorSwap({ envelopeXdr: "envelope", expectation });

      const state = useTransactionBuilderStore.getState();
      expect(xdr).toBe("envelope");
      expect(mockVerify).toHaveBeenCalledWith("envelope", expectation);
      expect(state.transactionXDR).toBe("envelope");
      expect(state.signedTransactionXDR).toBeNull();
      expect(state.isSoroban).toBe(true);
      expect(state.sorobanResourceFeeXlm).toBe("0.0097924");
      expect(state.sorobanInclusionFeeXlm).toBe("0.0000100");
      expect(state.error).toBeNull();
    });

    it("keeps nothing to sign when the verifier rejects the transaction", () => {
      mockVerify.mockImplementation(() => {
        throw new Error(
          "Unsafe swap transaction: contract is not the swap router",
        );
      });

      const xdr = useTransactionBuilderStore
        .getState()
        .prepareAggregatorSwap({ envelopeXdr: "envelope", expectation });

      const state = useTransactionBuilderStore.getState();
      expect(xdr).toBeNull();
      expect(state.transactionXDR).toBeNull();
      expect(state.error).toContain("Unsafe swap transaction");
    });
  });

  describe("buildTrustlineTransaction", () => {
    const params = {
      tokenCode: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      transactionFee: "0.00001",
      transactionTimeout: 180,
      network: NETWORKS.PUBLIC,
      senderAddress: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    };

    it("stores the trustline transaction as the one to sign", async () => {
      mockBuildTrustline.mockResolvedValue("trustline-xdr");

      const xdr = await useTransactionBuilderStore
        .getState()
        .buildTrustlineTransaction(params);

      const state = useTransactionBuilderStore.getState();
      expect(mockBuildTrustline).toHaveBeenCalledWith({
        network: params.network,
        publicKey: params.senderAddress,
        tokenIdentifier: `USDC:${params.issuer}`,
        fee: getPerOperationBaseFeeStroops(params.transactionFee, 1),
        timeoutSeconds: params.transactionTimeout,
      });
      expect(xdr).toBe("trustline-xdr");
      expect(state.transactionXDR).toBe("trustline-xdr");
      expect(state.isSoroban).toBe(false);
      expect(state.isBuilding).toBe(false);
    });

    it("reports a failed build and stores nothing to sign", async () => {
      mockBuildTrustline.mockRejectedValue(new Error("account not found"));

      const xdr = await useTransactionBuilderStore
        .getState()
        .buildTrustlineTransaction(params);

      const state = useTransactionBuilderStore.getState();
      expect(xdr).toBeNull();
      expect(state.transactionXDR).toBeNull();
      expect(state.error).toBe(
        "Failed to build trustline transaction: account not found",
      );
    });
  });
});
