import { WalletConnect } from './components/WalletConnect';
import { EligibilityProof } from './components/EligibilityProof';
import { useMidnight } from './hooks/useMidnight';
import { useVeilPass } from './hooks/useVeilPass';
import styles from './App.module.css';

export default function App() {
  const [walletState, walletActions] = useMidnight();
  const veilPass = useVeilPass();

  return (
    <div className={styles.root}>
      {/* Background layers */}
      <div className={styles.bgGlow} aria-hidden="true" />
      <div className={styles.bgGrid} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.logo} aria-label="VeilPass">
          <span className={styles.logoIcon} aria-hidden="true">◈</span>
          <span className={styles.logoText}>VeilPass</span>
        </div>
        <p className={styles.tagline}>Prove eligibility, not identity.</p>
      </header>

      <main className={styles.main} id="main-content">
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>
            Zero-Knowledge{' '}
            <span className={styles.heroAccent}>Age Gate</span>
          </h1>
          <p className={styles.heroDesc}>
            VeilPass proves you meet the eligibility threshold using a ZK circuit on the Midnight Network.
            Your exact age is never disclosed to the blockchain.
          </p>

          <div className={styles.networkBadge} aria-label="Target network">
            <span className={styles.dot} aria-hidden="true" />
            Midnight Preprod
          </div>
        </div>

        <div className={styles.cards}>
          <WalletConnect state={walletState} actions={walletActions} />
          <EligibilityProof walletState={walletState} veilPass={veilPass} />
        </div>

        <section className={styles.infoRow} aria-label="How it works">
          <div className={styles.infoCard}>
            <div className={styles.infoIcon} aria-hidden="true">⬡</div>
            <h3 className={styles.infoTitle}>Private Witness</h3>
            <p className={styles.infoText}>
              Your age stays on your device. Only a ZK proof reaches the ledger.
            </p>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoIcon} aria-hidden="true">◈</div>
            <h3 className={styles.infoTitle}>On-Chain Result</h3>
            <p className={styles.infoText}>
              The circuit writes only <code>eligible = true/false</code> and the threshold used.
            </p>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoIcon} aria-hidden="true">✦</div>
            <h3 className={styles.infoTitle}>Selective Disclosure</h3>
            <p className={styles.infoText}>
              <code>disclose()</code> is used only on the minimum public outputs. Age is never disclosed.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          Built on{' '}
          <a
            href="https://midnight.network"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerLink}
          >
            Midnight Network
          </a>{' '}
          &middot; Rise In Midnight Builder Challenge &middot; Level 2
        </p>
        <p className={styles.footerNote}>
          Level 1 limitation: age is self-attested. No identity is verified.
        </p>
      </footer>
    </div>
  );
}
