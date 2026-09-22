import type { EligibilityResult } from '../hooks/useVeilPass';
import styles from './LedgerResult.module.css';

interface LedgerResultProps {
  result: EligibilityResult;
}

export function LedgerResult({ result }: LedgerResultProps) {
  if (result.eligible === null) {
    return (
      <div className={styles.pending} role="status" aria-label="Proof not yet run">
        <p className={styles.pendingText}>
          On-chain ledger state will appear here after the proof is submitted and confirmed.
        </p>
      </div>
    );
  }

  // Local circuit rejection: no transaction was submitted to the network
  const isLocalRejection = result.eligible === false && !result.txHash;

  return (
    <div
      className={styles.result}
      data-eligible={result.eligible}
      role="status"
      aria-label={
        result.eligible
          ? 'Eligible'
          : isLocalRejection
          ? 'Rejected locally'
          : 'Not eligible'
      }
    >
      <div className={styles.icon} aria-hidden="true">
        {result.eligible ? '✦' : '✗'}
      </div>
      <div className={styles.details}>
        <p className={styles.verdict}>
          {result.eligible
            ? 'Eligible'
            : isLocalRejection
            ? 'Rejected Locally'
            : 'Not Eligible'}
        </p>
        {isLocalRejection && (
          <p className={styles.meta}>
            Rejected locally by the eligibility circuit — no transaction was submitted.
          </p>
        )}
        {!isLocalRejection && result.thresholdUsed !== null && (
          <p className={styles.meta}>
            Threshold verified: age &ge; {result.thresholdUsed}
            {result.policyThreshold !== null && result.policyThreshold !== undefined && (
              <span> (Policy minimum: {result.policyThreshold})</span>
            )}
          </p>
        )}
        {result.txHash && (
          <p className={styles.meta}>
            <span>Tx ID: </span>
            <code className={styles.hash} title={result.txHash}>
              {result.txHash.length > 20
                ? `${result.txHash.slice(0, 10)}…${result.txHash.slice(-8)}`
                : result.txHash}
            </code>
          </p>
        )}
      </div>
      <div className={styles.privacy}>
        <p>
          {isLocalRejection
            ? 'Your private input was evaluated locally and never left your device. No transaction was submitted to the network.'
            : 'Only the verification result is on-chain. Your exact age was never disclosed.'}
        </p>
      </div>
    </div>
  );
}
