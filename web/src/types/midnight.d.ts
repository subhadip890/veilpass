/**
 * Type declarations for the Midnight DApp Connector API.
 *
 * Source of truth: @midnight-ntwrk/dapp-connector-api@4.0.1
 *   dist/globals.d.ts  → window.midnight registry shape
 *   dist/api.d.ts      → InitialAPI, ConnectedAPI, Configuration
 */

export type {
  InitialAPI,
  ConnectedAPI,
  WalletConnectedAPI,
  HintUsage,
  Configuration,
  ConnectionStatus,
  APIError,
} from '@midnight-ntwrk/dapp-connector-api';

declare global {
  interface Window {
    /**
     * Midnight DApp Connector registry.
     * Keys are arbitrary strings: UUIDs, legacy names ("mnLace"), etc.
     * Values are InitialAPI objects.
     * Always enumerate via Object.values() or Object.entries().
     */
    midnight?: {
      [key: string]: import('@midnight-ntwrk/dapp-connector-api').InitialAPI;
    };
  }
}
