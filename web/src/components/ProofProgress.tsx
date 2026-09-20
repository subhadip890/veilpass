import type { EligibilityStatus } from '../hooks/useVeilPass';
import styles from './ProofProgress.module.css';

interface ProofProgressProps {
  status: EligibilityStatus;
}

const steps: { key: EligibilityStatus | string; label: string }[] = [
  { key: 'idle', label: 'Ready' },
  { key: 'awaiting_input', label: 'Enter private age' },
  { key: 'proving', label: 'Generating ZK proof' },
  { key: 'submitting', label: 'Submitting to Preprod' },
  { key: 'eligible', label: 'Verified' },
];

const stepOrder: EligibilityStatus[] = [
  'idle',
  'awaiting_input',
  'proving',
  'submitting',
  'eligible',
];

export function ProofProgress({ status }: ProofProgressProps) {
  const currentIndex = stepOrder.indexOf(status);

  return (
    <div className={styles.container} role="status" aria-label="Proof progress">
      <div className={styles.steps}>
        {steps.map((step, i) => {
          const done = currentIndex > i;
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
    </div>
  );
}
