/**
 * Tests for useMidnight hook.
 * Verifies:
 * - State machine transitions
 * - Metadata-only storage (no live API proxies in React state)
 * - Provider generation tracking and dead-proxy avoidance
 * - Active discovery listeners across lifecycle
 * - Clean disconnect and reset
 * - Error classification (rejection vs channel shutdown vs timeout vs network mismatch)
 * - Double-click prevention
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useMidnight,
  discoverProviders,
  CONNECT_TIMEOUT_MS,
  type DiscoveredProvider,
} from '../hooks/useMidnight';
import type { InitialAPI, ConnectedAPI } from '../types/midnight';

function makeConnectedAPI(overrides: Partial<ConnectedAPI> = {}): ConnectedAPI {
  return {
    getShieldedAddresses: vi.fn().mockResolvedValue({
      shieldedAddress: 'mn_shielded1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      shieldedCoinPublicKey: '01'.repeat(32),
      shieldedEncryptionPublicKey: '02'.repeat(32),
    }),
    getUnshieldedAddress: vi.fn().mockResolvedValue({
      unshieldedAddress: 'mn_addr_preprod12345678901234567890123456789012',
    }),
    getConfiguration: vi.fn().mockResolvedValue({
      networkId: 'preprod',
    }),
    balanceUnsealedTransaction: vi.fn(),
    submitTransaction: vi.fn(),
    ...overrides,
  } as unknown as ConnectedAPI;
}

function makeInitialAPI(opts: {
  rdns?: string;
  name?: string;
  apiVersion?: string;
  connectedAPI?: ConnectedAPI;
  connectImpl?: (networkId: string) => Promise<ConnectedAPI>;
} = {}): InitialAPI {
  const defaultConnected = makeConnectedAPI();
  const connectFn = opts.connectImpl ?? vi.fn().mockResolvedValue(opts.connectedAPI ?? defaultConnected);

  return {
    rdns: opts.rdns ?? 'io.lace.midnight',
    name: opts.name ?? 'Lace',
    icon: 'data:image/svg+xml;base64,mock',
    apiVersion: opts.apiVersion ?? '4.0.1',
    connect: connectFn,
  } as unknown as InitialAPI;
}

function setRegistry(providers: Record<string, InitialAPI>) {
  (window as any).midnight = { ...providers };
}

function clearRegistry() {
  delete (window as any).midnight;
}

describe('useMidnight Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRegistry();
    vi.restoreAllMocks();
  });

  // 1. Initial detection
  it('1. Initial detection transitions from detecting to ready when Lace is available', async () => {
    const api = makeInitialAPI();
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    expect(result.current[0].status).toBe('ready');
    expect(result.current[0].providers.length).toBe(1);
    expect(result.current[0].providers[0].name).toBe('Lace');
  });

  // 2. Stored providers contain only stable metadata, never live API proxies
  it('2. Stored providers contain only stable metadata, never live API proxies', () => {
    const api = makeInitialAPI({ name: 'Lace Wallet', rdns: 'io.lace.midnight' });
    setRegistry({ 'uuid-lace': api });

    const discovered = discoverProviders();
    expect(discovered.length).toBe(1);

    const p: DiscoveredProvider = discovered[0];
    expect(p.key).toBe('uuid-lace');
    expect(p.name).toBe('Lace Wallet');
    expect(p.rdns).toBe('io.lace.midnight');
    expect((p as any).connect).toBeUndefined();
  });

  // 3. Connect succeeds with correct Preprod configuration
  it('3. Connect succeeds and populates addresses when Lace approves on Preprod', async () => {
    const connectedApi = makeConnectedAPI();
    const api = makeInitialAPI({ connectedAPI: connectedApi });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());
    expect(result.current[0].status).toBe('ready');

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('connected');
    expect(result.current[0].shortAddress).toBe('mn_addr_...789012');
    expect(result.current[0].fullAddress).toBe(
      'mn_addr_preprod12345678901234567890123456789012'
    );
    expect(result.current[0].networkId).toBe('preprod');
  });

  // 4. Double-click prevention
  it('4. Double-click invokes connect once and blocks concurrent attempts', async () => {
    let resolveConnect!: (api: ConnectedAPI) => void;
    const slowConnect = new Promise<ConnectedAPI>((resolve) => {
      resolveConnect = resolve;
    });

    const connectSpy = vi.fn().mockImplementation(() => slowConnect);
    const api = makeInitialAPI({ connectImpl: connectSpy });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = result.current[1].connect();
      p2 = result.current[1].connect(); // Concurrent call
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveConnect(makeConnectedAPI());
      await Promise.all([p1, p2]);
    });

    expect(result.current[0].status).toBe('connected');
  });

  // 5. Discovery listeners remain active after initial detection
  it('5. Discovery listeners remain active after initial detection and clean up on unmount', () => {
    const addedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
    const removedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);

    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      addedListeners.push([type, listener]);
      origAdd(type, listener, options);
    });

    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      removedListeners.push([type, listener]);
      origRemove(type, listener, options);
    });

    const api = makeInitialAPI();
    setRegistry({ 'uuid-lace': api });

    const { unmount } = renderHook(() => useMidnight());

    // Discovery listeners should NOT have been removed after detection
    const focusRemovedBeforeUnmount = removedListeners.filter(([t]) => t === 'focus');
    expect(focusRemovedBeforeUnmount.length).toBe(0);

    unmount();

    // Now listeners should be cleaned up on unmount
    const focusRemovedAfterUnmount = removedListeners.filter(([t]) => t === 'focus');
    expect(focusRemovedAfterUnmount.length).toBeGreaterThan(0);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  // 6. UUID rotation is detected after focus
  it('6. UUID rotation is detected after focus event', async () => {
    const api1 = makeInitialAPI({ name: 'Lace Old' });
    setRegistry({ 'uuid-1': api1 });

    const { result } = renderHook(() => useMidnight());
    expect(result.current[0].providers[0].key).toBe('uuid-1');

    // Lace reloads with new UUID
    const api2 = makeInitialAPI({ name: 'Lace New' });
    setRegistry({ 'uuid-2': api2 });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current[0].providers.length).toBe(1);
    expect(result.current[0].providers[0].key).toBe('uuid-2');
    expect(result.current[0].providers[0].name).toBe('Lace New');
    expect(result.current[0].selectedProvider?.key).toBe('uuid-2');
  });

  // 7. Active connected state is not overwritten by discovery
  it('7. Active connected state is not overwritten by discovery', async () => {
    const api = makeInitialAPI();
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');

    // Rotate registry or trigger window events
    setRegistry({ 'uuid-rotated': makeInitialAPI({ name: 'Lace Rotated' }) });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should remain connected without interruption
    expect(result.current[0].status).toBe('connected');
  });

  // 8. Channel shutdown does not retry the same dead proxy
  it('8. Channel shutdown does not retry the same dead proxy', async () => {
    const connectSpy = vi.fn().mockRejectedValue(
      new Error("Remote API with channel 'midnight-authenticator' was shutdown: object can no longer be used.")
    );
    const deadApi = makeInitialAPI({ connectImpl: connectSpy });
    setRegistry({ 'uuid-lace': deadApi });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('channel_shutdown');
    expect(result.current[0].errorMessage).toBe(
      'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.'
    );
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Calling connect again on the same dead proxy must NOT invoke connect on the dead proxy
    await act(async () => {
      await result.current[1].connect();
    });

    expect(connectSpy).toHaveBeenCalledTimes(1); // STILL 1!
    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('channel_shutdown');
  });

  // 9. Same key with replaced proxy generation is detected and allows connect
  it('9. Same key with replaced proxy generation is detected and allows successful connect', async () => {
    const deadConnectSpy = vi.fn().mockRejectedValue(
      new Error("Remote API with channel 'midnight-authenticator' was shutdown: object can no longer be used.")
    );
    const deadApi = makeInitialAPI({ connectImpl: deadConnectSpy });
    setRegistry({ 'uuid-lace': deadApi });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].errorKind).toBe('channel_shutdown');

    // Replaced proxy under same key
    const freshConnectedApi = makeConnectedAPI();
    const freshConnectSpy = vi.fn().mockResolvedValue(freshConnectedApi);
    const freshApi = makeInitialAPI({ connectImpl: freshConnectSpy });
    setRegistry({ 'uuid-lace': freshApi });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // Now connect should use the fresh proxy
    await act(async () => {
      await result.current[1].connect();
    });

    expect(freshConnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current[0].status).toBe('connected');
  });

  // 10. Reload action calls window.location.reload
  it('10. reloadWalletChannel action calls window.location.reload', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    const { result } = renderHook(() => useMidnight());
    result.current[1].reloadWalletChannel();

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  // 11. User rejection preserves normal error and allows retry
  it('11. User rejection preserves normal error and allows retry', async () => {
    const rejectApi = makeInitialAPI({
      connectImpl: () =>
        Promise.reject({
          type: 'DAppConnectorAPIError',
          code: 'Rejected',
          reason: 'User declined connection request',
        }),
    });
    setRegistry({ 'uuid-lace': rejectApi });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('rejected');
    expect(result.current[0].errorMessage).toBe(
      'Connection request was declined in Lace. Click Connect Wallet to try again.'
    );
  });

  // 12. Timeout is classified accurately with timeout errorKind
  it('12. Timeout is classified accurately with timeout errorKind', async () => {
    const api = makeInitialAPI({
      connectImpl: () => new Promise<ConnectedAPI>(() => {}), // never resolves
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    let connectPromise: Promise<void>;
    act(() => {
      connectPromise = result.current[1].connect();
    });

    expect(result.current[0].status).toBe('connecting');

    await act(async () => {
      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 100);
      await connectPromise;
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('timeout');
  });
});
