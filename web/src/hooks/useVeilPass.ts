/**
 * useVeilPass hook — Real implementation for the Level 2 eligibility proof flow.
 *
 * Interacts with the genuine Midnight Preprod network:
 *   - Creates Preprod providers using the connected Midnight wallet API.
 *   - Compiles the VeilPass contract with an ephemeral privateAge witness.
 *   - Joins the deployed contract at VITE_CONTRACT_ADDRESS using findDeployedContract.
 *   - Calls checkEligibility(18n).
 *   - Queries genuine on-chain public ledger state from the indexer.
 *
 * Privacy Guarantees:
 *   - Private age witness is stored in an ephemeral ref only during proof generation.
 *   - Cleared immediately upon success, rejection, error, or unmount.
 *   - Never stored in localStorage, sessionStorage, logs, URL, or ledger.
 *   - Local circuit rejection leaves zero synthetic ledger data (thresholds/txHash null).
 *   - Strict error allowlist ensures unknown prover/network errors never leak raw details.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { MidnightActions } from './useMidnight';
import type { ConnectedAPI } from '../types/midnight';
import { initializeMidnightNetwork, PREPROD_CONFIG } from '../providers/networkConfig';
import { createPreprodProviders } from '../providers/createPreprodProviders';
import {
  findDeployedContract,
  ContractTypeError,
  CallTxFailedError,
  type FoundContract,
  type FinalizedCallTxData,
} from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { Contract as VeilPassContract, Ledger } from '../../../contracts/managed/veilpass/contract/index.js';
import type { ContractState } from '@midnight-ntwrk/compact-runtime';
import { CONTRACT_ADDRESS_REGEX } from '../components/deployUtils';

export type EligibilityStatus =
  | 'not_configured'     // contract address missing or invalid
  | 'idle'               // ready to enter age and prove
  | 'awaiting_input'     // awaiting user input
  | 'proving'            // local ZK proof generation in progress
  | 'waiting_for_wallet' // awaiting user authorization in Midnight wallet
  | 'submitting'         // transaction submitted to Preprod indexer
  | 'eligible'           // on-chain state: eligible = true
  | 'ineligible'         // on-chain state: eligible = false or circuit rejected
  | 'error';             // network, proof-server, or wallet error

export interface EligibilityResult {
  eligible: boolean | null;
  thresholdUsed: number | null;
  policyThreshold?: number | null;
  txHash: string | null;
}

export interface VeilPassState {
  status: EligibilityStatus;
  result: EligibilityResult;
  errorMessage: string | null;
  contractAddress: string | null;
}

export interface VeilPassActions {
  proveEligibility: (age: number) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

export type UseVeilPassReturn = [VeilPassState, VeilPassActions];

export interface UseVeilPassOptions {
  walletActions?: MidnightActions;
  getConnectedApi?: () => ConnectedAPI | null;
  contractAddress?: string;
}

/**
 * Normalizes any error thrown during eligibility proof generation into a safe,
 * user-friendly message using an explicit allowlist.
 *
 * PRIVACY GUARANTEE:
 * Unknown or unclassified errors NEVER leak raw strings, stack traces, numbers,
 * or potential private inputs to the UI. Everything not explicitly matched in the
 * allowlist returns a strict generic fallback.
 */
export function normalizeEligibilityError(err: unknown): string {
  if (!err) {
    return 'Eligibility proof failed. No private input was stored. Please try again.';
  }

  if (err instanceof ContractTypeError) {
    return 'Contract not found at the configured address. The contract may have been redeployed.';
  }

  if (err instanceof CallTxFailedError) {
    return 'Transaction was submitted but rejected by the Midnight network. Please try again.';
  }

  const msg = err instanceof Error ? err.message : String((err as any)?.message || (err as any)?.reason || err);

  if (/Ineligible:\s*age\s*<\s*threshold/i.test(msg) || /assertion failed/i.test(msg)) {
    return 'Rejected locally by the eligibility circuit — no transaction was submitted.';
  }

  if (/user rejected|user denied|declined|cancelled|rejected by user/i.test(msg)) {
    return 'Transaction was rejected in Midnight wallet.';
  }

  if (/proof server is unreachable|proof server returned|failed to fetch|networkerror|econnrefused|failed to connect/i.test(msg)) {
    return 'Proof server is unreachable. Ensure the Midnight proof server is running (e.g. "docker compose up -d").';
  }

  if (/channel.*shutdown|wallet.*locked/i.test(msg)) {
    return 'Midnight wallet channel closed or locked. Please unlock your wallet and reload the page.';
  }

  if (/timeout|timed out/i.test(msg)) {
    return 'Operation timed out waiting for network response. Please verify network connectivity and try again.';
  }

  if (/contract.*not found|contracttypeerror|wrong contract/i.test(msg)) {
    return 'Contract not found at the configured address. The contract may have been redeployed.';
  }

  // STRICT ALLOWLIST: Fallback never exposes raw err.message or arbitrary content
  return 'Eligibility proof failed. No private input was stored. Please try again.';
}

