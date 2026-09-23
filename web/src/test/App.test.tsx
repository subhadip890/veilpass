import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

vi.mock('../hooks/useMidnight', () => ({
  useMidnight: vi.fn(() => [
    {
      status: 'connected',
      connectPhase: null,
      providers: [{ key: 'uuid-1', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' }],
      selectedProvider: { key: 'uuid-1', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' },
      shortAddress: 'mn_addr...123456',
      fullAddress: 'mn_addr_preprod123456',
      networkId: 'preprod',
      errorKind: null,
      errorMessage: null,
    },
    {
      connect: vi.fn(),
      connectProvider: vi.fn(),
      disconnect: vi.fn(),
      reset: vi.fn(),
      getConnectedApi: vi.fn(),
      reloadWalletChannel: vi.fn(),
    },
  ]),
}));

vi.mock('../hooks/useVeilPass', () => ({
  useVeilPass: vi.fn(() => [
    {
      status: 'idle',
      result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
      errorMessage: null,
      contractAddress: 'ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2',
    },
    {
      proveEligibility: vi.fn(),
      reset: vi.fn(),
      clearError: vi.fn(),
    },
  ]),
}));

// Mock DeployPanel to simplify assertions
vi.mock('../components/DeployPanel', () => ({
  DeployPanel: () => <div data-testid="deploy-panel-component">Deploy Contract Panel</div>,
}));

describe('App Component — DeployPanel Visibility Control', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
  });

  it('1. Hides DeployPanel by default when contract is configured and VITE_ENABLE_DEPLOY_PANEL is not set', () => {
    (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'] =
      'ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2';
    delete (import.meta.env as Record<string, string | undefined>)['VITE_ENABLE_DEPLOY_PANEL'];

    render(<App />);

    expect(screen.queryByTestId('deploy-panel-component')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Eligibility proof/i })).toBeInTheDocument();
  });

  it('2. Shows DeployPanel when VITE_ENABLE_DEPLOY_PANEL is explicitly "true"', () => {
    (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'] =
      'ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2';
    (import.meta.env as Record<string, string | undefined>)['VITE_ENABLE_DEPLOY_PANEL'] = 'true';

    render(<App />);

    expect(screen.getByTestId('deploy-panel-component')).toBeInTheDocument();
  });

  it('3. Shows DeployPanel when VITE_CONTRACT_ADDRESS is not configured (allowing admin deployment)', () => {
    delete (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'];
    delete (import.meta.env as Record<string, string | undefined>)['VITE_ENABLE_DEPLOY_PANEL'];

    render(<App />);

    expect(screen.getByTestId('deploy-panel-component')).toBeInTheDocument();
  });

  it('4. Renders the exact current limitation disclaimer in the footer', () => {
    render(<App />);

    expect(
      screen.getByText('Current limitation: age is self-attested. No identity is verified.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Level 1 limitation/i)).not.toBeInTheDocument();
  });
});
