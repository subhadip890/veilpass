import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DeployPanel } from '../components/DeployPanel';
import { CONTRACT_ADDRESS_REGEX, normalizeDeploymentError } from '../components/deployUtils';
import type { MidnightState, MidnightActions } from '../hooks/useMidnight';

// Mock deployContract
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  deployContract: vi.fn(),
}));

// Mock createPreprodProviders
vi.mock('../providers/createPreprodProviders', () => ({
  createPreprodProviders: vi.fn().mockImplementation((_api, options) => {
    return Promise.resolve({
      walletProvider: {
        balanceTx: vi.fn().mockImplementation(async () => {
          options?.onStageChange?.('request_lace_balance');
          options?.onStageChange?.('receive_lace_balance');
          options?.onStageChange?.('deserialize_balanced_transaction');
          return {};
        }),
        getCoinPublicKey: vi.fn().mockReturnValue('mock-coin-key'),
        getEncryptionPublicKey: vi.fn().mockReturnValue('mock-enc-key'),
      },
      midnightProvider: {
        submitTx: vi.fn().mockImplementation(async () => {
          options?.onStageChange?.('submit_transaction');
          options?.onStageChange?.('receive_transaction_id');
          return 'tx-hash-genuine-001';
        }),
      },
      publicDataProvider: {
        watchForTxData: vi.fn().mockImplementation(async () => {
          options?.onStageChange?.('wait_for_indexer');
          return {};
        }),
      },
      zkConfigProvider: {},
      proofProvider: {},
      privateStateProvider: {},
    });
  }),
}));

const mockConnectedApi = {
  getShieldedAddresses: vi.fn().mockResolvedValue({
    shieldedAddress: 'mn_shielded1...',
    shieldedCoinPublicKey: '01'.repeat(32),
    shieldedEncryptionPublicKey: '02'.repeat(32),
  }),
  getUnshieldedAddress: vi.fn().mockResolvedValue({ unshieldedAddress: 'mn_addr_preprod1...' }),
  getConfiguration: vi.fn().mockResolvedValue({ networkId: 'preprod' }),
  balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: 'balanced-tx-hex' }),
  submitTransaction: vi.fn().mockResolvedValue(undefined),
};

