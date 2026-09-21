/**
 * useMidnight hook — Midnight DApp Connector state machine for VeilPass.
 *
 * Requirements & Architecture:
 * 1. Explicit state machine:
 *    detecting -> ready -> connecting -> connected -> disconnecting -> error -> unavailable
 * 2. Stable metadata only:
 *    DiscoveredProvider stores key, rdns, name, icon, apiVersion.
 *    Never stores the live InitialAPI Remote API proxy in React state.
 * 3. Provider generation tracking:
 *    Maintains proxy reference, generation counter, and dead-proxy status in a ref.
 * 4. Active discovery lifecycle:
 *    Keeps focus, pageshow, and visibilitychange event listeners active throughout
 *    the component lifecycle; only cleans up listeners on unmount. Rapid polling stops
 *    once a provider is detected.
 * 5. Discovery effects (load, focus, pageshow, visibilitychange) never overwrite
 *    connecting, connected, or disconnecting states.
 * 6. Disconnect:
 *    Local DApp session teardown, cancels in-flight operations, and returns to ready.
 * 7. Error classification:
 *    Strictly differentiates explicit user rejection from channel shutdown, timeout,
 *    wallet locked, network mismatch, provider disappeared, and unknown errors.
 * 8. Channel shutdown recovery:
 *    Invalidates current provider generation in ref, cancels attempt counter,
 *    and provides reloadWalletChannel action.
 * 9. Privacy & Security:
 *    Never logs recovery phrases, seeds, passwords, private keys, or full addresses.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { InitialAPI, ConnectedAPI } from '../types/midnight';

export const REQUIRED_NETWORK = 'preprod';
export const CONNECT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;
const POLL_MAX_ATTEMPTS = 30; // 3 seconds max polling

// ── Types ───────────────────────────────────────────────────────────────────

export type MidnightStatus =
  | 'detecting'
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'
  | 'unavailable';

export type ConnectPhase = 'opening' | 'approving' | 'verifying' | null;

export type ErrorKind =
  | 'rejected'
  | 'channel_shutdown'
  | 'timeout'
  | 'wallet_locked'
  | 'network_mismatch'
  | 'provider_disappeared'
  | 'incompatible'
  | 'unknown';

/** Stable metadata only — NO live Remote API proxy is stored here! */
export interface DiscoveredProvider {
  key: string;            // Key in window.midnight (UUID, "mnLace", etc.)
  rdns: string;           // e.g. "io.lace.midnight"
  name: string;           // e.g. "Lace"
  icon?: string;          // icon URL or data URI
  apiVersion: string;     // e.g. "4.0.1"
}

export interface MidnightState {
  status: MidnightStatus;
  connectPhase: ConnectPhase;
  providers: DiscoveredProvider[];
  selectedProvider: DiscoveredProvider | null;
  shortAddress: string | null;
  fullAddress: string | null;
  networkId: string | null;
  errorKind: ErrorKind | null;
  errorMessage: string | null;
}

export interface MidnightActions {
  connect: () => Promise<void>;
  connectProvider: (provider: DiscoveredProvider) => Promise<void>;
  disconnect: () => void;
  reset: () => void;
  getConnectedApi: () => ConnectedAPI | null;
  reloadWalletChannel: () => void;
}

export interface ProviderGenerationRecord {
  key: string;
  proxyRef: unknown;
  generation: number;
  discoveredAt: number;
  isDead: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function shortenAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

/**
 * Enumerate window.midnight for valid InitialAPI providers and return
 * stable metadata ONLY. Never returns or stores live API proxies in state.
 */
export function discoverProviders(): DiscoveredProvider[] {
  if (typeof window === 'undefined' || !window.midnight || typeof window.midnight !== 'object') {
    return [];
  }

  const entries = Object.entries(window.midnight);
  const found: DiscoveredProvider[] = [];

  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<InitialAPI>;
    if (typeof candidate.connect !== 'function') continue;

    found.push({
      key,
      rdns: typeof candidate.rdns === 'string' ? candidate.rdns : '',
      name: typeof candidate.name === 'string' && candidate.name.trim() !== ''
        ? candidate.name
        : key,
      icon: typeof candidate.icon === 'string' ? candidate.icon : undefined,
      apiVersion: typeof candidate.apiVersion === 'string' ? candidate.apiVersion : '',
    });
  }

