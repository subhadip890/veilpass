import type { DeploymentStage } from '../providers/laceWalletProvider';

export type DeployPhase =
  | 'idle'
  | 'in_progress'
  | 'confirmed'
  | 'confirmation_pending'
  | 'error';

export interface DeploymentAttemptRecord {
  attemptStart: number;
  currentPhase: DeploymentStage;
  txId: string | null;
  contractAddress: string | null;
  failureStage: DeploymentStage | null;
  errorCategory: string | null;
}

export const STAGE_LABELS: Record<DeploymentStage, string> = {
  idle: 'Ready to deploy',
  initialize_network: 'Configuring Midnight Preprod network…',
  check_proof_server: 'Checking local proof server…',
  create_providers: 'Connecting to Midnight providers…',
  import_contract: 'Loading compiled VeilPass contract…',
  compile_contract: 'Preparing contract executable…',
  create_unbound_transaction: 'Building deployment transaction…',
  request_lace_balance: 'Waiting for authorization in Lace…',
  receive_lace_balance: 'Received balanced transaction from Lace…',
  deserialize_balanced_transaction: 'Validating balanced transaction…',
  submit_transaction: 'Submitting transaction to Midnight Preprod…',
  receive_transaction_id: 'Transaction submitted, received transaction ID…',
  wait_for_indexer: 'Waiting for blockchain indexer confirmation…',
  extract_contract_address: 'Verifying on-chain contract address…',
  confirmed: 'VeilPass successfully deployed!',
};

export const CONTRACT_ADDRESS_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Normalizes any error thrown during deployment into a safe, non-empty message
 * and category. Redacts passwords, seeds, phrases, and long hex sequences.
 * Never returns an empty string.
 */
export function normalizeDeploymentError(
  err: unknown,
  stage: DeploymentStage
): { message: string; category: string } {
  let rawMessage = '';
  let category = 'unknown';

  if (err instanceof Error) {
    rawMessage = err.message || err.name || String(err);
    category = err.name || 'Error';
    if ((err as any).code) {
      category = String((err as any).code);
    }
  } else if (typeof err === 'string') {
    rawMessage = err;
    category = 'string_error';
  } else if (err && typeof err === 'object') {
    const errObj = err as Record<string, unknown>;
    if (errObj.type === 'DAppConnectorAPIError' || typeof errObj.code === 'string') {
      category = String(errObj.code || errObj.type);
      rawMessage = String(errObj.reason || errObj.message || errObj.code);
    } else if (typeof errObj.message === 'string' && errObj.message.trim().length > 0) {
      rawMessage = errObj.message;
      category =
        typeof errObj.code === 'string' || typeof errObj.code === 'number'
          ? String(errObj.code)
          : 'object_error';
    } else if (typeof errObj.reason === 'string' && errObj.reason.trim().length > 0) {
      rawMessage = errObj.reason;
      category = 'reason_error';
    } else if (typeof errObj.error === 'string' && errObj.error.trim().length > 0) {
      rawMessage = errObj.error;
      category = 'nested_error';
    } else if (errObj.error && typeof errObj.error === 'object') {
      const nested = errObj.error as Record<string, unknown>;
      rawMessage = String(nested.message || nested.reason || JSON.stringify(nested));
      category = 'nested_error_object';
    } else if (typeof errObj.statusText === 'string' && errObj.statusText.trim().length > 0) {
      rawMessage = errObj.statusText;
      category = 'http_error';
    } else {
      try {
        rawMessage = JSON.stringify(err);
        category = 'json_object';
      } catch {
        rawMessage = String(err);
        category = 'unserializable_object';
      }
    }
  } else {
    rawMessage = String(err ?? 'Unknown error occurred');
    category = 'primitive';
  }

  // Redact sensitive patterns: passwords, seeds, recovery phrases, private keys, long hexes
  let sanitized = rawMessage
    .replace(/(?:password|seed|phrase|secret)[:=]\s*\S+/gi, '[REDACTED]')
    .replace(/(?:0x)?[0-9a-fA-F]{64,}/g, '[REDACTED]')
    .replace(/0x[0-9a-fA-F]{32,}/g, '[REDACTED]')
    .trim();

  // If message is empty after sanitization, show safe fallback including stage
  if (sanitized.length === 0 || sanitized === '[REDACTED]') {
    sanitized = `Deployment failed during ${stage}. Open diagnostics or retry after verifying no transaction was submitted.`;
  }

  return { message: sanitized, category };
}