export function useVeilPass(
  optionsOrActions?: UseVeilPassOptions | MidnightActions
): UseVeilPassReturn {
  // Extract configuration from options or actions
  const options: UseVeilPassOptions = useMemo(() => {
    return optionsOrActions && 'getConnectedApi' in optionsOrActions && !('walletActions' in optionsOrActions)
      ? { walletActions: optionsOrActions as MidnightActions }
      : (optionsOrActions as UseVeilPassOptions) ?? {};
  }, [optionsOrActions]);

  const configuredAddress = (
    ('contractAddress' in options
      ? options.contractAddress
      : (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'])
  )?.trim() ?? null;

  const [state, setState] = useState<VeilPassState>(() => ({
    status: configuredAddress ? 'idle' : 'not_configured',
    result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
    errorMessage: !configuredAddress
      ? 'VITE_CONTRACT_ADDRESS is not configured. Set it in .env.local to a real Preprod contract address.'
      : null,
    contractAddress: configuredAddress,
  }));

  // Ephemeral witness ref: NEVER stored in React render state, logs, or persistent storage
  const ephemeralAgeRef = useRef<bigint | null>(null);
  const isProvingRef = useRef(false);

  // Clear witness and reset in-flight flag on unmount
  useEffect(() => {
    return () => {
      ephemeralAgeRef.current = null;
      isProvingRef.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    ephemeralAgeRef.current = null;
    isProvingRef.current = false;
    setState((prev) => ({
      ...prev,
      status: configuredAddress ? 'idle' : 'not_configured',
      result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
      errorMessage: null,
    }));
  }, [configuredAddress]);

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      errorMessage: null,
      status: prev.status === 'error' ? (configuredAddress ? 'idle' : 'not_configured') : prev.status,
    }));
  }, [configuredAddress]);

  const proveEligibility = useCallback(
    async (age: number) => {
      // 1. Prevent duplicate submission while in progress
      if (isProvingRef.current) return;

      // 2. Validate age input (16-bit unsigned integer)
      if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 65535) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Please enter a valid age between 0 and 65,535.',
        }));
        return;
      }

      // 3. Validate contract address
      const targetAddress = (
        ('contractAddress' in options
          ? options.contractAddress
          : (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'])
      )?.trim();

      if (!targetAddress || !CONTRACT_ADDRESS_REGEX.test(targetAddress)) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Contract address is invalid or not configured. Expected 64 hexadecimal characters.',
        }));
        return;
      }

      // 4. Access connected wallet API
      const connectedApi =
        options.getConnectedApi?.() ??
        options.walletActions?.getConnectedApi?.() ??
        null;

      if (!connectedApi) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Midnight wallet is not connected. Please connect your wallet to Midnight Preprod first.',
        }));
        return;
      }

      // 5. Set in-flight lock and store ephemeral private witness immediately
      isProvingRef.current = true;
      ephemeralAgeRef.current = BigInt(age);

      setState((prev) => ({
        ...prev,
        status: 'proving',
        errorMessage: null,
        result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
      }));

      try {
        // 6. Pre-check proof server connectivity requiring HTTP response.ok
        try {
          const response = await fetch(PREPROD_CONFIG.proofServer, {
            method: 'GET',
            signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) {
            throw new Error(`Proof server returned HTTP ${response.status}`);
          }
        } catch {
          setState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: `Proof server is unreachable at ${PREPROD_CONFIG.proofServer}. Ensure the Midnight proof server is running (e.g. "docker compose up -d").`,
          }));
          return;
        }

        // Initialize Midnight Preprod network singleton
        initializeMidnightNetwork();

        // Build browser providers with stage tracking
        const providers = await createPreprodProviders(connectedApi, {
          onStageChange: (stage) => {
            if (stage === 'request_lace_balance') {
              setState((prev) => ({ ...prev, status: 'waiting_for_wallet' }));
            } else if (stage === 'submit_transaction') {
              setState((prev) => ({ ...prev, status: 'submitting' }));
            }
          },
        });

        // Dynamically import managed VeilPass contract
        const { Contract, ledger } = await import('../../../contracts/managed/veilpass/contract/index.js');

        // Compile contract with ephemeral privateAge witness closure.
        // Effect combinators (withWitnesses, withCompiledFileAssets) require minimal casts
        // due to Effect-TS pipeable generic constraints.
        const compiledContract = (
          CompiledContract.make('veilpass', Contract as any) as any
        ).pipe(
          (CompiledContract.withWitnesses as any)({
            privateAge: (_ctx: any) => {
              const currentWitnessAge = ephemeralAgeRef.current;
              if (currentWitnessAge === null || currentWitnessAge === undefined) {
                throw new Error('Private age witness unavailable. Please enter your age.');
              }
              return [{}, currentWitnessAge];
            },
          }),
          (CompiledContract.withCompiledFileAssets as any)('/midnight/veilpass')
        );

        // Join canonical deployed contract on Preprod with genuine FoundContract type.
        // Providers require cast to any to satisfy ContractProviders circuitId parameterization.
        const deployed = (await findDeployedContract(providers as any, {
          compiledContract: compiledContract as any,
          contractAddress: targetAddress,
          privateStateId: 'veilpassPrivateState',
          initialPrivateState: {},
        })) as FoundContract<VeilPassContract>;

        // Invoke checkEligibility circuit with public policy threshold = 18n
        const finalizedTx: FinalizedCallTxData<VeilPassContract, 'checkEligibility'> =
          await (deployed.callTx as any).checkEligibility(18n);

        const txIdRaw = finalizedTx?.public?.txId;
        const txHash = txIdRaw ? String(txIdRaw).trim() : null;
        if (!txHash) {
          throw new Error('Transaction was submitted but no transaction ID was returned by the network.');
        }

        // Query confirmed on-chain ledger state from indexer
        const contractState: ContractState | null =
          await providers.publicDataProvider.queryContractState(targetAddress);
        if (!contractState || !contractState.data) {
          throw new Error(`Contract state not found for address ${targetAddress}. Contract may not yet be indexed.`);
        }

        const ls: Ledger = ledger(contractState.data);

        setState((prev) => ({
          ...prev,
          status: ls.eligible ? 'eligible' : 'ineligible',
          result: {
            eligible: Boolean(ls.eligible),
            thresholdUsed: Number(ls.threshold_used),
            policyThreshold: Number(ls.policy_threshold),
            txHash,
          },
          errorMessage: null,
        }));
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String((err as any)?.message || err);

        // If circuit assertion failed (underage), record explicit ineligible state:
        // No synthetic ledger data — thresholdUsed, policyThreshold, and txHash must ALL be null.
        if (/Ineligible:\s*age\s*<\s*threshold/i.test(rawMsg) || /assertion failed/i.test(rawMsg)) {
          setState((prev) => ({
            ...prev,
            status: 'ineligible',
            result: {
              eligible: false,
              thresholdUsed: null,
              policyThreshold: null,
              txHash: null,
            },
            errorMessage: 'Rejected locally by the eligibility circuit — no transaction was submitted.',
          }));
        } else {
          const sanitized = normalizeEligibilityError(err);
          setState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: sanitized,
          }));
        }
      } finally {
        // CRITICAL PRIVACY: Always wipe ephemeral witness value and reset in-flight lock
        ephemeralAgeRef.current = null;
        isProvingRef.current = false;
      }
    },
    [options]
  );

  return [state, { proveEligibility, reset, clearError }];
}