const defaultWalletState: MidnightState = {
  status: 'connected',
  connectPhase: null,
  providers: [{ key: 'uuid-1', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' }],
  selectedProvider: { key: 'uuid-1', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' },
  shortAddress: 'mn_addr...123456',
  fullAddress: 'mn_addr_preprod123456',
  networkId: 'preprod',
  errorKind: null,
  errorMessage: null,
};

const defaultWalletActions: MidnightActions = {
  connect: vi.fn(),
  connectProvider: vi.fn(),
  disconnect: vi.fn(),
  reset: vi.fn(),
  reloadWalletChannel: vi.fn(),
  getConnectedApi: vi.fn().mockReturnValue(mockConnectedApi),
};

describe('DeployPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is disabled / not rendered without Lace connection', () => {
    const { container } = render(
      <DeployPanel
        walletState={{ ...defaultWalletState, status: 'ready' }}
        walletActions={defaultWalletActions}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is disabled / not rendered on wrong network (preview)', () => {
    const { container } = render(
      <DeployPanel
        walletState={{ ...defaultWalletState, networkId: 'preview' }}
        walletActions={defaultWalletActions}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders deployment button and Admin / Preprod badge when connected on Preprod', () => {
    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );
    expect(
      screen.getByRole('button', { name: /deploy veilpass to preprod/i })
    ).toBeDefined();
    expect(screen.getByText(/admin \/ preprod/i)).toBeDefined();
  });

  it('displays error when proof server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to connect to proof server'))
    );

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/proof server is unreachable/i)).toBeDefined();
      expect(screen.getByText(/check_proof_server/i)).toBeDefined();
    });
  });

  it('prevents duplicate clicks while deployment is in progress', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    let resolveDeploy!: (v: any) => void;
    (deployContract as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeploy = resolve;
        })
    );

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);
    fireEvent.click(deployBtn); // Second click while in-flight

    await waitFor(() => {
      expect(deployContract).toHaveBeenCalledTimes(1);
    });

    // Resolve deployment inside act and await state transition to complete
    await act(async () => {
      resolveDeploy({
        deployTxData: {
          public: {
            contractAddress: '11'.repeat(32),
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('11'.repeat(32))).toBeDefined();
    });
  });

  it('7. Successful submission preserves genuine transaction ID and displays it', async () => {
    const valid64Hex = '2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c2';
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockImplementation(async (providers: any) => {
      // Trigger submitTx
      const txId = await providers.midnightProvider.submitTx({});
      await providers.publicDataProvider.watchForTxData(txId);
      return {
        deployTxData: {
          public: {
            contractAddress: valid64Hex,
          },
          txId,
        },
      };
    });

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByText(valid64Hex)).toBeDefined();
      expect(screen.getByRole('button', { name: /copy contract address/i })).toBeDefined();
      expect(screen.getByText(/veilpass deployed on preprod/i)).toBeDefined();
      expect(screen.getByText('tx-hash-genuine-001')).toBeDefined();
    });
  });

  it('8. Indexer timeout shows confirmation pending, not deployment failed', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockImplementation(async (providers: any) => {
      await providers.midnightProvider.submitTx({});
      throw new Error('Indexer confirmation timed out. Transaction was submitted to the network, but confirmation is still pending.');
    });

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByText(/transaction submitted; confirmation pending/i)).toBeDefined();
      expect(screen.getByText(/previous transaction may have been submitted/i)).toBeDefined();
      expect(screen.getByText('tx-hash-genuine-001')).toBeDefined();
      expect(screen.getByRole('button', { name: /check transaction status/i })).toBeDefined();
    });
  });

  it('9. Unknown object errors produce a visible safe message with failed stage', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockRejectedValue({
      code: 'InternalError',
      reason: 'Lace wallet extension connection reset',
    });

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/lace wallet extension connection reset/i)).toBeDefined();
      expect(screen.getByText(/failed during:/i)).toBeDefined();
    });
  });

  it('10. Sanitization never creates a blank error', () => {
    // If error only contains secrets or long hexes
    const norm1 = normalizeDeploymentError('password=supersecret12345678', 'check_proof_server');
    expect(norm1.message).toBeDefined();
    expect(norm1.message.length).toBeGreaterThan(0);
    expect(norm1.message).not.toContain('supersecret');

    const norm2 = normalizeDeploymentError('0x' + 'ab'.repeat(32), 'deserialize_balanced_transaction');
    expect(norm2.message).toBeDefined();
    expect(norm2.message.length).toBeGreaterThan(0);
    expect(norm2.message).toContain('Deployment failed during deserialize_balanced_transaction');

    const normEmpty = normalizeDeploymentError('', 'submit_transaction');
    expect(normEmpty.message).toContain('Deployment failed during submit_transaction');
  });

  it('11. A possibly submitted transaction blocks duplicate deployment', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockImplementation(async (providers: any) => {
      await providers.midnightProvider.submitTx({});
      throw new Error('Indexer confirmation timed out.');
    });

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByText(/transaction submitted; confirmation pending/i)).toBeDefined();
    });

    // The deploy button is replaced by check status action
    expect(screen.queryByRole('button', { name: /deploy veilpass to preprod/i })).toBeNull();
    const checkBtn = screen.getByRole('button', { name: /check transaction status/i });
    expect(checkBtn).toBeDefined();
  });

  it('12. No address appears without confirmed network response', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockRejectedValue(new Error('Transaction rejected before indexer confirmation'));

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.queryByText(/veilpass deployed on preprod/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /copy contract address/i })).toBeNull();
    });
  });

  it('address validation rejects malformed address values and shows error', async () => {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    (deployContract as any).mockResolvedValue({
      deployTxData: {
        public: {
          contractAddress: 'malformed-short-address',
        },
      },
    });

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/invalid contract address returned/i)).toBeDefined();
      expect(screen.queryByText(/veilpass deployed on preprod/i)).toBeNull();
    });
  });

  it('halts deployment and displays error if network ID conflicts, never creating fake address', async () => {
    const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
    setNetworkId('testnet'); // Conflicting network

    render(
      <DeployPanel walletState={defaultWalletState} walletActions={defaultWalletActions} />
    );

    const deployBtn = screen.getByRole('button', { name: /deploy veilpass to preprod/i });
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/conflicting midnight network id already configured/i)).toBeDefined();
      expect(screen.queryByText(/veilpass deployed on preprod/i)).toBeNull();
    });

    // Restore to preprod
    setNetworkId('preprod');
  });

  it('CONTRACT_ADDRESS_REGEX accurately validates 64-character hex strings', () => {
    expect(CONTRACT_ADDRESS_REGEX.test('2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c2')).toBe(true);
    expect(CONTRACT_ADDRESS_REGEX.test('00'.repeat(32))).toBe(true);
    expect(CONTRACT_ADDRESS_REGEX.test('2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c')).toBe(false); // 62 chars
    expect(CONTRACT_ADDRESS_REGEX.test('2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c2ff')).toBe(false); // 66 chars
    expect(CONTRACT_ADDRESS_REGEX.test('not-hex-characters-here-0000000000000000000000000000000000000000000000')).toBe(false);
  });
});
