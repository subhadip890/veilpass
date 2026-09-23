/**
 * EligibilityProof component.
 *
 * Provides the interactive UI for Level 2 zero-knowledge age verification:
 *   - Secure ephemeral private age input.
 *   - Duplicate-click and in-flight submission protection.
 *   - Real-time progression through Preprod stages.
 *   - Displays genuine on-chain results (eligible, threshold, policy, tx ID).
 *   - Clearly labels local circuit rejections (no transaction submitted).
 *   - Never stores or displays private age witness.
 */

import { useState, useCallback, useEffect } from 'react';
import type { VeilPassState, VeilPassActions } from '../hooks/useVeilPass';
import type { MidnightState } from '../hooks/useMidnight';
import { ProofProgress } from './ProofProgress';
import { LedgerResult } from './LedgerResult';
import styles from './EligibilityProof.module.css';

export interface EligibilityProofProps {
  walletState?: MidnightState;
  walletConnected?: boolean;
  veilPass: VeilPassState;
  actions: VeilPassActions;
}

export function EligibilityProof({
  walletState,
  walletConnected: walletConnectedProp,
  veilPass,
  actions,
}: EligibilityProofProps) {
  const [ageInput, setAgeInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const walletConnected =
    walletConnectedProp ?? (walletState ? walletState.status === 'connected' : false);
  const configured = veilPass.status !== 'not_configured';
  const isLocked = !walletConnected || !configured;

  const isBusy =
    veilPass.status === 'proving' ||
    veilPass.status === 'waiting_for_wallet' ||
    veilPass.status === 'submitting';

  // Wipe temporary input string upon unmount or when reset
  useEffect(() => {
    return () => {
      setAgeInput('');
      setValidationError(null);
    };
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isBusy || isLocked) return;

      const trimmed = ageInput.trim();
      if (!trimmed) {
        setValidationError('Please enter your age.');
        return;
      }

      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        setValidationError('Age must be a whole number between 0 and 65,535.');
        return;
      }

      setValidationError(null);
      await actions.proveEligibility(parsed);
      // Privacy safeguard: clear input field immediately after submission
      setAgeInput('');
    },
    [ageInput, isBusy, isLocked, actions]
  );

  const getBadgeLabel = () => {
    if (isLocked) return 'Unavailable';
    switch (veilPass.status) {
      case 'proving':
        return 'Proving';
      case 'waiting_for_wallet':
        return 'Authorizing';
      case 'submitting':
        return 'Submitting';
      case 'eligible':
        return 'Verified';
      case 'ineligible':
        return 'Not Eligible';
      case 'error':
        return 'Failed';
      default:
        return 'Ready';
    }
  };

  const getBadgeState = () => {
    if (isLocked) return 'locked';
    switch (veilPass.status) {
      case 'proving':
      case 'waiting_for_wallet':
      case 'submitting':
        return 'busy';
      case 'eligible':
        return 'success';
      case 'ineligible':
      case 'error':
        return 'error';
      default:
        return 'ready';
    }
  };

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
          data-state={getBadgeState()}
          aria-label={getBadgeLabel()}
        >
          {getBadgeLabel()}
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
          <form onSubmit={handleSubmit} className={styles.proofForm} noValidate>
            <div className={styles.fieldGroup}>
              <label htmlFor="input-private-age" className={styles.label}>
                Private Age Witness
                <span className={styles.labelSub}>Evaluated locally in ZK circuit, never broadcast</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="input-private-age"
                  name="privateAge"
                  type={showPassword ? 'number' : 'password'}
                  inputMode="numeric"
                  min="0"
                  max="65535"
                  step="1"
                  value={ageInput}
                  onChange={(e) => {
                    setAgeInput(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  disabled={isBusy}
                  placeholder="Enter age (e.g. 21)"
                  className={styles.ageInput}
                  autoComplete="off"
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={validationError ? 'age-validation-error' : 'age-help-text'}
                />
                <button
                  type="button"
                  className={styles.toggleVisibilityBtn}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide age input' : 'Show age input'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              {validationError ? (
                <p id="age-validation-error" className={styles.fieldError} role="alert">
                  {validationError}
                </p>
              ) : (
                <p id="age-help-text" className={styles.helpText}>
                  Policy threshold: age &ge; 18. Age must be an integer between 0 and 65,535.
                </p>
              )}
            </div>

            <button
              type="submit"
              id="btn-generate-proof"
              className={styles.submitBtn}
              disabled={isBusy || !ageInput.trim()}
              aria-busy={isBusy}
            >
              {isBusy ? (
                <>
                  <span className={styles.btnSpinner} aria-hidden="true" />
                  {veilPass.status === 'proving'
                    ? 'Generating ZK Proof…'
                    : veilPass.status === 'waiting_for_wallet'
                    ? 'Authorize in Midnight Wallet…'
                    : veilPass.status === 'submitting'
                    ? 'Submitting to Preprod…'
                    : 'Processing…'}
                </>
              ) : (
                'Generate Eligibility Proof'
              )}
            </button>
          </form>

          {veilPass.status === 'error' && veilPass.errorMessage && (
            <div className={styles.errorAlert} role="alert">
              <div className={styles.errorHeader}>
                <span className={styles.errorIcon} aria-hidden="true">⚠</span>
                <span className={styles.errorTitle}>Proof Generation Failed</span>
              </div>
              <p className={styles.errorMessage}>{veilPass.errorMessage}</p>
              <button
                type="button"
                className={styles.dismissBtn}
                onClick={actions.clearError}
              >
                Dismiss
              </button>
            </div>
          )}

          {veilPass.status === 'ineligible' && (
            <div className={styles.ineligibleAlert} role="alert">
              <div className={styles.errorHeader}>
                <span className={styles.errorIcon} aria-hidden="true">✗</span>
                <span className={styles.errorTitle}>Not Eligible</span>
              </div>
              <p className={styles.errorMessage}>
                {veilPass.errorMessage || 'Rejected locally by the eligibility circuit — no transaction was submitted.'}
              </p>
            </div>
          )}

          <ProofProgress status={veilPass.status} />
          <LedgerResult result={veilPass.result} />

          <p className={styles.disclaimer}>
            This proof uses a zero-knowledge circuit on Midnight Preprod. The circuit proves only
            that your supplied private witness meets age &ge; 18 without revealing your exact age.
          </p>
        </div>
      )}
    </section>
  );
}
