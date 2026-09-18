/**
 * Execute a real checkEligibility transaction on the local devnet
 * and read back the updated ledger state from the blockchain.
 */
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, getDeployment, getPrivateStatePassword } from '../src/network.js';
import { createWallet, persistWalletState } from '../src/wallet.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'veilpassPrivateState';

async function main() {
  const { network, config: networkConfig } = resolveNetwork();
  const deployment = getDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment on file for ${network}`);
  }

  console.log(`\nConnecting to VeilPass contract on ${network}...`);
  console.log(`Contract address (${network}): ${deployment.address}`);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'veilpass');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  const VeilPass = await import(pathToFileURL(contractPath).href);

  const walletCtx = await createWallet({
    network,
    networkConfig,
    seed: getOrCreateWallet(network).seed,
  });

  console.log('Syncing wallet...');
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  // Private age witness is passed to local prover only; never printed or logged
  const PRIVATE_AGE = 21n;
  const THRESHOLD = 18n;

  console.log(`\nSubmitting checkEligibility proof transaction:`);
  console.log(`  Public input (threshold): ${THRESHOLD}`);
  console.log(`  Private input (age):       [CONFIDENTIAL — used only in local ZK prover, never logged or broadcast]`);

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();
  const privateStatePassword = getPrivateStatePassword(network);

  const compiledContract: any = (CompiledContract.make('veilpass', VeilPass.Contract as any) as any).pipe(
    (CompiledContract.withWitnesses as any)({ privateAge: (_ctx: any) => [{}, PRIVATE_AGE] }),
    (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
  );

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: 'veilpass-private-state',
      privateStateStoreName: 'veilpass-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const deployed: any = await findDeployedContract(providers, {
    compiledContract: compiledContract as any,
    contractAddress: deployment.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });

  console.log('\nGenerating zero-knowledge proof and submitting transaction...');
  const tx = await deployed.callTx.checkEligibility(THRESHOLD);

  console.log('\n✅ Transaction confirmed on Midnight network!');
  console.log(`   Tx ID:        ${tx.public.txId}`);
  console.log(`   Block Height: ${tx.public.blockHeight}`);

  console.log('\nQuerying public ledger state from indexer...');
  const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!contractState) {
    throw new Error(`Failed to query contract state for ${deployment.address}`);
  }

  const ls = VeilPass.ledger(contractState.data);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('                VERIFIED ON-CHAIN PUBLIC STATE                ');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  policy_threshold: ${ls.policy_threshold}`);
  console.log(`  eligible:         ${ls.eligible}`);
  console.log(`  threshold_used:   ${ls.threshold_used}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('Verified by Code:');
  console.log(`- Queried public ledger fields from indexer: policy_threshold=${ls.policy_threshold}, eligible=${ls.eligible}, threshold_used=${ls.threshold_used}`);
  console.log(`- Circuit execution and return: checkEligibility(${THRESHOLD}) executed without assertion failure and returned [] (void)`);
  console.log(`- Confirmed transaction: txId=${tx.public.txId}, blockHeight=${tx.public.blockHeight}`);
  console.log(`- Meaning of global eligible Boolean: records that a successful proof occurred on this shared contract; it does NOT identify or authenticate the person viewing the state or the connected wallet.`);
  console.log(`- Confidentiality: private age was passed exclusively to the local ZK prover witness and is neither logged, broadcast, nor present in public ledger state.`);
  console.log('══════════════════════════════════════════════════════════════\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n❌ Execution failed:', err);
  process.exit(1);
});
