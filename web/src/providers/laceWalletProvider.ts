/**
 * LaceWalletProvider — adapts Lace ConnectedAPI to Midnight.js
 * WalletProvider & MidnightProvider interfaces.
 *
 * Conforms to:
 * - @midnight-ntwrk/dapp-connector-api@4.0.1 ConnectedAPI
 * - @midnight-ntwrk/midnight-js-types@4.1.1 WalletProvider & MidnightProvider
 */

import type {
  WalletProvider,
  MidnightProvider,
  UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';
import type {
  CoinPublicKey,
  EncPublicKey,
  FinalizedTransaction,
  TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { ConnectedAPI } from '../types/midnight';
import { toHex, fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';

export type DeploymentStage =
  | 'idle'
  | 'initialize_network'
  | 'check_proof_server'
  | 'create_providers'
  | 'import_contract'
  | 'compile_contract'
  | 'create_unbound_transaction'
  | 'request_lace_balance'
  | 'receive_lace_balance'
  | 'deserialize_balanced_transaction'
  | 'submit_transaction'
  | 'receive_transaction_id'
  | 'wait_for_indexer'
  | 'extract_contract_address'
  | 'confirmed';

export type StageListener = (stage: DeploymentStage, metadata?: Record<string, unknown>) => void;

export interface LaceWalletProviderOptions {
  onStageChange?: StageListener;
}

export interface LaceWalletAdapter extends WalletProvider, MidnightProvider {
  initialize(): Promise<void>;
}

/**
 * Safe development-only inspection of the ConnectedAPI runtime object.
 * Prints only enumerable keys, detected method names, and public configuration.
 * Never prints addresses, balances, seeds, private keys, or transaction payloads.
 */
export function inspectConnectedApiSafely(api: unknown): void {
  if (!import.meta.env.DEV || !api || typeof api !== 'object') return;

  const target = api as Record<string, unknown>;
  const keys = Object.keys(target);

  const candidateMethods = [
    'balanceUnsealedTransaction',
    'balanceSealedTransaction',
    'balanceTransaction',
    'submitTransaction',
    'submitTx',
    'getShieldedAddresses',
    'getUnshieldedAddress',
    'getConfiguration',
    'getConnectionStatus',
    'getDustBalance',
    'getDustAddress',
    'getShieldedBalances',
    'getUnshieldedBalances',
    'getTxHistory',
    'makeTransfer',
    'makeIntent',
    'signData',
    'getProvingProvider',
    'hintUsage',
  ];

  const detectedMethods = candidateMethods.filter((m) => typeof target[m] === 'function');

  const namespaces = ['wallet', 'midnight', 'unshielded', 'shielded'];
  const nestedInfo: Record<string, string[]> = {};
  for (const ns of namespaces) {
    if (target[ns] && typeof target[ns] === 'object') {
      const nsObj = target[ns] as Record<string, unknown>;
      nestedInfo[ns] = Object.keys(nsObj)
        .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(nsObj) || {}))
        .filter((k) => typeof nsObj[k] === 'function');
    }
  }

  console.info('[Lace Connector Diagnostic]', {
    enumerableKeys: keys,
    detectedMethods,
    nestedNamespaces: nestedInfo,
  });
}

export async function createLaceWalletProvider(
  connectedApi: ConnectedAPI,
  options?: LaceWalletProviderOptions
): Promise<LaceWalletAdapter> {
  // Safe diagnostic log in dev mode
  inspectConnectedApiSafely(connectedApi);

  // Feature-detect balancing function on connectedApi
  const balanceFn =
    typeof connectedApi.balanceUnsealedTransaction === 'function'
      ? connectedApi.balanceUnsealedTransaction.bind(connectedApi)
      : typeof (connectedApi as Record<string, unknown>).balanceTransaction === 'function'
      ? ((connectedApi as Record<string, unknown>).balanceTransaction as (tx: string, opts?: { payFees?: boolean }) => Promise<{ tx: string }>).bind(connectedApi)
      : null;

  if (!balanceFn) {
    throw new Error(
      'Connected Lace wallet does not provide a supported transaction balancing method (neither balanceUnsealedTransaction nor balanceTransaction found). Please ensure your Lace extension is up to date.'
    );
  }

  // Feature-detect submission function on connectedApi
  const submitFn =
    typeof connectedApi.submitTransaction === 'function'
      ? connectedApi.submitTransaction.bind(connectedApi)
      : typeof (connectedApi as Record<string, unknown>).submitTx === 'function'
      ? ((connectedApi as Record<string, unknown>).submitTx as (tx: string) => Promise<void>).bind(connectedApi)
      : null;

  if (!submitFn) {
    throw new Error(
      'Connected Lace wallet does not provide a supported transaction submission method (submitTransaction not found). Please ensure your Lace extension is up to date.'
    );
  }

  // Pre-fetch public shielded keys
  const shielded = await connectedApi.getShieldedAddresses();

  const adapter: LaceWalletAdapter = {
    async initialize(): Promise<void> {
      // Keys already resolved
    },

    getCoinPublicKey(): CoinPublicKey {
      return shielded.shieldedCoinPublicKey as CoinPublicKey;
    },

    getEncryptionPublicKey(): EncPublicKey {
      return shielded.shieldedEncryptionPublicKey as EncPublicKey;
    },

    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      // Stage 6 -> 7: Requesting balance from Lace
      options?.onStageChange?.('request_lace_balance');

      // 1. Serialize UnboundTransaction (Transaction<SignatureEnabled, Proof, PreBinding>) to Uint8Array
      const rawBytes: Uint8Array = tx.serialize();

      // 2. Convert to hex string for the DApp Connector API
      const hex = toHex(rawBytes);

      // 3. Delegate balancing and signing to Lace wallet
      // 3. Delegate balancing and signing to Lace wallet
      const result = await balanceFn(hex, { payFees: true });

      // Stage 8: Safely inspect real Lace balance result
      options?.onStageChange?.('receive_lace_balance');

      if (!result || typeof result !== 'object') {
        throw new Error(
          `Lace wallet balance returned invalid result: expected object, got ${result === null ? 'null' : typeof result}.`
        );
      }

      const resultObj = result as Record<string, unknown>;
      const resultKeys = Object.keys(resultObj);
      const txVal = resultObj.tx;

      if (typeof txVal !== 'string') {
        throw new Error(
          `Lace wallet balance returned invalid result.tx: expected string, got ${typeof txVal}.`
        );
      }

      const has0x = txVal.startsWith('0x') || txVal.startsWith('0X');
      const cleanHex = has0x ? txVal.slice(2) : txVal;
      const isEmpty = cleanHex.length === 0;

      // Safe dev-only diagnostic logging: NEVER log transaction hex or proof bytes
      if (import.meta.env?.DEV || process.env.NODE_ENV !== 'production') {
        console.info('[Lace Balance Diagnostic]', {
          stage: 'receive_lace_balance',
          resultType: typeof result,
          resultKeys,
          txType: typeof txVal,
          txLength: txVal.length,
          isEmpty,
          has0xPrefix: has0x,
          cleanLength: cleanHex.length,
        });
      }

      if (isEmpty) {
        throw new Error('Lace wallet balance returned an empty transaction string.');
      }

      if (cleanHex.length % 2 !== 0) {
        throw new Error(
          `Lace wallet balance returned malformed transaction hex with odd length (${cleanHex.length}).`
        );
      }

      if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
        throw new Error(
          'Lace wallet balance returned malformed transaction containing non-hexadecimal characters.'
        );
      }

      // Stage 9: Deserializing balanced transaction into FinalizedTransaction
      options?.onStageChange?.('deserialize_balanced_transaction');

      // 4. Convert balanced hex string (without 0x prefix) back to Uint8Array
      const balancedBytes = new Uint8Array(fromHex(cleanHex));

      // 5. Deserialize into FinalizedTransaction (Transaction<SignatureEnabled, Proof, Binding>)
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        balancedBytes
      ) as FinalizedTransaction;
    },

    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      // Stage 10: Submitting transaction to the network via Lace relayer
      options?.onStageChange?.('submit_transaction');

      // 1. Serialize FinalizedTransaction to hex for Lace submitTransaction
      const rawBytes: Uint8Array = tx.serialize();
      const hex = toHex(rawBytes);

      // 2. Submit transaction to the network via Lace relayer
      await submitFn(hex);

      // Stage 11: Extracting genuine TransactionId from transaction identifiers
      options?.onStageChange?.('receive_transaction_id');
      const ids = tx.identifiers();
      if (!ids || ids.length === 0 || typeof ids[0] !== 'string' || ids[0].trim().length === 0) {
        throw new Error('Transaction has no identifiers after balancing and submission.');
      }

      const txId = ids[0];

      if (import.meta.env?.DEV || process.env.NODE_ENV !== 'production') {
        console.info('[Lace Submit Diagnostic]', {
          stage: 'receive_transaction_id',
          hasTransactionId: Boolean(txId),
          txIdLength: txId.length,
        });
      }

      return txId;
    },
  };

  return adapter;
}
