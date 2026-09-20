/**
 * WalletConnect component rendering tests.
 * Tests explicit states: detecting, ready, connecting, connected, disconnecting, error, unavailable.
 * Verifies readiness instructions, inactive-channel guidance, and wallet-missing separation.
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
};

describe('WalletConnect — component rendering & readiness instructions', () => {
  it('shows connect button and readiness instruction when ready with single provider', () => {
    render(<WalletConnect state={makeState({ status: 'ready' })} actions={defaultActions} />);
    expect(screen.getByRole('button', { name: /connect lace/i })).toBeDefined();
    // Readiness instruction
    expect(
      screen.getByText('Open and unlock Lace, select Midnight Preprod, then connect.')
    ).toBeDefined();
    // Does not claim wallet is missing
    expect(screen.queryByText(/no compatible midnight wallet found/i)).toBeNull();
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

  it('shows install link and missing message when unavailable (separate from readiness)', () => {
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
    // Readiness instruction should not be shown when unavailable
    expect(
      screen.queryByText('Open and unlock Lace, select Midnight Preprod, then connect.')
    ).toBeNull();
  });

  it('shows provider selector with multiple providers in ready state', () => {
    const p1 = makeProvider('Lace', 'io.lace.midnight');
    const p2 = makeProvider('OtherWallet', 'com.other.wallet');
    render(
      <WalletConnect
        state={makeState({ status: 'ready', providers: [p1, p2], selectedProvider: p1 })}
        actions={defaultActions}
      />
    );
    expect(screen.getByRole('group', { name: /select wallet provider/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /connect using lace/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /connect using otherwallet/i })).toBeDefined();
    expect(
      screen.getByText('Open and unlock Lace, select Midnight Preprod, then connect.')
    ).toBeDefined();
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

  it('shows "Waiting for approval…" phase label', () => {
    render(
      <WalletConnect
        state={makeState({ status: 'connecting', connectPhase: 'approving' })}
        actions={defaultActions}
      />
    );
    expect(screen.getByText('Waiting for approval…')).toBeDefined();
  });

  it('shows "Verifying Preprod…" phase label', () => {
    render(
      <WalletConnect
        state={makeState({ status: 'connecting', connectPhase: 'verifying' })}
        actions={defaultActions}
      />
    );
    expect(screen.getByText('Verifying Preprod…')).toBeDefined();
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
    expect(screen.getByText('Midnight Preprod')).toBeDefined();

    fireEvent.click(disconnectBtn);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('shows inactive channel guidance with Try Again and Reset buttons on channel shutdown', () => {
    const onReset = vi.fn();
    const onConnect = vi.fn();
    render(
      <WalletConnect
        state={makeState({
          status: 'error',
          errorKind: 'channel_shutdown',
          errorMessage:
            'Lace is installed, but its connection channel is inactive. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.',
        })}
        actions={{ ...defaultActions, reset: onReset, connect: onConnect }}
      />
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(
      screen.getByText(
        'Lace is installed, but its connection channel is inactive. Open and unlock Lace in the browser sidebar, confirm Midnight Preprod, then try again.'
      )
    ).toBeDefined();

    // Verify Try Again and Reset buttons
    const tryAgainBtn = screen.getByRole('button', { name: /connect lace to midnight preprod/i });
    expect(tryAgainBtn).toBeDefined();
    expect(tryAgainBtn.textContent).toBe('Try Again');
    fireEvent.click(tryAgainBtn);
    expect(onConnect).toHaveBeenCalledTimes(1);

    const resetBtn = screen.getByRole('button', { name: /reset wallet state/i });
    expect(resetBtn).toBeDefined();
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows explicit rejection error message without claiming inactive channel or missing wallet', () => {
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
    expect(screen.queryByText(/channel is inactive/i)).toBeNull();
    expect(screen.queryByText(/not installed/i)).toBeNull();
  });
});
