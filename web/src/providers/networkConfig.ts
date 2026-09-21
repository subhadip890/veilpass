/**
 * Preprod network configuration and initialization for Midnight.
 */

import {
  setNetworkId,
  getNetworkId,
  type NetworkId,
} from '@midnight-ntwrk/midnight-js-network-id';

export const SUPPORTED_NETWORK_ID = 'preprod' as const;
export type SupportedNetworkId = typeof SUPPORTED_NETWORK_ID;

export interface PreprodNetworkConfig {
  networkId: SupportedNetworkId;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
}

export const PREPROD_CONFIG: PreprodNetworkConfig = {
  networkId: SUPPORTED_NETWORK_ID,
  indexer:
    (import.meta.env?.VITE_INDEXER_URL as string | undefined) ||
    'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS:
    (import.meta.env?.VITE_INDEXER_WS_URL as string | undefined) ||
    'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer:
    (import.meta.env?.VITE_PROOF_SERVER_URL as string | undefined) ||
    'http://localhost:6300',
};

/**
 * Idempotently initializes the global Midnight network ID to 'preprod'.
 *
 * Rules:
 * - Validates VITE_NETWORK_ID if present (must equal 'preprod').
 * - For this Preprod-only app, a missing VITE_NETWORK_ID safely defaults to 'preprod'.
 * - Rejects any unsupported or undeployed network values (e.g. 'preview', 'undeployed').
 * - Safely tolerates React StrictMode, Vite HMR, and repeated calls without reconfiguring.
 * - Throws if an already-configured conflicting network is detected; never silently changes it.
 * - Must be called before CompiledContract.make(), deployContract(), provider creation,
 *   transaction balancing, or any contract/runtime operation.
 *
 * @param requestedNetwork Optional network identifier to validate/configure.
 * @returns The configured SupportedNetworkId ('preprod').
 */
export { setNetworkId, getNetworkId };

export function initializeMidnightNetwork(requestedNetwork?: string): SupportedNetworkId {
  const envNetwork = (import.meta.env?.VITE_NETWORK_ID as string | undefined)?.trim();
  const target = (requestedNetwork ?? envNetwork ?? SUPPORTED_NETWORK_ID).toLowerCase();

  if (target !== SUPPORTED_NETWORK_ID) {
    throw new Error(
      `Unsupported Midnight network ID: "${target}". VeilPass Level 2 only supports "${SUPPORTED_NETWORK_ID}".`
    );
  }

  let existing: NetworkId | undefined;
  try {
    existing = getNetworkId();
  } catch {
    existing = undefined;
  }

  if (existing !== undefined) {
    if (existing !== SUPPORTED_NETWORK_ID) {
      throw new Error(
        `Conflicting Midnight network ID already configured: "${existing}". Cannot silently switch to "${SUPPORTED_NETWORK_ID}".`
      );
    }
    return SUPPORTED_NETWORK_ID;
  }

  setNetworkId(SUPPORTED_NETWORK_ID);
  return SUPPORTED_NETWORK_ID;
}
