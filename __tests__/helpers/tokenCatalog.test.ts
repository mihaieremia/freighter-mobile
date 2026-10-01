/* eslint-disable @fnando/consistent-import/consistent-import */
import BigNumber from "bignumber.js";
import { PUBLIC_NETWORK_DETAILS } from "config/constants";
import { PricedBalanceMap } from "config/types";
import {
  fillMissingPricesFromCatalog,
  getCatalogContractId,
  getCatalogEntry,
  getCatalogIconUrl,
  getCatalogPrice,
} from "helpers/tokenCatalog";

import {
  CATALOG_SOROBAN_CONTRACT,
  CATALOG_USDC_ISSUER,
  CATALOG_USDC_SAC,
  CATALOG_XLM_SAC,
  catalogByContractId,
  catalogSoroban,
  catalogUnpriced,
  catalogUsdc,
  catalogXlm,
} from "../../__mocks__/tokenCatalog";

const { networkPassphrase } = PUBLIC_NETWORK_DETAILS;

describe("getCatalogContractId", () => {
  it("derives the native SAC for XLM", () => {
    expect(getCatalogContractId("XLM", networkPassphrase)).toBe(
      CATALOG_XLM_SAC,
    );
  });

  it("derives the SAC of a classic asset", () => {
    expect(
      getCatalogContractId(`USDC:${CATALOG_USDC_ISSUER}`, networkPassphrase),
    ).toBe(CATALOG_USDC_SAC);
  });

  it("derives a different SAC on another network", () => {
    expect(
      getCatalogContractId(
        `USDC:${CATALOG_USDC_ISSUER}`,
        "Test SDF Network ; September 2015",
      ),
    ).not.toBe(CATALOG_USDC_SAC);
  });

  it("returns a Soroban token's own contract, from an identifier or bare", () => {
    expect(
      getCatalogContractId(
        `XAUM:${CATALOG_SOROBAN_CONTRACT}`,
        networkPassphrase,
      ),
    ).toBe(CATALOG_SOROBAN_CONTRACT);
    expect(
      getCatalogContractId(CATALOG_SOROBAN_CONTRACT, networkPassphrase),
    ).toBe(CATALOG_SOROBAN_CONTRACT);
  });

  it("returns undefined for input that names no token", () => {
    expect(getCatalogContractId("", networkPassphrase)).toBeUndefined();
    expect(getCatalogContractId("USDC", networkPassphrase)).toBeUndefined();
    expect(
      getCatalogContractId("USDC:not-an-issuer", networkPassphrase),
    ).toBeUndefined();
    expect(
      getCatalogContractId(`${"a".repeat(64)}:lp`, networkPassphrase),
    ).toBeUndefined();
  });
});

describe("getCatalogEntry", () => {
  const byContractId = catalogByContractId(catalogUsdc, catalogSoroban);

  it("finds a classic asset by its SAC", () => {
    expect(
      getCatalogEntry(
        byContractId,
        `USDC:${CATALOG_USDC_ISSUER}`,
        networkPassphrase,
      ),
    ).toBe(catalogUsdc);
  });

  it("finds a Soroban token by its contract", () => {
    expect(
      getCatalogEntry(
        byContractId,
        `XAUM:${CATALOG_SOROBAN_CONTRACT}`,
        networkPassphrase,
      ),
    ).toBe(catalogSoroban);
  });

  it("returns undefined for a token the catalog lacks or before it loads", () => {
    expect(getCatalogEntry(byContractId, "XLM", networkPassphrase)).toBe(
      undefined,
    );
    expect(getCatalogEntry(undefined, "XLM", networkPassphrase)).toBe(
      undefined,
    );
  });
});

describe("getCatalogIconUrl", () => {
  it("uses the entry's logo when it has one", () => {
    expect(getCatalogIconUrl(catalogUsdc)).toBe(catalogUsdc.iconUrl);
  });

  it("falls back to the deterministic media URL", () => {
    expect(getCatalogIconUrl(catalogSoroban)).toBe(
      `https://media.xoxno.com/tokens/${CATALOG_SOROBAN_CONTRACT}/logo.png`,
    );
    expect(getCatalogIconUrl(catalogXlm)).toBe(
      `https://media.xoxno.com/tokens/${CATALOG_XLM_SAC}/logo.png`,
    );
  });
});

describe("getCatalogPrice", () => {
  it("returns the price when it is positive", () => {
    expect(getCatalogPrice(catalogSoroban)?.toString()).toBe("4200");
  });

  it("returns undefined when the price is 0, missing or the entry is absent", () => {
    expect(getCatalogPrice(catalogUnpriced)).toBeUndefined();
    expect(
      getCatalogPrice({ ...catalogSoroban, priceUsd: undefined }),
    ).toBeUndefined();
    expect(getCatalogPrice(undefined)).toBeUndefined();
  });
});

describe("fillMissingPricesFromCatalog", () => {
  const sorobanId = `XAUM:${CATALOG_SOROBAN_CONTRACT}`;
  const usdcId = `USDC:${CATALOG_USDC_ISSUER}`;
  const soroban = {
    token: { code: "XAUM", issuer: { key: CATALOG_SOROBAN_CONTRACT } },
    decimals: 9,
    total: new BigNumber("1608622"),
    currentPrice: null,
    percentagePriceChange24h: null,
  };
  const usdc = {
    token: { code: "USDC", issuer: { key: CATALOG_USDC_ISSUER } },
    total: new BigNumber(10),
    currentPrice: new BigNumber("0.99"),
    fiatTotal: new BigNumber("9.9"),
  };

  const fill = (balances: object, entries = [catalogUsdc, catalogSoroban]) =>
    fillMissingPricesFromCatalog(
      balances as PricedBalanceMap,
      catalogByContractId(...entries),
      networkPassphrase,
    );

  it("fills a missing price and the fiat total from the catalog", () => {
    const filled = fill({ [sorobanId]: soroban })[sorobanId];

    expect(filled.currentPrice?.toString()).toBe("4200");
    expect(filled.fiatTotal?.toString()).toBe("6.7562124");
    expect(filled.fiatCode).toBe("USD");
    expect(filled.percentagePriceChange24h).toBeNull();
  });

  it("fills a zero price", () => {
    const filled = fill({
      [sorobanId]: { ...soroban, currentPrice: new BigNumber(0) },
    })[sorobanId];

    expect(filled.currentPrice?.toString()).toBe("4200");
  });

  it("keeps an existing price even when the catalog disagrees", () => {
    const result = fill({ [usdcId]: usdc });

    expect(result[usdcId]).toBe(usdc);
  });

  it("leaves a token without a positive catalog price unpriced", () => {
    const result = fill({ [sorobanId]: soroban }, [catalogUnpriced]);

    expect(result[sorobanId]).toBe(soroban);
  });

  it("leaves a token the catalog does not list, and liquidity pools, as they are", () => {
    const lp = { total: new BigNumber(1), liquidityPoolId: "abc" };
    const result = fill({ [sorobanId]: soroban, "abc:lp": lp }, [catalogUsdc]);

    expect(result[sorobanId]).toBe(soroban);
    expect(result["abc:lp"]).toBe(lp);
  });

  it("returns the balances untouched before the catalog loads", () => {
    const balances = { [sorobanId]: soroban } as unknown as PricedBalanceMap;

    expect(
      fillMissingPricesFromCatalog(balances, undefined, networkPassphrase),
    ).toBe(balances);
  });
});
