/**
 * Assembles all Midnight.js providers for Preprod in the browser.
 */

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ConnectedAPI } from '../types/midnight';
import { PREPROD_CONFIG, initializeMidnightNetwork } from './networkConfig';
import { FetchZkConfigProvider } from './FetchZkConfigProvider';
import { createBrowserPrivateStateProvider } from './browserPrivateStateProvider';
import { createLaceWalletProvider, type DeploymentStage } from './laceWalletProvider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

export interface PreprodProvidersOptions {
  onStageChange?: (stage: DeploymentStage, metadata?: Record<string, unknown>) => void;
}

export async function createPreprodProviders(
  connectedApi: ConnectedAPI,
  options?: PreprodProvidersOptions
): Promise<MidnightProviders> {
  // Ensure network ID is initialized before provider creation
  initializeMidnightNetwork();

  const zkConfigProvider = new FetchZkConfigProvider('/midnight/veilpass');
  const privateStateProvider = createBrowserPrivateStateProvider('veilpass-preprod');
  const proofProvider = httpClientProofProvider(PREPROD_CONFIG.proofServer, zkConfigProvider);
  const publicDataProvider = indexerPublicDataProvider(PREPROD_CONFIG.indexer, PREPROD_CONFIG.indexerWS);
  const walletProvider = await createLaceWalletProvider(connectedApi, options);

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}
