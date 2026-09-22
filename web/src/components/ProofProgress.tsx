import type { EligibilityStatus } from '../hooks/useVeilPass';
import styles from './ProofProgress.module.css';

interface ProofProgressProps {
  status: EligibilityStatus;
}

const steps = [
  { key: 'ready', label: 'Ready' },
  { key: 'proving', label: 'Generating ZK proof' },
  { key: 'waiting_for_wallet', label: 'Authorize in Lace' },
  { key: 'submitting', label: 'Submitting to Preprod' },
  { key: 'confirmed', label: 'Verified' },
];

function getStepIndex(status: EligibilityStatus): number {
  switch (status) {
    case 'not_configured':
    case 'idle':
    case 'awaiting_input':
      return 0;
    case 'proving':
      return 1;
    case 'waiting_for_wallet':
      return 2;
    case 'submitting':
      return 3;
    case 'eligible':
    case 'ineligible':
      return 4;
    case 'error':
      return -1;
    default:
      return 0;
  }
}

export function ProofProgress({ status }: ProofProgressProps) {
  const currentIndex = getStepIndex(status);

  return (
    <div className={styles.container} role="status" aria-label="Proof progress">
      <div className={styles.steps}>
        {steps.map((step, i) => {
          const done = currentIndex > i && currentIndex !== -1;
          const active = currentIndex === i;
          return (
            <div
              key={step.key}
              className={styles.step}
              data-done={done}
              data-active={active}
              aria-current={active ? 'step' : undefined}
            >
              <div className={styles.dot} aria-hidden="true">
                {done ? '✓' : i + 1}
              </div>
              <span className={styles.stepLabel}>{step.label}</span>
              {i < steps.length - 1 && (
                <div
                  className={styles.connector}
                  data-done={done}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

      {status === 'proving' && (
        <div className={styles.proofNote} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          ZK proof generation runs locally in your browser. This may take 15–60 seconds.
        </div>
      )}

      {status === 'waiting_for_wallet' && (
        <div className={styles.proofNote} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Waiting for authorization in Lace wallet. Please review and sign the transaction prompt.
        </div>
      )}

      {status === 'submitting' && (
        <div className={styles.proofNote} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Transaction submitted to Midnight Preprod. Awaiting blockchain indexer confirmation…
        </div>
      )}
    </div>
  );
}
