/**
 * WalletConnect component rendering tests.
 * Tests explicit states: detecting, ready, connecting, connected, disconnecting, error, unavailable.
 * Verifies readiness instructions, channel shutdown recovery button, and user rejection retry.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WalletConnect } from '../components/WalletConnect';
import type { MidnightState, MidnightActions, DiscoveredProvider } from '../hooks/useMidnight';

const noop = () => {};
const noopAsync = async () => {};

let _cnt = 0;
function makeProvider(name = 'Lace', rdns = 'io.lace.midnight'): DiscoveredProvider {
  return {
    key: `test-uuid-${rdns.replace(/\./g, '-')}-${_cnt++}`,
    rdns,
    name,
    icon: '',
    apiVersion: '4.0.1',
  };
}

function makeState(overrides: Partial<MidnightState>): MidnightState {
  return {
    status: 'ready',
    connectPhase: null,
    providers: [makeProvider()],
    selectedProvider: makeProvider(),
    shortAddress: null,
    fullAddress: null,
    networkId: null,
    errorKind: null,
    errorMessage: null,
    ...overrides,
  };
}

const defaultActions: MidnightActions = {
  connect: noopAsync,
  connectProvider: noopAsync,
  disconnect: noop,
  reset: noop,
  getConnectedApi: () => null,
  reloadWalletChannel: noop,
};

describe('WalletConnect — component rendering & channel recovery', () => {
  it('shows connect button and readiness instruction when ready with single provider', () => {
    render(<WalletConnect state={makeState({ status: 'ready' })} actions={defaultActions} />);
    expect(screen.getByRole('button', { name: /connect lace/i })).toBeDefined();
    expect(
      screen.getByText('Open and unlock Lace, select Midnight Preprod, then connect.')
    ).toBeDefined();
  });

  it('shows detecting spinner when detecting', () => {
    render(
      <WalletConnect
        state={makeState({ status: 'detecting', providers: [], selectedProvider: null })}
        actions={defaultActions}
      />
    );
    expect(screen.getByRole('button', { name: /detecting wallet/i })).toBeDefined();
  });

  it('shows install link and missing message when unavailable', () => {
    render(
      <WalletConnect
        state={makeState({
          status: 'unavailable',
          providers: [],
          selectedProvider: null,
          errorMessage: 'No compatible Midnight wallet found. Install the Lace extension and refresh.',
        })}
        actions={defaultActions}
      />
    );
    expect(screen.getByRole('link', { name: /install a midnight/i })).toBeDefined();
    expect(screen.getByText(/no compatible midnight wallet found/i)).toBeDefined();
  });

  it('shows "Opening Lace…" phase label and Cancel button when connecting', () => {
    const onReset = vi.fn();
    render(
      <WalletConnect
        state={makeState({ status: 'connecting', connectPhase: 'opening' })}
        actions={{ ...defaultActions, reset: onReset }}
      />
    );
    expect(screen.getByText('Opening Lace…')).toBeDefined();
    const cancelBtn = screen.getByRole('button', { name: /cancel connection attempt/i });
    expect(cancelBtn).toBeDefined();

    fireEvent.click(cancelBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows address and disconnect button when connected', () => {
    const onDisconnect = vi.fn();
    render(
      <WalletConnect
        state={makeState({
          status: 'connected',
          shortAddress: 'mn_addr...abc123',
          fullAddress: 'mn_addr_preprod1full',
          networkId: 'preprod',
        })}
        actions={{ ...defaultActions, disconnect: onDisconnect }}
      />
    );
    expect(screen.getByText('mn_addr...abc123')).toBeDefined();
    const disconnectBtn = screen.getByRole('button', { name: /disconnect wallet/i });
    expect(disconnectBtn).toBeDefined();

    fireEvent.click(disconnectBtn);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('channel shutdown shows Reload Wallet Channel button and does NOT show Try Again', () => {
    const onReload = vi.fn();
    const onConnect = vi.fn();
    render(
      <WalletConnect
        state={makeState({
          status: 'error',
          errorKind: 'channel_shutdown',
          errorMessage:
            'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.',
        })}
        actions={{ ...defaultActions, reloadWalletChannel: onReload, connect: onConnect }}
      />
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(
      screen.getByText(
        'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.'
      )
    ).toBeDefined();

    // Must show Reload Wallet Channel
    const reloadBtn = screen.getByRole('button', { name: /reload wallet channel/i });
    expect(reloadBtn).toBeDefined();
    expect(reloadBtn.id).toBe('btn-reload-wallet-channel');

    // Must NOT show Try Again
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('reload action calls location.reload only after user click', () => {
    const onReload = vi.fn();
    render(
      <WalletConnect
        state={makeState({
          status: 'error',
          errorKind: 'channel_shutdown',
          errorMessage:
            'Lace’s browser channel closed. Open and unlock Lace, then reload this page to create a new secure connection.',
        })}
        actions={{ ...defaultActions, reloadWalletChannel: onReload }}
      />
    );

    // Not called automatically
    expect(onReload).not.toHaveBeenCalled();

    // Called after direct user click
    const reloadBtn = screen.getByRole('button', { name: /reload wallet channel/i });
    fireEvent.click(reloadBtn);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('rejection still shows normal Try Again button, not Reload Wallet Channel', () => {
    render(
      <WalletConnect
        state={makeState({
          status: 'error',
          errorKind: 'rejected',
          errorMessage: 'Connection request was declined in Lace. Click Connect Wallet to try again.',
        })}
        actions={defaultActions}
      />
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Connection request was declined in Lace. Click Connect Wallet to try again.')).toBeDefined();

    // Must show normal Try Again button
    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    expect(tryAgainBtn).toBeDefined();

    // Must NOT show Reload Wallet Channel
    expect(screen.queryByRole('button', { name: /reload wallet channel/i })).toBeNull();
  });
});
