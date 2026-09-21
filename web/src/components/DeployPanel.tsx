import { useState, useCallback, useRef } from 'react';
import type { MidnightState, MidnightActions } from '../hooks/useMidnight';
import { initializeMidnightNetwork, PREPROD_CONFIG, getNetworkId } from '../providers/networkConfig';
import { createPreprodProviders } from '../providers/createPreprodProviders';
import type { DeploymentStage } from '../providers/laceWalletProvider';
import {
  type DeployPhase,
  type DeploymentAttemptRecord,
  STAGE_LABELS,
  CONTRACT_ADDRESS_REGEX,
  normalizeDeploymentError,
} from './deployUtils';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import styles from './DeployPanel.module.css';

interface DeployPanelProps {
  walletState: MidnightState;
  walletActions: MidnightActions;
}

export function DeployPanel({ walletState, walletActions }: DeployPanelProps) {
  const [phase, setPhase] = useState<DeployPhase>('idle');
  const [currentStage, setCurrentStage] = useState<DeploymentStage>('idle');
  const [failedStage, setFailedStage] = useState<DeploymentStage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [statusCheckMessage, setStatusCheckMessage] = useState<string | null>(null);

  // Safe deployment-attempt state record
  const [attemptRecord, setAttemptRecord] = useState<DeploymentAttemptRecord | null>(null);

  const isDeployingRef = useRef(false);
  const currentStageRef = useRef<DeploymentStage>('idle');
  const attemptRecordRef = useRef<DeploymentAttemptRecord | null>(null);

  const isConnected = walletState.status === 'connected';
  const isPreprod = walletState.networkId === 'preprod';
  const isDeploying = phase === 'in_progress';

  // Check if a previous transaction was submitted with confirmation status unknown
  const isSubmittedUnknownStatus = Boolean(
    attemptRecord?.txId &&
    !attemptRecord?.contractAddress &&
    (phase === 'confirmation_pending' || phase === 'error')
  );

  const updateStage = useCallback((stage: DeploymentStage, meta?: Record<string, unknown>) => {
    currentStageRef.current = stage;
    setCurrentStage(stage);

    if (attemptRecordRef.current) {
      attemptRecordRef.current.currentPhase = stage;
      setAttemptRecord({ ...attemptRecordRef.current });
    }

    if (import.meta.env?.DEV || process.env.NODE_ENV !== 'production') {
      const safeMeta: Record<string, unknown> = {};
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          if (!/hex|proof|byte|seed|phrase|pass|secret|age/i.test(k)) {
            safeMeta[k] = v;
          }
        }
      }
      console.info(`[Deploy Stage: ${stage}]`, safeMeta);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!contractAddress) return;
    try {
      await navigator.clipboard.writeText(contractAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [contractAddress]);

  const handleCheckStatus = useCallback(async () => {
    if (!attemptRecord?.txId) return;
    setIsCheckingStatus(true);
    setStatusCheckMessage(null);

    try {
      const connectedApi = walletActions.getConnectedApi();
      if (!connectedApi) {
        throw new Error('Lace wallet is not connected. Please connect your wallet first.');
      }

      const providers = await createPreprodProviders(connectedApi);
      const txData = await Promise.race([
        providers.publicDataProvider.watchForTxData(attemptRecord.txId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Transaction is still pending confirmation on Midnight Preprod.')),
            12000
          )
        ),
      ]);

      const deployedAddr = (txData as any)?.public?.contractAddress;
      if (deployedAddr && typeof deployedAddr === 'string' && CONTRACT_ADDRESS_REGEX.test(deployedAddr)) {
        setContractAddress(deployedAddr);
        setPhase('confirmed');
        setAttemptRecord((prev) =>
          prev ? { ...prev, currentPhase: 'confirmed', contractAddress: deployedAddr } : null
        );
        setStatusCheckMessage(null);
      } else {
        setStatusCheckMessage('Transaction found, but contract address is not yet indexed.');
      }
    } catch (err: unknown) {
      const norm = normalizeDeploymentError(err, 'wait_for_indexer');
      setStatusCheckMessage(norm.message);
    } finally {
      setIsCheckingStatus(false);
    }
  }, [attemptRecord, walletActions]);

  const handleDeploy = useCallback(async () => {
    // Prevent duplicate deployment if in-flight
    if (isDeployingRef.current) return;

    // Prevent another deployment attempt if previous attempt may already have been submitted but status is unknown
    if (attemptRecordRef.current?.txId && !attemptRecordRef.current?.contractAddress) {
      setErrorMessage(
        'Previous transaction may have been submitted. Verify its status before deploying again.'
      );
      setPhase('confirmation_pending');
      return;
    }

    isDeployingRef.current = true;
    setPhase('in_progress');
    setErrorMessage(null);
    setFailedStage(null);
    setContractAddress(null);
    setTxId(null);
    setCopied(false);
    setStatusCheckMessage(null);

    const newAttempt: DeploymentAttemptRecord = {
      attemptStart: Date.now(),
      currentPhase: 'initialize_network',
      txId: null,
      contractAddress: null,
      failureStage: null,
      errorCategory: null,
    };
    attemptRecordRef.current = newAttempt;
    setAttemptRecord(newAttempt);

    try {
      // Stage 1: initialize_network
      updateStage('initialize_network');
      initializeMidnightNetwork();

      const connectedApi = walletActions.getConnectedApi();
      if (!connectedApi) {
        throw new Error('Lace wallet is not connected. Please connect your wallet first.');
      }

      // Stage 2: check_proof_server
      updateStage('check_proof_server');
      try {
        await fetch(PREPROD_CONFIG.proofServer, {
          method: 'GET',
          signal: AbortSignal.timeout(4000),
        });
      } catch (err: unknown) {
        throw new Error(
          `Proof server is unreachable at ${PREPROD_CONFIG.proofServer}. Run "docker compose up -d" in the project directory, then try again.`
        );
      }

      // Stage 3: create_providers
      updateStage('create_providers');
      const baseProviders = await createPreprodProviders(connectedApi, {
        onStageChange: updateStage,
      });

      // Stage 4: import_contract
      updateStage('import_contract');
      const { Contract } = await import('../../../contracts/managed/veilpass/contract/index.js');

      // Stage 5: compile_contract
      updateStage('compile_contract');
      const activeNetworkId = getNetworkId();
      if (activeNetworkId !== 'preprod') {
        throw new Error(
          `Expected Midnight network ID "preprod" before CompiledContract.make(), but got "${activeNetworkId}".`
        );
      }

      const compiledContract = (
        CompiledContract.make('veilpass', Contract as any) as any
      ).pipe(
        (CompiledContract.withWitnesses as any)({
          privateAge: (_ctx: any) => [{}, 0n],
        }),
        (CompiledContract.withCompiledFileAssets as any)('/midnight/veilpass')
      );

      // Wrap providers to intercept submitTx and watchForTxData
      const origSubmitTx = baseProviders.midnightProvider.submitTx.bind(
        baseProviders.midnightProvider
      );
      const origWatchForTxData = baseProviders.publicDataProvider.watchForTxData.bind(
        baseProviders.publicDataProvider
      );

      const hookedMidnightProvider = {
        ...baseProviders.midnightProvider,
        async submitTx(tx: any) {
          const submittedTxId = await origSubmitTx(tx);
          if (submittedTxId && typeof submittedTxId === 'string') {
            setTxId(submittedTxId);
            if (attemptRecordRef.current) {
              attemptRecordRef.current.txId = submittedTxId;
              setAttemptRecord({ ...attemptRecordRef.current });
            }
          }
          return submittedTxId;
        },
      };

      const hookedPublicDataProvider = {
        ...baseProviders.publicDataProvider,
        async watchForTxData(txIdToWatch: string) {
          updateStage('wait_for_indexer');
          // Wrap indexer watch with a 90s timeout
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Indexer confirmation timed out. Transaction was submitted to the network, but confirmation is still pending.'
                  )
                ),
              90000
            )
          );
          return Promise.race([origWatchForTxData(txIdToWatch), timeoutPromise]);
        },
      };

      const providers = {
        ...baseProviders,
        midnightProvider: hookedMidnightProvider,
        publicDataProvider: hookedPublicDataProvider,
      };

      // Stage 6: create_unbound_transaction
      updateStage('create_unbound_transaction');

      // Stages 7-12 are handled sequentially through provider calls
      const deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateId: 'veilpassPrivateState',
        initialPrivateState: {},
      });

      // Stage 13: extract_contract_address
      updateStage('extract_contract_address');
      const deployedAddress = deployed?.deployTxData?.public?.contractAddress;
      if (
        !deployedAddress ||
        typeof deployedAddress !== 'string' ||
        !CONTRACT_ADDRESS_REGEX.test(deployedAddress)
      ) {
        throw new Error(
          `Contract deployment failed: invalid contract address returned (${String(deployedAddress)}).`
        );
      }

      // Stage 14: confirmed
      updateStage('confirmed');
      const confirmedTxId = (deployed.deployTxData as any)?.txId || attemptRecordRef.current?.txId || null;

      setContractAddress(deployedAddress);
      setTxId(confirmedTxId);
      setPhase('confirmed');

      if (attemptRecordRef.current) {
        attemptRecordRef.current.currentPhase = 'confirmed';
        attemptRecordRef.current.contractAddress = deployedAddress;
        attemptRecordRef.current.txId = confirmedTxId;
        setAttemptRecord({ ...attemptRecordRef.current });
      }
    } catch (err: unknown) {
      const stage = currentStageRef.current;
      setFailedStage(stage);

      const norm = normalizeDeploymentError(err, stage);
      const isIndexerTimeout =
        norm.message.includes('Indexer confirmation timed out') ||
        norm.message.includes('confirmation is still pending');

      if (attemptRecordRef.current) {
        attemptRecordRef.current.failureStage = stage;
        attemptRecordRef.current.errorCategory = norm.category;
        setAttemptRecord({ ...attemptRecordRef.current });
      }

      if (attemptRecordRef.current?.txId) {
        // Genuine transaction ID exists!
        if (isIndexerTimeout) {
          setPhase('confirmation_pending');
          setErrorMessage('Transaction submitted; confirmation pending');
        } else {
          setPhase('error');
          setErrorMessage(norm.message);
        }
      } else {
        setPhase('error');
        setErrorMessage(norm.message);
      }
    } finally {
      isDeployingRef.current = false;
    }
  }, [updateStage, walletActions]);

  // Visible only when Lace is connected on Preprod
  if (!isConnected || !isPreprod) {
    return null;
  }

  return (
    <section className={styles.panel} aria-label="Contract Deployment">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.badge}>Admin / Preprod</span>
          <h3 className={styles.title}>Deploy VeilPass to Preprod</h3>
        </div>
        <p className={styles.subtitle}>
          Deploy the compiled VeilPass age-gate contract to Midnight Preprod using your funded Lace wallet.
        </p>
      </div>

      {isDeploying && (
        <div className={styles.progressBox} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div className={styles.progressTextCol}>
            <span className={styles.stageNameBadge}>Stage: {currentStage}</span>
            <span className={styles.phaseText}>{STAGE_LABELS[currentStage] || currentStage}</span>
          </div>
        </div>
      )}

      {phase === 'confirmation_pending' && (
        <div className={styles.pendingBox} role="status" aria-live="polite">
          <div className={styles.pendingHeader}>
            <span className={styles.pendingIcon} aria-hidden="true">⏳</span>
            <span className={styles.pendingTitle}>Transaction submitted; confirmation pending</span>
          </div>
          <p className={styles.pendingText}>
            Previous transaction may have been submitted. Verify its status before deploying again.
          </p>
          {attemptRecord?.txId && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Transaction ID:</label>
              <code className={styles.txCode}>{attemptRecord.txId}</code>
            </div>
          )}
          {statusCheckMessage && (
            <p className={styles.statusCheckText}>{statusCheckMessage}</p>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className={styles.errorAlert} role="alert">
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <div className={styles.errorBody}>
            {failedStage && (
              <span className={styles.errorStageBadge}>Failed during: {failedStage}</span>
            )}
            <p className={styles.errorText}>
              {errorMessage ||
                `Deployment failed during ${failedStage || 'unknown'}. Open diagnostics or retry after verifying no transaction was submitted.`}
            </p>
            {isSubmittedUnknownStatus && (
              <p className={styles.submittedWarning}>
                Previous transaction may have been submitted. Verify its status before deploying again.
              </p>
            )}
            {attemptRecord?.txId && (
              <div className={styles.fieldGroup} style={{ marginTop: '0.5rem' }}>
                <label className={styles.fieldLabel}>Public Transaction ID:</label>
                <code className={styles.txCode}>{attemptRecord.txId}</code>
              </div>
            )}
            {statusCheckMessage && (
              <p className={styles.statusCheckText}>{statusCheckMessage}</p>
            )}
          </div>
        </div>
      )}

      {phase === 'confirmed' && contractAddress && (
        <div className={styles.successBox} role="region" aria-label="Deployment details">
          <div className={styles.successHeader}>
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <span className={styles.successTitle}>VeilPass Deployed on Preprod</span>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Contract Address (Preprod):</label>
            <div className={styles.addressRow}>
              <code className={styles.addressCode}>{contractAddress}</code>
              <button
                type="button"
                id="btn-copy-address"
                className={styles.copyBtn}
                onClick={handleCopy}
                aria-label="Copy contract address"
              >
                {copied ? 'Copied!' : 'Copy Address'}
              </button>
            </div>
          </div>

          {txId && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Transaction ID:</label>
              <code className={styles.txCode}>{txId}</code>
            </div>
          )}

          <p className={styles.notice}>
            Save this address into your <code>web/.env.local</code> as <code>VITE_CONTRACT_ADDRESS</code>.
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {isSubmittedUnknownStatus ? (
          <button
            type="button"
            id="btn-check-status-action"
            className={styles.deployBtn}
            onClick={handleCheckStatus}
            disabled={isCheckingStatus}
          >
            {isCheckingStatus ? 'Checking Status…' : 'Check transaction status'}
          </button>
        ) : (
          <button
            type="button"
            id="btn-deploy-contract"
            className={styles.deployBtn}
            onClick={handleDeploy}
            disabled={isDeploying}
            aria-busy={isDeploying}
          >
            {isDeploying ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Deploying…
              </>
            ) : phase === 'confirmed' ? (
              'Deploy Another Instance'
            ) : phase === 'error' ? (
              'Try Deployment Again'
            ) : (
              'Deploy VeilPass to Preprod'
            )}
          </button>
        )}
      </div>
    </section>
  );
}
