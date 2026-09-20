/**
 * WalletConnect component.
 * Explicit state machine: detecting -> ready -> connecting -> connected -> disconnecting -> error -> unavailable
 * Shows connection sub-phases: Opening Lace → Waiting for approval → Verifying Preprod → Connected.
 */

import type { MidnightState, MidnightActions, DiscoveredProvider } from '../hooks/useMidnight';
import styles from './WalletConnect.module.css';

interface WalletConnectProps {
  state: MidnightState;
  actions: MidnightActions;
}

const PHASE_LABELS: Record<string, string> = {
  opening:   'Opening Lace…',
  approving: 'Waiting for approval…',
  verifying: 'Verifying Preprod…',
};

// ── Provider selector ─────────────────────────────────────────────────────────

interface ProviderSelectorProps {
  providers: DiscoveredProvider[];
  onSelect: (provider: DiscoveredProvider) => void;
}

function ProviderSelector({ providers, onSelect }: ProviderSelectorProps) {
  return (
    <div className={styles.providerList} role="group" aria-label="Select wallet provider">
      <p className={styles.providerTitle}>Multiple wallets detected — choose one:</p>
      {providers.map((p) => (
        <button
          key={p.key}
          id={`btn-select-provider-${p.key.slice(0, 8)}`}
          className={styles.providerBtn}
          onClick={() => onSelect(p)}
          aria-label={`Connect using ${p.name}`}
        >
          {p.icon && (
            <img
              src={p.icon}
              alt=""
              aria-hidden="true"
              className={styles.providerIcon}
              width={24}
              height={24}
            />
          )}
          <span className={styles.providerName}>{p.name}</span>
          <span className={styles.providerRdns}>{p.rdns}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WalletConnect({ state, actions }: WalletConnectProps) {
  const {
    status,
    connectPhase,
    shortAddress,
    errorMessage,
    providers,
    selectedProvider,
  } = state;

  const isConnected     = status === 'connected';
  const isConnecting    = status === 'connecting';
  const isDisconnecting = status === 'disconnecting';
  const isDetecting     = status === 'detecting';
  const isUnavailable   = status === 'unavailable';
  const isReady         = status === 'ready';
  const showError       = status === 'error';
  const isSelecting     = (isReady || showError) && providers.length > 1;

  const providerName = selectedProvider?.name ?? 'Midnight Wallet';
  const phaseLabel   = connectPhase ? PHASE_LABELS[connectPhase] ?? 'Connecting…' : 'Connecting…';

  return (
    <div className={styles.card} role="region" aria-label="Wallet connection">
      <div className={styles.header}>
        <div className={styles.indicator} data-status={status} aria-hidden="true" />
        <span className={styles.label}>
          {isConnected
            ? `${providerName} Connected`
            : isConnecting
            ? 'Connecting Wallet…'
            : isDisconnecting
            ? 'Disconnecting…'
            : 'Connect Wallet'}
        </span>
        {isConnected && (
          <span className={styles.network} aria-label="Connected network">
            Midnight Preprod
          </span>
        )}
      </div>

      {isConnected && shortAddress && (
        <div className={styles.address} aria-label="Connected wallet address">
          <span className={styles.addressIcon} aria-hidden="true">◈</span>
          <code className={styles.addressText}>{shortAddress}</code>
        </div>
      )}

      {showError && errorMessage && (
        <div className={styles.error} role="alert">
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {isSelecting && (
        <ProviderSelector providers={providers} onSelect={actions.connectProvider} />
      )}

      <div className={styles.actions}>
        {isDetecting && (
          <button
            className={styles.connectBtn}
            disabled
            aria-busy="true"
            aria-label="Detecting wallet"
          >
            <span className={styles.spinner} aria-hidden="true" />
            Detecting wallet…
          </button>
        )}

        {isUnavailable && (
          <a
            href="https://docs.midnight.network/develop/tutorial/bboard-tutorial/wallets"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.installLink}
            aria-label="Install a Midnight-compatible wallet"
          >
            Install Midnight Wallet
          </a>
        )}

        {isConnecting && (
          <>
            <button
              id="btn-connecting-wallet"
              className={styles.connectBtn}
              disabled
              aria-busy="true"
              aria-label={phaseLabel}
            >
              <span className={styles.spinner} aria-hidden="true" />
              {phaseLabel}
            </button>
            <button
              type="button"
              id="btn-cancel-connect"
              className={styles.cancelBtn}
              onClick={actions.reset}
              aria-label="Cancel connection attempt"
              title="Resets local connection state"
            >
              Cancel
            </button>
          </>
        )}

        {isDisconnecting && (
          <button
            className={styles.disconnectBtn}
            disabled
            aria-busy="true"
            aria-label="Disconnecting wallet"
          >
            <span className={styles.spinner} aria-hidden="true" />
            Disconnecting…
          </button>
        )}

        {!isConnected && !isConnecting && !isDisconnecting && !isDetecting && !isUnavailable && (
          <>
            <button
              id="btn-connect-wallet"
              className={styles.connectBtn}
              onClick={actions.connect}
              aria-label={`Connect ${providerName} to Midnight Preprod`}
            >
              {showError ? 'Try Again' : `Connect ${selectedProvider ? selectedProvider.name : 'Wallet'}`}
            </button>
            {showError && (
              <button
                type="button"
                id="btn-reset-wallet"
                className={styles.resetBtn}
                onClick={actions.reset}
                aria-label="Reset wallet state"
              >
                Reset
              </button>
            )}
          </>
        )}

        {isConnected && (
          <button
            id="btn-disconnect-wallet"
            className={styles.disconnectBtn}
            onClick={actions.disconnect}
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        )}
      </div>

      {!isConnected && !isDetecting && !isUnavailable && (
        <div className={styles.readinessBlock}>
          {providers.length === 1 && (
            <p className={styles.hint} aria-label="Detected wallet">
              <span className={styles.dot} aria-hidden="true" />
              {providers[0].name} detected
            </p>
          )}
          <p className={styles.readinessHint} aria-label="Wallet readiness guidance">
            Open and unlock Lace, select Midnight Preprod, then connect.
          </p>
        </div>
      )}

      {isUnavailable && (
        <p className={styles.hint}>
          No compatible Midnight wallet found.{' '}
          <a
            href="https://docs.midnight.network/develop/tutorial/bboard-tutorial/wallets"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.hintLink}
          >
            Install Lace
          </a>{' '}
          then refresh this page.
        </p>
      )}
    </div>
  );
}
