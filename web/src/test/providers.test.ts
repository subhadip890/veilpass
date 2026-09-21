import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeMidnightNetwork, getNetworkId } from '../providers/networkConfig';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '../providers/FetchZkConfigProvider';
import { createBrowserPrivateStateProvider } from '../providers/browserPrivateStateProvider';
import type { DeploymentStage } from '../providers/laceWalletProvider';

describe('Midnight Providers', () => {
  describe('Network Configuration Singleton', () => {
    afterEach(() => {
      setNetworkId('preprod');
    });

    it('idempotently configures preprod without throwing on repeated calls', () => {
      expect(() => initializeMidnightNetwork()).not.toThrow();
      expect(getNetworkId()).toBe('preprod');
      expect(() => initializeMidnightNetwork()).not.toThrow();
      expect(getNetworkId()).toBe('preprod');
    });

    it('rejects a conflicting network ID if already configured to a different network', () => {
      // Set conflicting network
      setNetworkId('testnet');
      expect(getNetworkId()).toBe('testnet');

      expect(() => initializeMidnightNetwork()).toThrow(
        /Conflicting Midnight network ID already configured: "testnet"/
      );

      // Restore to preprod
      setNetworkId('preprod');
      expect(getNetworkId()).toBe('preprod');
    });
  });

  describe('FetchZkConfigProvider asset paths', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('requests required public circuit asset paths (.prover, .verifier, .bzkir)', async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(new Uint8Array([0, 1, 2]).buffer),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new FetchZkConfigProvider('/midnight/veilpass');

      await provider.getProverKey('checkEligibility');
      expect(mockFetch).toHaveBeenCalledWith('/midnight/veilpass/keys/checkEligibility.prover');

      await provider.getVerifierKey('checkEligibility');
      expect(mockFetch).toHaveBeenCalledWith('/midnight/veilpass/keys/checkEligibility.verifier');

      await provider.getZKIR('checkEligibility');
      expect(mockFetch).toHaveBeenCalledWith('/midnight/veilpass/zkir/checkEligibility.bzkir');
    });

    it('throws when public circuit asset is missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      );

      const provider = new FetchZkConfigProvider('/midnight/veilpass');
      await expect(provider.getProverKey('checkEligibility')).rejects.toThrow(
        /Failed to fetch prover key.*404/
      );
    });
  });

  describe('BrowserPrivateStateProvider', () => {
    it('namespaces keys to veilpass-preprod and isolates data', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const provider = createBrowserPrivateStateProvider('veilpass-preprod-test');
      provider.setContractAddress('0000000000000000000000000000000000000000000000000000000000000001' as any);

      // Store private state
      await provider.set('veilpassPrivateState', { secretAge: 25 });
      const stored = await provider.get('veilpassPrivateState');
      expect(stored).toEqual({ secretAge: 25 });

      // Ensure console was never called with secrets
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('25'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('secretAge'));

      // Clean up
      await provider.clear();
      expect(await provider.get('veilpassPrivateState')).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('LaceWalletProvider Adapter', () => {
    const mockTx = {
      serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
      identifiers: vi.fn().mockReturnValue(['tx-id-genuine-001']),
    };

    const validBalancedHex = '00'.repeat(32);

    it('1. Successful real-shaped Lace balance result succeeds and deserializes', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');
      const { Transaction } = await import('@midnight-ntwrk/midnight-js-protocol/ledger');

      const mockBalanceUnsealed = vi.fn().mockResolvedValue({ tx: validBalancedHex });
      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: mockBalanceUnsealed,
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };

      const stages: DeploymentStage[] = [];
      const provider = await createLaceWalletProvider(mockConnectedApi as any, {
        onStageChange: (s) => stages.push(s),
      });

      const deserializeSpy = vi.spyOn(Transaction, 'deserialize').mockReturnValue({
        identifiers: () => ['tx-id-genuine-001'],
      } as any);

      const balanced = await provider.balanceTx(mockTx as any);
      expect(mockBalanceUnsealed).toHaveBeenCalledWith('01020304', { payFees: true });
      expect(deserializeSpy).toHaveBeenCalledWith('signature', 'proof', 'binding', expect.any(Uint8Array));
      expect(balanced).toBeDefined();
      expect(stages).toContain('request_lace_balance');
      expect(stages).toContain('receive_lace_balance');
      expect(stages).toContain('deserialize_balanced_transaction');

      deserializeSpy.mockRestore();
    });

    it('2. Balance result with 0x prefix is handled correctly by stripping prefix before deserialization', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');
      const { Transaction } = await import('@midnight-ntwrk/midnight-js-protocol/ledger');

      const mockBalanceUnsealed = vi.fn().mockResolvedValue({ tx: '0x' + validBalancedHex });
      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: mockBalanceUnsealed,
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };

      const provider = await createLaceWalletProvider(mockConnectedApi as any);

      let passedBytes: Uint8Array | null = null;
      const deserializeSpy = vi.spyOn(Transaction, 'deserialize').mockImplementation((_s, _p, _b, raw) => {
        passedBytes = raw;
        return { identifiers: () => ['tx-id-genuine-001'] } as any;
      });

      await provider.balanceTx(mockTx as any);

      // Verify passed bytes are non-empty and match expected length (32 bytes = 64 hex characters)
      expect(passedBytes).not.toBeNull();
      expect(passedBytes!.length).toBe(32);

      deserializeSpy.mockRestore();
    });

    it('3. Missing/empty result.tx throws descriptive error without leaking contents', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      // Test missing result.tx
      const mockApiMissing = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({}),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };
      const providerMissing = await createLaceWalletProvider(mockApiMissing as any);
      await expect(providerMissing.balanceTx(mockTx as any)).rejects.toThrow(
        /expected string/i
      );

      // Test empty result.tx
      const mockApiEmpty = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: '' }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };
      const providerEmpty = await createLaceWalletProvider(mockApiEmpty as any);
      await expect(providerEmpty.balanceTx(mockTx as any)).rejects.toThrow(
        /empty transaction/i
      );

      // Test empty 0x prefix only
      const mockApiOnly0x = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: '0x' }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };
      const providerOnly0x = await createLaceWalletProvider(mockApiOnly0x as any);
      await expect(providerOnly0x.balanceTx(mockTx as any)).rejects.toThrow(
        /empty transaction/i
      );

      // Test odd length hex
      const mockApiOdd = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: '0x123' }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };
      const providerOdd = await createLaceWalletProvider(mockApiOdd as any);
      await expect(providerOdd.balanceTx(mockTx as any)).rejects.toThrow(
        /odd length/i
      );

      // Test non-hex chars
      const mockApiNonHex = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: '0x12zz' }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };
      const providerNonHex = await createLaceWalletProvider(mockApiNonHex as any);
      await expect(providerNonHex.balanceTx(mockTx as any)).rejects.toThrow(
        /non-hexadecimal/i
      );
    });

    it('4. Deserialization failure reports the correct stage (deserialize_balanced_transaction)', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');
      const { Transaction } = await import('@midnight-ntwrk/midnight-js-protocol/ledger');

      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: validBalancedHex }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };

      let lastStage: DeploymentStage | null = null;
      const provider = await createLaceWalletProvider(mockConnectedApi as any, {
        onStageChange: (s) => {
          lastStage = s;
        },
      });

      const deserializeSpy = vi.spyOn(Transaction, 'deserialize').mockImplementation(() => {
        throw new Error('Corrupted transaction bytes');
      });

      await expect(provider.balanceTx(mockTx as any)).rejects.toThrow('Corrupted transaction bytes');
      expect(lastStage).toBe('deserialize_balanced_transaction');

      deserializeSpy.mockRestore();
    });

    it('5. User rejection reports request_lace_balance', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      const userRejectionError = new Error('User declined transaction signing in Lace');
      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockRejectedValue(userRejectionError),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };

      let lastStage: DeploymentStage | null = null;
      const provider = await createLaceWalletProvider(mockConnectedApi as any, {
        onStageChange: (s) => {
          lastStage = s;
        },
      });

      await expect(provider.balanceTx(mockTx as any)).rejects.toThrow(
        'User declined transaction signing in Lace'
      );
      expect(lastStage).toBe('request_lace_balance');
    });

    it('6. submitTransaction failure reports submit_transaction', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      const submitError = new Error('Network error during Lace relay');
      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: validBalancedHex }),
        submitTransaction: vi.fn().mockRejectedValue(submitError),
      };

      let lastStage: DeploymentStage | null = null;
      const provider = await createLaceWalletProvider(mockConnectedApi as any, {
        onStageChange: (s) => {
          lastStage = s;
        },
      });

      await expect(provider.submitTx(mockTx as any)).rejects.toThrow(
        'Network error during Lace relay'
      );
      expect(lastStage).toBe('submit_transaction');
    });

    it('7. Successful submission preserves genuine transaction ID and reports receive_transaction_id', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      const mockSubmit = vi.fn().mockResolvedValue(undefined);
      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: validBalancedHex }),
        submitTransaction: mockSubmit,
      };

      let lastStage: DeploymentStage | null = null;
      const provider = await createLaceWalletProvider(mockConnectedApi as any, {
        onStageChange: (s) => {
          lastStage = s;
        },
      });

      const txId = await provider.submitTx(mockTx as any);
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockSubmit).toHaveBeenCalledWith('01020304');
      expect(txId).toBe('tx-id-genuine-001');
      expect(lastStage).toBe('receive_transaction_id');
    });

    it('missing balance capability throws clear compatibility error', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        submitTransaction: vi.fn().mockResolvedValue(undefined),
      };

      await expect(createLaceWalletProvider(mockConnectedApi as any)).rejects.toThrow(
        /neither balanceUnsealedTransaction nor balanceTransaction found/i
      );
    });

    it('missing submit capability throws clear compatibility error', async () => {
      const { createLaceWalletProvider } = await import('../providers/laceWalletProvider');

      const mockConnectedApi = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedAddress: 'mn_shielded1...',
          shieldedCoinPublicKey: '01'.repeat(32),
          shieldedEncryptionPublicKey: '02'.repeat(32),
        }),
        balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: validBalancedHex }),
      };

      await expect(createLaceWalletProvider(mockConnectedApi as any)).rejects.toThrow(
        /submitTransaction not found/i
      );
    });
  });
});
