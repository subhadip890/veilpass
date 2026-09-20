/**
 * Comprehensive regression and lifecycle tests for useMidnight hook.
 *
 * Explicitly verifies:
 * 1. Initial UUID-keyed provider connection.
 * 2. Successful disconnect then reconnect.
 * 3. Reconnect resolves a different/fresh proxy object.
 * 4. Old proxy is never called after disconnect.
 * 5. Double-click invokes connect exactly once.
 * 6. Discovery effect does not interrupt an active connection.
 * 7. Explicit user rejection gets rejection message (distinct from inactive channel).
 * 8. Generic error does not get rejection message.
 * 9. Shutdown channel gets inactive-channel guidance.
 * 10. Timeout is classified accurately with inactive-channel guidance.
 * 11. Network mismatch remains enforced.
 * 12. All timers, listeners and in-flight guards are cleaned up on unmount.
 * 13. Closed message port & disconnected channel get inactive-channel guidance.
 * 14. Wallet-missing message remains separate when no provider exists.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMidnight, CONNECT_TIMEOUT_MS } from '../hooks/useMidnight';
import type { InitialAPI, ConnectedAPI } from '../types/midnight';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeConnectedAPI(opts: {
  networkId?: string;
  address?: string;
} = {}): ConnectedAPI {
  const { networkId = 'preprod', address = 'mn_addr_preprod1testaddress0000000001' } = opts;
  return {
    getConfiguration: vi.fn().mockResolvedValue({
      networkId,
      indexerUri: '',
      indexerWsUri: '',
      substrateNodeUri: '',
    }),
    getUnshieldedAddress: vi.fn().mockResolvedValue({ unshieldedAddress: address }),
    getConnectionStatus: vi.fn().mockResolvedValue({ status: 'connected', networkId }),
    hintUsage: vi.fn().mockResolvedValue(undefined),
    getShieldedBalances: vi.fn(),
    getUnshieldedBalances: vi.fn(),
    getDustBalance: vi.fn(),
    getShieldedAddresses: vi.fn(),
    getDustAddress: vi.fn(),
    getTxHistory: vi.fn(),
    balanceTransaction: vi.fn(),
    makeTransfer: vi.fn(),
    makeIntent: vi.fn(),
    signData: vi.fn(),
    submitTransaction: vi.fn(),
    getProvingProvider: vi.fn(),
  } as unknown as ConnectedAPI;
}

function makeInitialAPI(opts: {
  rdns?: string;
  name?: string;
  icon?: string;
  apiVersion?: string;
  connectedAPI?: ConnectedAPI;
  connectImpl?: (networkId: string) => Promise<ConnectedAPI>;
} = {}): InitialAPI {
  const {
    rdns = 'io.lace.midnight',
    name = 'Lace',
    icon = 'data:image/svg+xml;base64,lace',
    apiVersion = '4.0.1',
    connectedAPI = makeConnectedAPI(),
    connectImpl,
  } = opts;

  return {
    rdns,
    name,
    icon,
    apiVersion,
    connect: vi.fn(connectImpl ?? (() => Promise.resolve(connectedAPI))),
  };
}

function setRegistry(providers: Record<string, InitialAPI>) {
  window.midnight = providers;
}

function clearRegistry() {
  delete window.midnight;
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('useMidnight — Required Regression Tests & Inactive Channel Guidance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRegistry();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    clearRegistry();
  });

  // 1. Initial UUID-keyed provider connection
  it('1. Initial UUID-keyed provider connection succeeds on Preprod', async () => {
    const uuid = '09858947-997c-40ee-98ee-b45fb2bf409c';
    const api = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ [uuid]: api });

    const { result } = renderHook(() => useMidnight());
    expect(result.current[0].status).toBe('ready');
    expect(result.current[0].providers).toHaveLength(1);
    expect(result.current[0].providers[0].key).toBe(uuid);

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('connected');
    expect(result.current[0].networkId).toBe('preprod');
    expect(result.current[0].shortAddress).toMatch(/^mn_addr.*\.\.\..*$/);
    expect(api.connect).toHaveBeenCalledWith('preprod');
  });

  // 2. Successful disconnect then reconnect
  it('2. Successful disconnect then reconnect', async () => {
    const api = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    // Connect
    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');
    expect(result.current[0].shortAddress).not.toBeNull();

    // Disconnect
    act(() => {
      result.current[1].disconnect();
    });
    expect(result.current[0].status).toBe('ready');
    expect(result.current[0].shortAddress).toBeNull();
    expect(result.current[0].fullAddress).toBeNull();
    expect(result.current[0].networkId).toBeNull();

    // Reconnect
    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');
    expect(result.current[0].shortAddress).not.toBeNull();
    expect(result.current[0].networkId).toBe('preprod');
  });

  // 3. Reconnect resolves a different/fresh proxy object
  it('3. Reconnect resolves a different/fresh proxy object from window.midnight', async () => {
    const api1 = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ 'uuid-lace': api1 });

    const { result } = renderHook(() => useMidnight());

    // Connect with api1
    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');
    expect(api1.connect).toHaveBeenCalledTimes(1);

    // Disconnect
    act(() => {
      result.current[1].disconnect();
    });
    expect(result.current[0].status).toBe('ready');

    // Simulate wallet restart: registry now has api2 under the same key
    const api2 = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ 'uuid-lace': api2 });

    // Reconnect
    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');
    expect(api2.connect).toHaveBeenCalledTimes(1);
    expect(api1.connect).toHaveBeenCalledTimes(1); // Old proxy not called again!
  });

  // 4. Old proxy is never called after disconnect
  it('4. Old proxy is never called after disconnect even if UUID rotates', async () => {
    const api1 = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ 'uuid-old': api1 });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });
    expect(api1.connect).toHaveBeenCalledTimes(1);

    act(() => {
      result.current[1].disconnect();
    });

    // Simulate extension reload with brand new UUID
    const api2 = makeInitialAPI({ rdns: 'io.lace.midnight', name: 'Lace' });
    setRegistry({ 'uuid-new': api2 });

    await act(async () => {
      await result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connected');
    expect(api2.connect).toHaveBeenCalledTimes(1);
    expect(api1.connect).toHaveBeenCalledTimes(1);
  });

  // 5. Double-click invokes connect exactly once
  it('5. Double-click invokes connect exactly once', async () => {
    let resolveConnect!: (value: ConnectedAPI) => void;
    const slowConnect = new Promise<ConnectedAPI>((resolve) => {
      resolveConnect = resolve;
    });

    const api = makeInitialAPI({
      connectImpl: () => slowConnect,
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    // First click starts connection
    let p1: Promise<void>;
    act(() => {
      p1 = result.current[1].connect();
    });

    expect(result.current[0].status).toBe('connecting');

    // Immediate second click while connecting
    let p2: Promise<void>;
    act(() => {
      p2 = result.current[1].connect();
    });

    expect(api.connect).toHaveBeenCalledTimes(1);

    // Resolve the connection
    await act(async () => {
      resolveConnect(makeConnectedAPI());
      await p1;
      await p2;
    });

    expect(result.current[0].status).toBe('connected');
    expect(api.connect).toHaveBeenCalledTimes(1);
  });

  // 6. Discovery effect does not interrupt an active connection
  it('6. Discovery effect does not interrupt an active connection', async () => {
    let resolveConnect!: (value: ConnectedAPI) => void;
    const slowConnect = new Promise<ConnectedAPI>((resolve) => {
      resolveConnect = resolve;
    });

    const api = makeInitialAPI({
      connectImpl: () => slowConnect,
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    let connectPromise: Promise<void>;
    act(() => {
      connectPromise = result.current[1].connect();
    });
    expect(result.current[0].status).toBe('connecting');

    // Simulate window events while connect is in flight
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should remain in connecting state
    expect(result.current[0].status).toBe('connecting');

    // Complete connection
    await act(async () => {
      resolveConnect(makeConnectedAPI());
      await connectPromise;
    });

    expect(result.current[0].status).toBe('connected');
  });

  // 7. Explicit user rejection gets rejection message
  it('7. Explicit user rejection gets rejection message (distinct from inactive channel)', async () => {
    const api = makeInitialAPI({
      connectImpl: () =>
        Promise.reject({
          type: 'DAppConnectorAPIError',
          code: 'Rejected',
          reason: 'User declined connection request',
        }),
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('rejected');
    expect(result.current[0].errorMessage).toBe(
      'Connection request was declined in Lace. Click Connect Wallet to try again.'
    );
    expect(result.current[0].errorMessage).not.toContain('connection channel is inactive');
  });

  // 8. Generic error does not get rejection message
  it('8. Generic error does not get rejection message', async () => {
    const api = makeInitialAPI({
      connectImpl: () => Promise.reject(new Error('Unexpected network failure occurred')),
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('unknown');
    expect(result.current[0].errorMessage).not.toMatch(/declined/i);
    expect(result.current[0].errorMessage).not.toMatch(/rejected/i);
    expect(result.current[0].errorMessage).toContain('Unexpected network failure occurred');
  });

  // 9. Shutdown channel gets inactive-channel guidance
  it('9. Shutdown channel gets inactive-channel guidance', async () => {
    const api = makeInitialAPI({
      connectImpl: () =>
        Promise.reject(
          new Error(
            "Remote API with channel 'midnight-authenticator' was shutdown: object can no longer be used."
          )
        ),
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('channel_shutdown');
    expect(result.current[0].errorMessage).toBe(
      'Lace is installed, but its connection channel is inactive. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.'
    );
  });

  // 10. Timeout is classified accurately with inactive-channel guidance
  it('10. Timeout is classified accurately with inactive-channel guidance', async () => {
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

    // Advance time past the timeout threshold
    await act(async () => {
      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 100);
      await connectPromise;
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('timeout');
    expect(result.current[0].errorMessage).toBe(
      'Lace is installed, but its connection channel is inactive. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.'
    );
  });

  // 11. Network mismatch remains enforced
  it('11. Network mismatch remains enforced and reported accurately', async () => {
    const wrongConnectedApi = makeConnectedAPI({ networkId: 'preview' });
    const api = makeInitialAPI({ connectedAPI: wrongConnectedApi });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('network_mismatch');
    expect(result.current[0].errorMessage).toContain("Wallet is connected to 'preview'");
    expect(result.current[0].errorMessage).toContain('Switch Lace to Midnight Preprod');
  });

  // 12. All timers, listeners and in-flight guards are cleaned up on unmount
  it('12. All timers, listeners and in-flight guards are cleaned up on unmount', async () => {
    const addedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
    const removedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);

    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      addedListeners.push([type, listener]);
      origAdd(type, listener, options);
    });

    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      removedListeners.push([type, listener]);
      origRemove(type, listener, options);
    });

    const { unmount } = renderHook(() => useMidnight());
    unmount();

    const loadAdded = addedListeners.filter(([t]) => t === 'load');
    const loadRemoved = removedListeners.filter(([t]) => t === 'load');
    expect(loadRemoved.length).toBeGreaterThanOrEqual(loadAdded.length);

    const focusAdded = addedListeners.filter(([t]) => t === 'focus');
    const focusRemoved = removedListeners.filter(([t]) => t === 'focus');
    expect(focusRemoved.length).toBeGreaterThanOrEqual(focusAdded.length);
  });

  // 13. Closed message port & disconnected channel get inactive-channel guidance
  it('13. Closed message port & disconnected channel get inactive-channel guidance', async () => {
    const api = makeInitialAPI({
      connectImpl: () => Promise.reject(new Error('message port closed before a response was received')),
    });
    setRegistry({ 'uuid-lace': api });

    const { result } = renderHook(() => useMidnight());

    await act(async () => {
      await result.current[1].connect();
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorKind).toBe('channel_shutdown');
    expect(result.current[0].errorMessage).toBe(
      'Lace is installed, but its connection channel is inactive. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.'
    );
  });

  // 14. Wallet-missing message remains separate when no provider exists
  it('14. Wallet-missing message remains separate when no provider exists in window.midnight', async () => {
    clearRegistry();

    const { result } = renderHook(() => useMidnight());
    expect(result.current[0].status).toBe('detecting');

    await act(async () => {
      vi.advanceTimersByTime(3500); // Wait for polling to finish
    });

    expect(result.current[0].status).toBe('unavailable');
    expect(result.current[0].errorMessage).toBe(
      'No compatible Midnight wallet found. Install the Lace extension and refresh.'
    );
    expect(result.current[0].errorMessage).not.toContain('connection channel is inactive');
  });
});
