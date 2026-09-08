import { NETWORKS, NetworkDetails } from "config/constants";

/**
 * XOXNO lending deployment, per network. Addresses match
 * `rs-lending-xlm/configs/networks.json`; the controller is the only contract
 * this flow calls (`supply`), so the pool and position-NFT addresses are not
 * needed here.
 *
 * Networks absent from this map do not support Earn — see `isEarnSupportedNetwork`.
 */
export const XOXNO_CONTROLLER_IDS: Partial<Record<NETWORKS, string>> = {
  [NETWORKS.PUBLIC]: "CAUCMIN5KSXEVZ7NMXR3LZATGD5EFIEUI5XWTFLYRO2R5OTXI22WE5JX",
  [NETWORKS.TESTNET]: "CCXRWJ6SIU2WPFEGLFGJVITPL57QAYIMIO6OAM2NBGNDQSSCK2FFV3F3",
};

export const getXoxnoControllerId = (networkDetails: NetworkDetails) =>
  XOXNO_CONTROLLER_IDS[networkDetails.network];

/**
 * Earn is only available where XOXNO is deployed. The backend's protocol
 * routes also reject any `?network=` outside PUBLIC/TESTNET, so gating here
 * keeps the flow to a single code path with no custom-network fallback.
 */
export const isEarnSupportedNetwork = (networkDetails: NetworkDetails) =>
  Boolean(getXoxnoControllerId(networkDetails));
