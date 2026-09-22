import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVeilPass, normalizeEligibilityError } from '../hooks/useVeilPass';
import {
  findDeployedContract,
  ContractTypeError,
  CallTxFailedError,
} from '@midnight-ntwrk/midnight-js-contracts';
import { createPreprodProviders } from '../providers/createPreprodProviders';
import type { MidnightActions } from '../hooks/useMidnight';

const VALID_CONTRACT_ADDRESS =
  'ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2';

let mockCapturedWitnesses: Record<string, any> = {};

vi.mock('@midnight-ntwrk/midnight-js-protocol/compact-js', () => ({
  CompiledContract: {
    make: vi.fn((_name: string, _contract: any) => ({
      pipe: vi.fn((...ops: any[]) => {
        let current: any = {};
        for (const op of ops) {
          if (typeof op === 'function') {
            current = op(current);
          }
        }
        return current;
      }),
    })),
    withWitnesses: vi.fn((witnesses: any) => {
      mockCapturedWitnesses = witnesses;
      return (target: any) => ({
        ...target,
        _witnesses: witnesses,
      });
    }),
    withCompiledFileAssets: vi.fn((assets: any) => {
      return (target: any) => ({
        ...target,
        _assets: assets,
      });
    }),
  },
}));

vi.mock('@midnight-ntwrk/midnight-js-contracts', () => {
  class MockContractTypeError extends TypeError {
    readonly contractState: any;
    readonly circuitIds: any[];
    constructor(contractState: any, circuitIds: any[]) {
      super('ContractTypeError: verifier key mismatch');
      this.name = 'ContractTypeError';
      this.contractState = contractState;
      this.circuitIds = circuitIds;
    }
  }

  class MockCallTxFailedError extends Error {
    readonly finalizedTxData: any;
    readonly circuitId: any;
    constructor(finalizedTxData: any, circuitId: any) {
      super('CallTxFailedError: transaction rejected by consensus');
      this.name = 'CallTxFailedError';
      this.finalizedTxData = finalizedTxData;
      this.circuitId = circuitId;
    }
  }

  return {
    findDeployedContract: vi.fn(),
    ContractTypeError: MockContractTypeError,
    CallTxFailedError: MockCallTxFailedError,
  };
});

vi.mock('../providers/createPreprodProviders', () => ({
  createPreprodProviders: vi.fn(),
}));

// Mock the managed contract index.js
vi.mock('../../../contracts/managed/veilpass/contract/index.js', () => ({
  Contract: class MockContract {},
  ledger: vi.fn((data: any) => ({
    policy_threshold: data?.policy_threshold ?? 18n,
    eligible: data?.eligible ?? true,
    threshold_used: data?.threshold_used ?? 18n,
  })),
}));

