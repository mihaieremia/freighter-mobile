/* eslint-disable @fnando/consistent-import/consistent-import */
/* eslint-disable global-require, @typescript-eslint/no-var-requires, react/react-in-jsx-scope */
import { render } from "@testing-library/react-native";
import { BigNumber } from "bignumber.js";
import { TokenIcon } from "components/TokenIcon";
import { TokenProps } from "components/sds/Token";
import {
  NonNativeToken,
  TokenTypeWithCustomToken,
  Balance,
  LiquidityPoolBalance,
  NativeToken,
} from "config/types";
import { useTokenIconsStore } from "ducks/tokenIcons";
import { useTokenCatalogEntry } from "hooks/useTokenCatalogEntry";

import {
  CATALOG_SOROBAN_CONTRACT,
  catalogUsdc,
} from "../../__mocks__/tokenCatalog";

// Mock the token icons store
jest.mock("ducks/tokenIcons", () => ({
  useTokenIconsStore: jest.fn(),
}));

jest.mock("hooks/useTokenCatalogEntry", () => ({
  useTokenCatalogEntry: jest.fn(),
}));

// Mock the logos
jest.mock("assets/logos", () => ({
  logos: {
    stellar: "stellar-logo-url",
    usdc: "usdc-logo-url",
  },
}));

// Mock the balances helper. jest.mock factories are hoisted above the
// module's own imports, so the predicate is pulled in lazily via require
// here rather than a top-level import (which would be out of scope by the
// time this factory runs).
jest.mock("helpers/balances", () => {
  const { isNativeToken } =
    require("helpers/assetIdentity") as typeof import("helpers/assetIdentity");
  return {
    getTokenIdentifier: (token: NonNativeToken | NativeToken) => {
      if (isNativeToken(token)) return "XLM";
      return `${token.code}:${token.issuer.key}`;
    },
    isLiquidityPool: (balance: Balance) => "liquidityPoolId" in balance,
  };
});

// Mock react-i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock the Token component
jest.mock("components/sds/Token", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  return {
    Token: ({ sourceOne, size, variant }: TokenProps) => (
      <View testID="token" data-size={size} data-variant={variant}>
        {sourceOne.image && <Text testID="image-url">{sourceOne.image}</Text>}
        {sourceOne.renderContent && sourceOne.renderContent()}
      </View>
    ),
  };
});

