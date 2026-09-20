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
          Ledger state will appear here after the proof is submitted.
        </p>
      </div>
    );
  }

  return (
    <div
      className={styles.result}
      data-eligible={result.eligible}
      role="status"
      aria-label={result.eligible ? 'Eligible' : 'Not eligible'}
    >
      <div className={styles.icon} aria-hidden="true">
        {result.eligible ? '✦' : '✗'}
      </div>
      <div className={styles.details}>
        <p className={styles.verdict}>
          {result.eligible ? 'Eligible' : 'Not Eligible'}
        </p>
        {result.thresholdUsed !== null && (
          <p className={styles.meta}>
            Threshold verified: age &ge; {result.thresholdUsed}
          </p>
        )}
        {result.txHash && (
          <p className={styles.meta}>
            <span>Tx: </span>
            <code className={styles.hash}>{result.txHash.slice(0, 12)}…</code>
          </p>
        )}
      </div>
      <div className={styles.privacy}>
        <p>
          Only the verification result is on-chain. Your age was never disclosed.
        </p>
      </div>
    </div>
  );
}