describe('useVeilPass Hook', () => {
  let mockConnectedApi: any;
  let mockWalletActions: MidnightActions;
  let mockCheckEligibility: ReturnType<typeof vi.fn>;
  let mockQueryContractState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    mockCapturedWitnesses = {};

    mockCheckEligibility = vi.fn().mockResolvedValue({
      public: {
        txId: 'tx-preprod-genuine-hash-1234567890',
        blockHeight: 12345,
      },
    });

    mockQueryContractState = vi.fn().mockResolvedValue({
      data: {
        eligible: true,
        threshold_used: 18n,
        policy_threshold: 18n,
      },
    });

    mockConnectedApi = {
      state: vi.fn().mockResolvedValue({
        address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        networkId: 'preprod',
      }),
    };

    mockWalletActions = {
      connect: vi.fn(),
      connectProvider: vi.fn(),
      disconnect: vi.fn(),
      reset: vi.fn(),
      reloadWalletChannel: vi.fn(),
      getConnectedApi: vi.fn(() => mockConnectedApi),
    };

    // Default mock implementation of createPreprodProviders
    (createPreprodProviders as any).mockResolvedValue({
      publicDataProvider: {
        queryContractState: mockQueryContractState,
      },
      privateStateProvider: {},
      zkConfigProvider: {},
      proofProvider: {},
      walletProvider: {},
      midnightProvider: {},
    });

    // Default mock implementation of findDeployedContract
    (findDeployedContract as any).mockResolvedValue({
      callTx: {
        checkEligibility: mockCheckEligibility,
      },
    });

    // Default mock for proof server fetch pre-check
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('Proof server healthy'),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. Initializes in not_configured state when contract address is missing', () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: undefined,
      })
    );

    expect(result.current[0].status).toBe('not_configured');
    expect(result.current[0].errorMessage).toMatch(/VITE_CONTRACT_ADDRESS is not configured/i);
  });

  it('2. Validates contract address format (64-char hex)', async () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: 'invalid-address-not-hex-64',
      })
    );

    expect(result.current[0].status).toBe('idle');

    await act(async () => {
      await result.current[1].proveEligibility(21);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toMatch(/Expected 64 hexadecimal characters/i);
    expect(findDeployedContract).not.toHaveBeenCalled();
  });

  it('3. Validates age input range (0..65535, integer only)', async () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    // Negative age
    await act(async () => {
      await result.current[1].proveEligibility(-1);
    });
    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toMatch(/valid age between 0 and 65,535/i);

    // Out of 16-bit range
    await act(async () => {
      await result.current[1].proveEligibility(70000);
    });
    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toMatch(/valid age between 0 and 65,535/i);

    // Float age
    await act(async () => {
      await result.current[1].proveEligibility(21.5);
    });
    expect(result.current[0].status).toBe('error');
    expect(findDeployedContract).not.toHaveBeenCalled();
  });

  it('4. Real hook calls joined contract checkEligibility with public threshold 18', async () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(findDeployedContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contractAddress: VALID_CONTRACT_ADDRESS,
        privateStateId: 'veilpassPrivateState',
      })
    );

    // Must call checkEligibility with threshold 18n
    expect(mockCheckEligibility).toHaveBeenCalledWith(18n);
    expect(result.current[0].status).toBe('eligible');
    expect(result.current[0].result.eligible).toBe(true);
    expect(result.current[0].result.thresholdUsed).toBe(18);
    expect(result.current[0].result.policyThreshold).toBe(18);
    expect(result.current[0].result.txHash).toBe('tx-preprod-genuine-hash-1234567890');
  });

  it('5. Age is supplied strictly through private witness closure and cleared immediately after execution', async () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    let witnessEvaluatedValue: bigint | null = null;

    mockCheckEligibility.mockImplementation(async () => {
      // Simulate Compact prover querying private witness during proof generation
      if (mockCapturedWitnesses.privateAge) {
        const [_, ageWitness] = mockCapturedWitnesses.privateAge({});
        witnessEvaluatedValue = ageWitness;
      }
      return {
        public: { txId: 'tx-test-privacy-456' },
      };
    });

    await act(async () => {
      await result.current[1].proveEligibility(29);
    });

    // Witness received the exact ephemeral age
    expect(witnessEvaluatedValue).toBe(29n);

    // Witness value must be strictly wiped in finally block
    expect(() => mockCapturedWitnesses.privateAge({})).toThrow(/Private age witness unavailable/i);
  });

  it('6. Age never appears in public result or persistent storage', async () => {
    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    const PRIVATE_AGE = 42;
    await act(async () => {
      await result.current[1].proveEligibility(PRIVATE_AGE);
    });

    // Verify result object contains only public fields
    expect(result.current[0].result).toEqual({
      eligible: true,
      thresholdUsed: 18,
      policyThreshold: 18,
      txHash: 'tx-preprod-genuine-hash-1234567890',
    });

    // Verify private age is not in state
    expect(JSON.stringify(result.current[0])).not.toContain(String(PRIVATE_AGE));

    // Verify storage is completely untouched
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('7. Duplicate submissions call the circuit once (in-flight protection)', async () => {
    let resolveCircuit: (val: any) => void;
    const circuitPromise = new Promise((resolve) => {
      resolveCircuit = resolve;
    });

    mockCheckEligibility.mockReturnValue(circuitPromise);

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    let firstPromise: Promise<void>;
    let secondPromise: Promise<void>;

    act(() => {
      firstPromise = result.current[1].proveEligibility(22);
      secondPromise = result.current[1].proveEligibility(22);
    });

    expect(result.current[0].status).toBe('proving');

    await act(async () => {
      resolveCircuit!({
        public: { txId: 'tx-single-submission' },
      });
      await Promise.all([firstPromise!, secondPromise!]);
    });

    // Only one execution should have reached the circuit
    expect(mockCheckEligibility).toHaveBeenCalledTimes(1);
    expect(result.current[0].status).toBe('eligible');
  });

  it('8. Underage circuit rejection: zero synthetic ledger data, clearly labeled local rejection', async () => {
    // When age < 18, Compact circuit assertion throws "Ineligible: age < threshold"
    mockCheckEligibility.mockRejectedValue(
      new Error('Circuit assertion failed: Ineligible: age < threshold')
    );

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(16);
    });

    // Zero synthetic data: thresholdUsed, policyThreshold, txHash MUST all be null
    expect(result.current[0].status).toBe('ineligible');
    expect(result.current[0].result.eligible).toBe(false);
    expect(result.current[0].result.thresholdUsed).toBeNull();
    expect(result.current[0].result.policyThreshold).toBeNull();
    expect(result.current[0].result.txHash).toBeNull();

    // UI message must state local rejection without claiming on-chain verification
    expect(result.current[0].errorMessage).toBe(
      'Rejected locally by the eligibility circuit — no transaction was submitted.'
    );
  });

  it('9. Wallet rejection and proof-server errors are classified correctly', async () => {
    // 9a. Wallet rejection (Midnight wallet phrasing)
    mockCheckEligibility.mockRejectedValue(new Error('User rejected the transaction in Midnight wallet.'));

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toBe('Transaction was rejected in Midnight wallet.');

    // 9b. Proof server network error
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to connect to proof server: ECONNREFUSED'))
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toMatch(/Proof server is unreachable/i);

    // 9c. Proof server HTTP error (response.ok is false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toMatch(/Proof server is unreachable/i);
  });

  it('10. Ephemeral age witness is wiped on unmount even if in progress', async () => {
    let resolveCircuit: (val: any) => void;
    mockCheckEligibility.mockReturnValue(
      new Promise((resolve) => {
        resolveCircuit = resolve;
      })
    );

    const { result, unmount } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    let provePromise: Promise<void> | undefined;
    act(() => {
      provePromise = result.current[1].proveEligibility(35);
    });

    // Wait until circuit call is in flight and witness has been bound
    await waitFor(() => {
      expect(mockCheckEligibility).toHaveBeenCalled();
    });

    // Unmount while proving is in progress
    unmount();

    // Witness closure must throw immediately as it has been cleared
    expect(() => mockCapturedWitnesses.privateAge({})).toThrow(/Private age witness unavailable/i);

    resolveCircuit!({ public: { txId: 'tx-late' } });
    await act(async () => {
      await provePromise;
    });
  });

  it('11. Strict allowlist: Unknown errors with arbitrary text or numbers never leak to UI', async () => {
    // Arbitrary unclassified error containing numbers and potential sensitive strings
    mockCheckEligibility.mockRejectedValue(
      new Error('Internal zswap error 42 at line 1024 with secret_val 9999')
    );

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    // Must return the strict allowlist fallback message
    expect(result.current[0].errorMessage).toBe(
      'Eligibility proof failed. No private input was stored. Please try again.'
    );
    // Raw message content must NOT leak
    expect(result.current[0].errorMessage).not.toContain('42');
    expect(result.current[0].errorMessage).not.toContain('1024');
    expect(result.current[0].errorMessage).not.toContain('secret_val');
  });

  it('12. ContractTypeError and CallTxFailedError are handled cleanly', () => {
    const typeError = new ContractTypeError({} as any, ['checkEligibility']);
    expect(normalizeEligibilityError(typeError)).toBe(
      'Contract not found at the configured address. The contract may have been redeployed.'
    );

    const txFailedError = new CallTxFailedError({} as any, 'checkEligibility');
    expect(normalizeEligibilityError(txFailedError)).toBe(
      'Transaction was submitted but rejected by the Midnight network. Please try again.'
    );
  });

  it('13. Missing contractState or missing data throws and maps to safe error', async () => {
    mockQueryContractState.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].errorMessage).toBe(
      'Contract not found at the configured address. The contract may have been redeployed.'
    );
  });

  it('14. Missing or falsy transaction ID in finalizedCallTx throws and does not confirm', async () => {
    mockCheckEligibility.mockResolvedValue({
      public: { txId: '' },
    });

    const { result } = renderHook(() =>
      useVeilPass({
        walletActions: mockWalletActions,
        contractAddress: VALID_CONTRACT_ADDRESS,
      })
    );

    await act(async () => {
      await result.current[1].proveEligibility(25);
    });

    expect(result.current[0].status).toBe('error');
    expect(result.current[0].result.eligible).toBeNull();
  });
});
