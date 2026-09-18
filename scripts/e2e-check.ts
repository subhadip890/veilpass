/**
 * End-to-end smoke check for VeilPass.
 *
 * Reconnects to the deployed contract and reads its ledger state.
 * Exits 0 on success, non-zero on any error. All errors are surfaced —
 * no swallowed failures.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment, getPrivateStatePassword } from '../src/network.js';
import { createWallet, persistWalletState } from '../src/wallet.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// Catch any unhandled rejection or background fiber error so it never silently prints while reporting success
process.on('unhandledRejection', (reason) => {
  console.error('❌ e2e-check failed due to unhandled rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('❌ e2e-check failed due to uncaught exception:', err);
  process.exit(1);
});

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'veilpassPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) fail(`No deploy on file for network ${network}.`);
  if (!isHexAddress(deployment!.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Load compiled contract
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'veilpass');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');

  const VeilPass = await import(pathToFileURL(contractPath).href);

  // Witnesses for contract instance construction (read-only check).
  const compiledContract: any = (CompiledContract.make('veilpass', VeilPass.Contract as any) as any).pipe(
    (CompiledContract.withWitnesses as any)({
      privateAge: (_ctx: any) => [{}, 0n],
    }),
    (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
  );

  // 3. Build wallet and sync
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });

  try {
    await walletCtx.wallet.waitForSyncedState();
  } catch (err: any) {
    await walletCtx.wallet.stop().catch(() => {});
    fail(`Wallet sync failed: ${err instanceof Error ? err.message : err}`);
  }

  await persistWalletState(network, walletCtx);

  // 4. Build providers
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx() { throw new Error('e2e-check is read-only — no tx balancing'); },
    submitTx() { throw new Error('e2e-check is read-only — no tx submission'); },
  } as any;

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: 'veilpass-private-state',
      privateStateStoreName: 'veilpass-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => getPrivateStatePassword(network),
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // 5. Reconnect to deployed contract (proves address + verifier keys are valid)
  try {
    await findDeployedContract(providers, {
      contractAddress: deployment!.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
  } catch (err: any) {
    await walletCtx.wallet.stop().catch(() => {});
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 6. Read on-chain state via the public data provider
  let onChainState: any;
  try {
    onChainState = await providers.publicDataProvider.queryContractState(deployment!.address);
  } catch (err: any) {
    await walletCtx.wallet.stop().catch(() => {});
    fail(`queryContractState threw: ${err?.message ?? err}`);
  }

  if (!onChainState) {
    await walletCtx.wallet.stop().catch(() => {});
    fail(`queryContractState returned null for ${deployment!.address}`);
  }

  // 7. Decode and print ledger state
  const ls = VeilPass.ledger(onChainState.data);
  console.log(`✅ e2e-check passed`);
  console.log(`   contractAddress: ${deployment!.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   eligible:        ${ls.eligible}`);
  console.log(`   threshold_used:  ${ls.threshold_used}`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Unhandled error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