  // Prefer Lace first
  found.sort((a, b) => {
    const aLace = /lace/i.test(a.rdns) || /lace/i.test(a.name) ? -1 : 0;
    const bLace = /lace/i.test(b.rdns) || /lace/i.test(b.name) ? -1 : 0;
    return aLace - bLace;
  });

  return found;
}

/**
 * Track and update provider generations in the ref.
 * Detects UUID changes and InitialAPI object replacement.
 */
export function updateProviderGenerations(
  generationsMap: Map<string, ProviderGenerationRecord>
): void {
  if (typeof window === 'undefined' || !window.midnight || typeof window.midnight !== 'object') {
    return;
  }

  const currentKeys = new Set(Object.keys(window.midnight));

  // Clean up keys that no longer exist
  for (const key of generationsMap.keys()) {
    if (!currentKeys.has(key)) {
      generationsMap.delete(key);
    }
  }

  // Update or insert records for current keys
  for (const [key, raw] of Object.entries(window.midnight)) {
    if (!raw || typeof raw !== 'object' || typeof (raw as any).connect !== 'function') {
      continue;
    }

    const existing = generationsMap.get(key);
    if (!existing) {
      generationsMap.set(key, {
        key,
        proxyRef: raw,
        generation: 1,
        discoveredAt: Date.now(),
        isDead: false,
      });
    } else if (existing.proxyRef !== raw) {
      // Detected replacement of InitialAPI proxy object under the same key
      existing.proxyRef = raw;
      existing.generation += 1;
      existing.discoveredAt = Date.now();
      existing.isDead = false; // Fresh proxy replaces dead proxy
    }
  }
}

/**
 * Resolve InitialAPI proxy directly from window.midnight.
 * Checks whether the proxy is currently marked as dead from a previous channel shutdown.
 */
export function resolveInitialAPI(
  key: string | undefined,
  generationsMap: Map<string, ProviderGenerationRecord>
): { api: InitialAPI; key: string; isDead: boolean } | null {
  if (typeof window === 'undefined' || !window.midnight || typeof window.midnight !== 'object') {
    return null;
  }

  updateProviderGenerations(generationsMap);

  // 1. If key specified and present
  if (key && window.midnight[key]) {
    const raw = window.midnight[key];
    if (raw && typeof raw.connect === 'function') {
      const gen = generationsMap.get(key);
      return { api: raw, key, isDead: gen?.isDead ?? false };
    }
  }

  // 2. Otherwise search for Lace provider
  for (const [k, raw] of Object.entries(window.midnight)) {
    if (!raw || typeof raw.connect !== 'function') continue;
    if (/lace/i.test(raw.rdns || '') || /lace/i.test(raw.name || '')) {
      const gen = generationsMap.get(k);
      return { api: raw, key: k, isDead: gen?.isDead ?? false };
    }
  }

  // 3. Fallback to first available provider
  for (const [k, raw] of Object.entries(window.midnight)) {
    if (raw && typeof raw.connect === 'function') {
      const gen = generationsMap.get(k);
      return { api: raw, key: k, isDead: gen?.isDead ?? false };
    }
  }

  return null;
}

/**
 * Classify connection errors accurately.
 * Never labels an error as user rejection unless positively proven.
 */