describe("TokenIcon", () => {
  const mockUseTokenIconsStore = useTokenIconsStore as jest.MockedFunction<
    typeof useTokenIconsStore
  >;

  const mockUseTokenCatalogEntry = useTokenCatalogEntry as jest.Mock;
  const mockValidateIconOnAccess = jest.fn();
  let mockState: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTokenCatalogEntry.mockReturnValue(undefined);
    mockState = {
      icons: {},
      validateIconOnAccess: mockValidateIconOnAccess,
      failedTokenCodes: {},
    };

    // Mock implementation to handle selectors
    mockUseTokenIconsStore.mockImplementation((selector) => {
      if (typeof selector === "function") {
        return selector(mockState);
      }
      return mockState;
    });
  });

  it("renders Stellar logo for native XLM token", () => {
    const { getByTestId } = render(
      <TokenIcon
        token={{
          type: "native",
          code: "XLM",
        }}
      />,
    );

    const imageUrl = getByTestId("image-url");
    expect(imageUrl.props.children).toBe("stellar-logo-url");
  });

  it("renders token initials when no icon is available", () => {
    const { getByText } = render(
      <TokenIcon
        token={{
          code: "USDC",
          issuer: {
            key: "GBBD47UZQ2BNSE5O27ZIVVKV4OZVL2D7OEHTASAA5HQYKWNGZFYMHZWZ",
          },
          type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
        }}
      />,
    );

    expect(getByText("US")).toBeTruthy();
  });

  it("renders a single initial in the fallback when singleLetterFallback is set", () => {
    const { getByText, queryByText } = render(
      <TokenIcon
        singleLetterFallback
        token={{
          code: "USDC",
          issuer: {
            key: "GBBD47UZQ2BNSE5O27ZIVVKV4OZVL2D7OEHTASAA5HQYKWNGZFYMHZWZ",
          },
          type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
        }}
      />,
    );

    expect(getByText("U")).toBeTruthy();
    expect(queryByText("US")).toBeNull();
  });

  it("renders Circle USDC with bundled logo", () => {
    const { getByTestId } = render(
      <TokenIcon
        token={{
          code: "USDC",
          issuer: {
            key: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          },
          type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
        }}
      />,
    );

    const imageUrl = getByTestId("image-url");
    expect(imageUrl.props.children).toBe("usdc-logo-url");
  });

  it("renders LP text for liquidity pool tokens", () => {
    const mockLPBalance = {
      total: new BigNumber("100"),
      liquidityPoolId: "pool-123",
    } as LiquidityPoolBalance;

    const { getByText } = render(<TokenIcon token={mockLPBalance} />);
    expect(getByText("LP")).toBeTruthy();
  });

  it("shows fallback letters while icon is validating", () => {
    const issuerKey =
      "GBBD47UZQ2BNSE5O27ZIVVKV4OZVL2D7OEHTASAA5HQYKWNGZFYMHZWZ";
    const cacheKey = `USDC:${issuerKey}`;

    mockState.icons = {
      [cacheKey]: {
        imageUrl: "https://example.com/icon.png",
        network: "PUBLIC",
        isValidated: false,
        isValid: null,
      },
    };

    const { getByText } = render(
      <TokenIcon
        token={{
          code: "USDC",
          issuer: {
            key: issuerKey,
          },
          type: TokenTypeWithCustomToken.CREDIT_ALPHANUM12,
        }}
      />,
    );

    expect(getByText("US")).toBeTruthy();
  });
  describe("catalog logo fallback", () => {
    const sorobanToken = {
      code: "XAUM",
      issuer: { key: CATALOG_SOROBAN_CONTRACT },
      type: TokenTypeWithCustomToken.CUSTOM_TOKEN,
    };
    const classicToken = {
      code: "EURC",
      issuer: {
        key: "GBBD47UZQ2BNSE5O27ZIVVKV4OZVL2D7OEHTASAA5HQYKWNGZFYMHZWZ",
      },
      type: TokenTypeWithCustomToken.CREDIT_ALPHANUM4,
    };

    it("looks the catalog up by the token identifier", () => {
      render(<TokenIcon token={sorobanToken} />);

      expect(mockUseTokenCatalogEntry).toHaveBeenCalledWith(
        `XAUM:${CATALOG_SOROBAN_CONTRACT}`,
      );
    });

    it("shows the catalog logo when no other source has one", () => {
      mockUseTokenCatalogEntry.mockReturnValue(catalogUsdc);

      const { getByTestId } = render(<TokenIcon token={classicToken} />);

      expect(getByTestId("image-url").props.children).toBe(catalogUsdc.iconUrl);
    });

    it("keeps the cached icon over the catalog logo", () => {
      mockUseTokenCatalogEntry.mockReturnValue(catalogUsdc);
      mockState.icons = {
        [`EURC:${classicToken.issuer.key}`]: {
          imageUrl: "https://example.com/eurc.png",
          network: "PUBLIC",
          isValidated: true,
          isValid: true,
        },
      };

      const { getByTestId } = render(<TokenIcon token={classicToken} />);

      expect(getByTestId("image-url").props.children).toBe(
        "https://example.com/eurc.png",
      );
    });

    it("keeps an explicit iconUrl over the catalog logo", () => {
      mockUseTokenCatalogEntry.mockReturnValue(catalogUsdc);

      const { getByTestId } = render(
        <TokenIcon token={classicToken} iconUrl="https://example.com/x.png" />,
      );

      expect(getByTestId("image-url").props.children).toBe(
        "https://example.com/x.png",
      );
    });

    it("uses the catalog logo when the cached icon failed validation", () => {
      mockUseTokenCatalogEntry.mockReturnValue(catalogUsdc);
      mockState.icons = {
        [`EURC:${classicToken.issuer.key}`]: {
          imageUrl: "https://example.com/dead.png",
          network: "PUBLIC",
          isValidated: true,
          isValid: false,
        },
      };

      const { getByTestId } = render(<TokenIcon token={classicToken} />);

      expect(getByTestId("image-url").props.children).toBe(catalogUsdc.iconUrl);
    });

    it("shows initials when neither the sources nor the catalog have a logo", () => {
      const { getByText, queryByTestId } = render(
        <TokenIcon token={classicToken} />,
      );

      expect(queryByTestId("image-url")).toBeNull();
      expect(getByText("EU")).toBeTruthy();
    });
  });
});
