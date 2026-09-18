/**
 * CLI for interacting with VeilPass contract.
 *
 * The privateAge witness is implemented here. The age is collected from the user
 * interactively and used only inside the ZK proof — it is never written to the ledger.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment, getPrivateStatePassword } from './network.js';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'veilpassPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'veilpass');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const VeilPass = await import(pathToFileURL(contractPath).href);

// ─── Providers + compiled contract with wired witness ────────────────────────

async function createProviders(walletCtx: WalletContext, getAge: () => bigint) {
  const privateStatePassword = getPrivateStatePassword(network);

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

  // Wire the witness. privateAge() returns [newPrivateState, ageValue].
  // Private state for this contract is empty ({}) — the witness supplies only
  // a transient value and nothing is persisted between calls.
  const compiledContract: any = (CompiledContract.make('veilpass', VeilPass.Contract as any) as any).pipe(
    (CompiledContract.withWitnesses as any)({ privateAge: (_ctx: any) => [{}, getAge()] }),
    (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
  );

  return {
    compiledContract,
    providers: {
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
    },
  };
}

// ─── Main CLI ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  VeilPass CLI                               ║');
  console.log('║        Age / Eligibility Gate (Level 1 Demo)                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup\` first.`);
    process.exit(1);
  }
  console.log(`  Contract (${network}): ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });

    console.log('  Syncing with network...');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    // Age closure — updated before each tx by menu handler.
    let currentAge = 0n;

    console.log('  Connecting to contract...');
    const { compiledContract, providers } = await createProviders(walletCtx, () => currentAge);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
    console.log('  ✅ Connected!\n');

    let running = true;
    while (running) {
      console.log('─── Menu ────────────────────────────────────────────────────────');
      console.log('  1. Check eligibility (private age, public threshold)');
      console.log('  2. Read current public ledger state');
      console.log('  3. Check wallet balance');
      console.log('  4. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const ageStr = await rl.question('  Enter your age (stays private, never stored on-chain): ');
          const thresholdStr = await rl.question('  Enter the minimum age threshold (will be public): ');
          const age = parseInt(ageStr.trim(), 10);
          const threshold = parseInt(thresholdStr.trim(), 10);
          if (isNaN(age) || age < 0 || age > 65535 || isNaN(threshold) || threshold < 0 || threshold > 65535) {
            console.log('\n  ❌ Please enter whole numbers between 0 and 65535.\n');
            break;
          }
          currentAge = BigInt(age);
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          console.log('  ℹ  Your age is used only inside the ZK proof and never sent to the ledger.\n');
          try {
            const tx = await deployed.callTx.checkEligibility(BigInt(threshold));
            console.log(`\n  ✅ Transaction confirmed.`);
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height:   ${tx.public.blockHeight}`);
            console.log(`\n  Shared Contract Public Ledger State:`);
            console.log(`    policy_threshold: 18`);
            console.log(`    eligible:         true  (records that a valid proof was executed on this contract)`);
            console.log(`    threshold_used:   ${threshold}`);
            console.log(`\n  ℹ️  Meaning of Shared State:`);
            console.log(`    - 'eligible: true' records that an eligibility proof occurred on this shared contract.`);
            console.log(`    - It does NOT identify, authenticate, or bind eligibility to the viewer or connected wallet.`);
            console.log(`    - What an observer learns: a proof was verified for threshold >= ${threshold}.`);
            console.log(`    - What an observer does NOT learn: the private age value.\n`);
          } catch (error: any) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('threshold cannot be below policy threshold')) {
              console.log(`\n  ❌ Proof rejected: requested threshold (${threshold}) is below the contract policy minimum (18).\n`);
            } else if (msg.includes('age is below threshold') || msg.includes('assert')) {
              console.log(`\n  ❌ Proof rejected: entered age does not meet the required threshold (${threshold}).`);
              console.log('     The transaction was not submitted — the circuit assertion failed.\n');
            } else {
              console.error('\n  ❌ Failed:', msg, '\n');
            }
          }
          break;
        }

        case '2': {
          console.log('\n  Reading ledger state from blockchain...');
          try {
            const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
            if (contractState) {
              const ls = VeilPass.ledger(contractState.data);
              console.log(`\n  📋 Shared Contract Public Ledger State:`);
              console.log(`     policy_threshold: ${ls.policy_threshold}`);
              console.log(`     eligible:         ${ls.eligible}`);
              console.log(`     threshold_used:   ${ls.threshold_used}\n`);
              console.log('  ℹ️  Meaning of Shared State:');
              console.log(`     - 'eligible: ${ls.eligible}' records that a successful proof occurred on this shared contract.`);
              console.log('     - It does NOT identify, authenticate, or bind eligibility to the viewer or connected wallet.');
              console.log('     - The global Boolean is shared on-chain state, not a personal credential or wallet status.\n');
            } else {
              console.log('\n  📋 No state found (contract not yet called)\n');
            }
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          const s = await walletCtx.wallet.waitForSyncedState();
          const b = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const d = s.dust.balance(new Date());
          console.log(`\n  tNight: ${b.toLocaleString()}`);
          console.log(`  DUST: ${d.toLocaleString()}\n`);
          break;
        }

        case '4':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-4.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