export function classifyError(err: unknown): { errorKind: ErrorKind; errorMessage: string } {
  const errObj = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const msg = err instanceof Error ? err.message : String(err ?? '');

  // 1. Official DAppConnectorAPIError
  if (errObj['type'] === 'DAppConnectorAPIError') {
    const code = String(errObj['code'] || '');
    if (code === 'Rejected' || code === 'PermissionRejected') {
      return {
        errorKind: 'rejected',
        errorMessage: 'Connection request was declined in Lace. Click Connect Wallet to try again.',
      };
    }
    if (code === 'Disconnected') {
      return {
        errorKind: 'channel_shutdown',
        errorMessage:
          'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.',
      };
    }
    if (code === 'InvalidRequest') {
      return {
        errorKind: 'incompatible',
        errorMessage: 'Invalid request to Lace wallet. Please ensure your Lace extension is up to date.',
      };
    }
    if (code === 'InternalError') {
      return {
        errorKind: 'unknown',
        errorMessage: `Lace internal error: ${errObj['reason'] || msg}. Please ensure Lace is unlocked and try again.`,
      };
    }
  }

  // 2. Explicit user rejection check (strict regex — do not match generic occurrences)
  if (
    /^(user\s+)?(rejected|declined)(\s+request)?$/i.test(msg.trim()) ||
    /^request\s+(declined|rejected)$/i.test(msg.trim())
  ) {
    return {
      errorKind: 'rejected',
      errorMessage: 'Connection request was declined in Lace. Click Connect Wallet to try again.',
    };
  }

  // 3. Stale / Shutdown Remote API channel & Closed Message Port
  if (
    /Remote API with channel .* was shutdown/i.test(msg) ||
    /channel .* was shutdown/i.test(msg) ||
    /object can no longer be used/i.test(msg) ||
    /message port closed/i.test(msg) ||
    /disconnected port/i.test(msg) ||
    /disconnected authenticator channel/i.test(msg) ||
    /Lace[’']s browser channel closed/i.test(msg)
  ) {
    return {
      errorKind: 'channel_shutdown',
      errorMessage:
        'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.',
    };
  }

  // 4. Timeout (with provider detected)
  if (/timed?\s*out|timeout/i.test(msg)) {
    return {
      errorKind: 'timeout',
      errorMessage:
        'Connection timed out. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.',
    };
  }

  // 5. Wallet locked
  if (/wallet.*locked|locked.*wallet|please unlock/i.test(msg)) {
    return {
      errorKind: 'wallet_locked',
      errorMessage: 'Lace wallet is locked. Please unlock the Lace extension and try again.',
    };
  }

  // 6. Generic / Unknown fallback (NOT classified as rejection)
  return {
    errorKind: 'unknown',
    errorMessage: `Connection failed: ${msg || 'Unknown error'}. Click Reset or try again.`,
  };
}

// ── Initial State ───────────────────────────────────────────────────────────

const INITIAL_STATE: MidnightState = {
  status: 'detecting',
  connectPhase: null,
  providers: [],
  selectedProvider: null,
  shortAddress: null,
  fullAddress: null,
  networkId: null,
  errorKind: null,
  errorMessage: null,
};

// ── Hook Implementation ─────────────────────────────────────────────────────

export function useMidnight(): [MidnightState, MidnightActions] {
  const [state, setState] = useState<MidnightState>(INITIAL_STATE);

  // References to manage asynchronous flows safely without closure staleness
  const connectedApiRef = useRef<ConnectedAPI | null>(null);
  const isConnectingRef = useRef(false);
  const attemptCounterRef = useRef(0);
  const selectedProviderRef = useRef<DiscoveredProvider | null>(null);
  const providerGenerationsRef = useRef<Map<string, ProviderGenerationRecord>>(new Map());

  // ── applyDiscovery ─────────────────────────────────────────────────────────

  const applyDiscovery = useCallback((providers: DiscoveredProvider[]) => {
    setState((prev) => {
      // Never overwrite or interrupt an active connection or in-flight transitions
      if (
        prev.status === 'connecting' ||
        prev.status === 'connected' ||
        prev.status === 'disconnecting'
      ) {
        return prev;
      }

      if (providers.length === 0) {
        return {
          ...prev,
          status: 'unavailable',
          providers: [],
          selectedProvider: null,
          errorMessage:
            prev.status === 'error'
              ? prev.errorMessage
              : 'No compatible Midnight wallet found. Install the Lace extension and refresh.',
        };
      }

      updateProviderGenerations(providerGenerationsRef.current);

      const currentSelectedKey = selectedProviderRef.current?.key;
      const stillPresent = currentSelectedKey
        ? providers.find((p) => p.key === currentSelectedKey)
        : null;
      const nextSelected = stillPresent ?? providers[0];
      selectedProviderRef.current = nextSelected;

      return {
        ...prev,
        status: prev.status === 'detecting' || prev.status === 'unavailable' ? 'ready' : prev.status,
        providers,
        selectedProvider: nextSelected,
      };
    });
  }, []);

  // ── Provider discovery effect ──────────────────────────────────────────────

  useEffect(() => {
    let unmounted = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;

    function poll() {
      if (unmounted) return;
      const providers = discoverProviders();
      if (providers.length > 0) {
        applyDiscovery(providers);
        // Stop rapid polling once a provider is detected
        return;
      }
      pollCount++;
      if (pollCount < POLL_MAX_ATTEMPTS) {
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      } else {
        applyDiscovery([]);
      }
    }

    function handleEvent() {
      if (unmounted) return;
      const providers = discoverProviders();
      applyDiscovery(providers);
    }

    // Keep discovery listeners active throughout component lifecycle
    window.addEventListener('load', handleEvent);
    window.addEventListener('focus', handleEvent);
    window.addEventListener('pageshow', handleEvent);
    document.addEventListener('visibilitychange', handleEvent);

    const initial = discoverProviders();
    if (initial.length > 0) {
      applyDiscovery(initial);
    } else {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    return () => {
      unmounted = true;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      window.removeEventListener('load', handleEvent);
      window.removeEventListener('focus', handleEvent);
      window.removeEventListener('pageshow', handleEvent);
      document.removeEventListener('visibilitychange', handleEvent);
    };
  }, [applyDiscovery]);

  // ── connectProvider ────────────────────────────────────────────────────────

  const connectProvider = useCallback(async (provider: DiscoveredProvider) => {
    // Only one connection attempt may exist at a time
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    // Increment attempt counter to invalidate any previous or superseded attempt
    const thisAttempt = ++attemptCounterRef.current;
    selectedProviderRef.current = provider;

    setState((prev) => ({
      ...prev,
      status: 'connecting',
      connectPhase: 'opening',
      selectedProvider: provider,
      errorKind: null,
      errorMessage: null,
    }));

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000} seconds.`));
      }, CONNECT_TIMEOUT_MS);
    });

    try {
      const resolved = resolveInitialAPI(provider.key, providerGenerationsRef.current);
      if (!resolved) {
        if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
        if (attemptCounterRef.current !== thisAttempt) return;

        setState((prev) => ({
          ...prev,
          status: 'error',
          connectPhase: null,
          errorKind: 'provider_disappeared',
          errorMessage: 'Lace wallet provider is no longer available in the browser. Please ensure Lace is enabled and refresh the page.',
        }));
        return;
      }

      const { api: initialApi, key: freshKey, isDead } = resolved;

      // Update provider key if UUID rotated
      if (freshKey !== provider.key) {
        selectedProviderRef.current = { ...provider, key: freshKey };
      }

      // Do not call connect() on a dead proxy whose channel has closed
      if (isDead) {
        if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
        if (attemptCounterRef.current !== thisAttempt) return;

        throw new Error('Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.');
      }

      // Phase: opening -> approving (connect() invokes Lace approval prompt)
      setState((prev) => ({ ...prev, connectPhase: 'approving' }));
      const connectPromise = initialApi.connect(REQUIRED_NETWORK);

      const connectedApi = await Promise.race([connectPromise, timeoutPromise]);
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }

      // Check if attempt was superseded or cancelled
      if (attemptCounterRef.current !== thisAttempt) return;

      connectedApiRef.current = connectedApi;

      // Phase: verifying (parallel getConfiguration + getUnshieldedAddress)
      setState((prev) => ({ ...prev, connectPhase: 'verifying' }));

      const [config, addressResult] = await Promise.all([
        connectedApi.getConfiguration(),
        connectedApi.getUnshieldedAddress(),
      ]);

      if (attemptCounterRef.current !== thisAttempt) return;

      // Validate network strictly against Preprod
      if (config.networkId !== REQUIRED_NETWORK) {
        connectedApiRef.current = null;
        setState((prev) => ({
          ...prev,
          status: 'error',
          connectPhase: null,
          errorKind: 'network_mismatch',
          errorMessage: `Wallet is connected to '${config.networkId}'. Switch Lace to Midnight Preprod and try again.`,
        }));
        return;
      }

      const { unshieldedAddress } = addressResult;

      setState((prev) => ({
        ...prev,
        status: 'connected',
        connectPhase: null,
        shortAddress: shortenAddress(unshieldedAddress),
        fullAddress: unshieldedAddress,
        networkId: config.networkId,
        errorKind: null,
        errorMessage: null,
      }));
    } catch (err: unknown) {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
      if (attemptCounterRef.current !== thisAttempt) return;

      connectedApiRef.current = null;
      const { errorKind, errorMessage } = classifyError(err);

      // Cancel/invalidate attempt counter when timeout or channel shutdown occurs
      if (errorKind === 'channel_shutdown' || errorKind === 'timeout') {
        attemptCounterRef.current++;
        const gen = providerGenerationsRef.current.get(provider.key);
        if (gen) {
          gen.isDead = true;
        }
      }

      setState((prev) => ({
        ...prev,
        status: 'error',
        connectPhase: null,
        errorKind,
        errorMessage,
      }));
    } finally {
      if (attemptCounterRef.current === thisAttempt || attemptCounterRef.current === thisAttempt + 1) {
        isConnectingRef.current = false;
      }
    }
  }, []);

  // ── connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;

    const providers = discoverProviders();
    if (providers.length === 0) {
      setState((prev) => ({
        ...prev,
        status: 'unavailable',
        connectPhase: null,
        errorKind: null,
        errorMessage: 'No compatible Midnight wallet found. Install the Lace extension and refresh.',
      }));
      return;
    }

    const refKey = selectedProviderRef.current?.key;
    const provider =
      (refKey ? providers.find((p) => p.key === refKey) : null) ??
      providers.find((p) => /lace/i.test(p.rdns) || /lace/i.test(p.name)) ??
      providers[0];

    await connectProvider(provider);
  }, [connectProvider]);

  // ── disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    attemptCounterRef.current++;
    isConnectingRef.current = false;
    connectedApiRef.current = null;

    const providers = discoverProviders();
    const selected =
      (selectedProviderRef.current &&
        providers.find((p) => p.key === selectedProviderRef.current?.key)) ??
      (providers.length > 0 ? providers[0] : null);

    setState((prev) => ({
      ...prev,
      status: providers.length > 0 ? 'ready' : 'unavailable',
      connectPhase: null,
      providers,
      selectedProvider: selected,
      shortAddress: null,
      fullAddress: null,
      networkId: null,
      errorKind: null,
      errorMessage: null,
    }));
  }, []);

  // ── reset / cancel ─────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    attemptCounterRef.current++;
    isConnectingRef.current = false;
    connectedApiRef.current = null;

    const providers = discoverProviders();
    const selected =
      (selectedProviderRef.current &&
        providers.find((p) => p.key === selectedProviderRef.current?.key)) ??
      (providers.length > 0 ? providers[0] : null);

    setState((prev) => ({
      ...prev,
      status: providers.length > 0 ? 'ready' : 'unavailable',
      connectPhase: null,
      providers,
      selectedProvider: selected,
      shortAddress: null,
      fullAddress: null,
      networkId: null,
      errorKind: null,
      errorMessage: null,
    }));
  }, []);

  // ── reloadWalletChannel ────────────────────────────────────────────────────

  const reloadWalletChannel = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  }, []);

  const getConnectedApi = useCallback(() => connectedApiRef.current, []);

  return [
    state,
    {
      connect,
      connectProvider,
      disconnect,
      reset,
      getConnectedApi,
      reloadWalletChannel,
    },
  ];
}
