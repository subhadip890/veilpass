/**
 * EligibilityProof — shell component.
 *
 * Renders as locked/unavailable until:
 *   1. A wallet is connected on Preprod.
 *   2. VITE_CONTRACT_ADDRESS is set to a real Preprod contract address.
 *
 * Does NOT call the circuit. Does NOT generate fake proofs.
 */

import type { VeilPassState } from '../hooks/useVeilPass';
import type { MidnightState } from '../hooks/useMidnight';
import { ProofProgress } from './ProofProgress';
import { LedgerResult } from './LedgerResult';
import styles from './EligibilityProof.module.css';

interface EligibilityProofProps {
  walletState: MidnightState;
  veilPass: VeilPassState;
}

export function EligibilityProof({ walletState, veilPass }: EligibilityProofProps) {
  const walletConnected = walletState.status === 'connected';
  const configured = veilPass.status !== 'not_configured';
  const isLocked = !walletConnected || !configured;

  return (
    <section className={styles.card} aria-label="Eligibility proof">
      <div className={styles.header}>
        <h2 className={styles.title}>
          <span className={styles.titleIcon} aria-hidden="true">
            {isLocked ? '🔒' : '✦'}
          </span>
          Check Eligibility
        </h2>
        <span
          className={styles.badge}
          data-state={isLocked ? 'locked' : 'ready'}
          aria-label={isLocked ? 'Unavailable' : 'Ready'}
        >
          {isLocked ? 'Unavailable' : 'Ready'}
        </span>
      </div>

      {isLocked && (
        <div className={styles.lockedPane} role="status">
          <div className={styles.lockIcon} aria-hidden="true">⬡</div>
          <p className={styles.lockedTitle}>Eligibility Proof Locked</p>
          <ul className={styles.requirements}>
            <li data-met={walletConnected} aria-label={walletConnected ? 'Wallet connected' : 'Wallet not connected'}>
              <span className={styles.reqIcon} aria-hidden="true">{walletConnected ? '✓' : '○'}</span>
              Connect Midnight Preprod wallet
            </li>
            <li data-met={configured} aria-label={configured ? 'Contract configured' : 'Contract not configured'}>
              <span className={styles.reqIcon} aria-hidden="true">{configured ? '✓' : '○'}</span>
              Contract address configured (VITE_CONTRACT_ADDRESS)
            </li>
          </ul>
          {veilPass.errorMessage && (
            <p className={styles.configNote}>{veilPass.errorMessage}</p>
          )}
        </div>
      )}

      {!isLocked && (
        <div className={styles.activePane}>
          <ProofProgress status={veilPass.status} />
          <LedgerResult result={veilPass.result} />
          <p className={styles.disclaimer}>
            This proof uses a self-attested age (Level 1 limitation). The circuit proves only
            that your supplied private integer satisfies age &ge; 18 — not a real-world identity.
          </p>
        </div>
      )}
    </section>
  );
}
