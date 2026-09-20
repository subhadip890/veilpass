/**
 * Type declarations for the Midnight DApp Connector API.
 *
 * Source of truth: @midnight-ntwrk/dapp-connector-api@4.0.1
 *   dist/globals.d.ts  → window.midnight registry shape
 *   dist/api.d.ts      → InitialAPI, ConnectedAPI, Configuration
 *
 * IMPORTANT: window.midnight is a REGISTRY of providers keyed by arbitrary
 * strings (UUIDs, legacy names like "mnLace", etc.).
 * Do NOT assume any fixed key; enumerate Object.values(window.midnight).
 */

// ── API types (subset needed by the frontend) ────────────────────────────────

/** Initial (pre-connection) wallet API – injected into window.midnight. */
export type InitialAPI = {
  /**
   * Stable reverse-DNS wallet identifier (e.g. "io.lace.midnight").
   * Use this to identify a specific wallet; do not rely on the registry key.
   */
  rdns: string;
  /** Human-readable wallet name, safe to display as text (sanitise for XSS). */
  name: string;
  /** Wallet icon URL or base64 data URI. Display via <img> only, never innerHTML. */
  icon: string;
  /** Version of @midnight-ntwrk/dapp-connector-api the wallet implements. */
  apiVersion: string;
  /**
   * Connect to the wallet on the requested network.
   * May throw an APIError (check .type === 'DAppConnectorAPIError').
   */
  connect: (networkId: string) => Promise<ConnectedAPI>;
};

/** API available after a successful connection. */
export type ConnectedAPI = WalletConnectedAPI & HintUsage;

export type WalletConnectedAPI = {
  /** Get the unshielded (public) address of the wallet in Bech32m format. */
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  /** Get current wallet service configuration, including the connected networkId. */
  getConfiguration(): Promise<Configuration>;
  /** Check whether the connection to the wallet is still alive. */
  getConnectionStatus(): Promise<ConnectionStatus>;
  // … other methods (balances, transactions) not used by this DApp yet
};

export type HintUsage = {
  hintUsage(methodNames: string[]): Promise<void>;
};

export type Configuration = {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  substrateNodeUri: string;
  /** Network id the wallet is connected to. */
  networkId: string;
};

export type ConnectionStatus =
  | { status: 'connected'; networkId: string }
  | { status: 'disconnected' };

export type APIError = Error & {
  type: 'DAppConnectorAPIError';
  code: string;
  reason: string;
};

// ── Global window augmentation ────────────────────────────────────────────────

declare global {
  interface Window {
    /**
     * Midnight DApp Connector registry.
     * Keys are arbitrary strings: UUIDs, legacy names ("mnLace"), etc.
     * Values are InitialAPI objects.
     * Always enumerate via Object.values() or Object.entries().
     */
    midnight?: {
      [key: string]: InitialAPI;
    };
  }
}
