# VeilPass
> Prove eligibility, not identity.

## Contract Address

| Network | Status | Contract Address |
|---|---|---|
| **Local Devnet** (`undeployed`) | **Deployed (Local)** | `74f727d9dca0d28ef6b30953a250b061ad6da95859b0c4826b4a3fc06702a3c6` |
| **Preview** (`preview`) | **Deployed** | `2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c2` |
| **Preprod** (`preprod`) | *Pending* | *(Pending deployment)* |

## What This Does

VeilPass is a privacy-preserving eligibility verification system built on the Midnight Network. In traditional systems, proving eligibility—such as verifying that a user is over 18 or 21—requires handing over physical IDs, passports, or exact dates of birth, creating centralized databases vulnerable to leaks and identity theft.

VeilPass solves this by using zero-knowledge (ZK) proofs. A user proves locally that their private age satisfies a required threshold. The smart contract validates this mathematical proof on-chain and records eligibility without the user ever revealing their actual age, birth date, or identity to the verifier or the public blockchain.

## Privacy Model

VeilPass demonstrates zero-knowledge selective disclosure on Midnight:

### Public Ledger State (On-Chain)
- `policy_threshold`: `Uint<16>` set to `18` by the constructor. Enforces the contract's immutable minimum age requirement so no caller can lower the threshold.
- `eligible`: `Boolean` (`true` / `false`) indicating that a valid proof was recorded on this shared contract.
- `threshold_used`: `Uint<16>` recording the public threshold evaluated in the proof (must satisfy `threshold >= policy_threshold`).
- On-chain zero-knowledge proof verifying computational correctness without exposing private inputs.

### Private Witness (Client-Side Only)
- `witness privateAge(): Uint<16>`: The user's age is provided off-chain exclusively to the local zero-knowledge proof server. It **never** leaves the user's device, is never transmitted across the network, is never written to the blockchain, and is never logged in console or error outputs.

### What the Circuit Proves Without Revealing
- **Policy Enforcement**: Asserts `threshold >= policy_threshold` (18). A caller cannot bypass the policy by requesting a threshold of 0 or any sub-18 value.
- **Eligibility Compliance**: Asserts `privateAge >= threshold` without disclosing the private age value.
- **Truthful State Update**: Updates `eligible` and `threshold_used` on-chain to reflect the verified proof.
- **Selective Disclosure**: Only `disclose()` is called on the minimal boolean result and the requested threshold. The private age remains completely confidential.

### Level 1 Trust & Architectural Limitations
- **Self-Attested Age Limitation**: In this Level 1 demonstration, the private age is entered by the user. The ZK circuit proves mathematically that the provided private integer satisfies `age >= threshold`, but does not verify real-world legal identity or birth date without an accredited issuer credential (the Level 3 vision).
- **Global Eligible-State Limitation**: The on-chain `eligible` flag is shared contract-level state. It records that *a* valid proof occurred on this contract; it does **not** authenticate, identify, or certify the individual user or connected wallet viewing the state.
- **Frontend Guidance**: Frontends must never present the contract's global `eligible: true` as proof about the connected wallet, nor use shared contract state as an access-control gate. Frontends should label the state as *"Contract Ledger Status: Valid Proof Recorded On-Chain"* and only display user-specific success within the ephemeral local proof flow.

## Tech Stack

- **Midnight Network**: Privacy-first layer-1 blockchain utilizing zero-knowledge cryptography.
- **Compact**: Domain-specific smart contract language for Midnight circuits and ledger state.
- **Midnight.js**: Client SDK for contract deployment, wallet integration, and transaction submission.
- **TypeScript**: Type-safe contract interaction, testing, and CLI tooling.
- **Node.js 22**: Runtime environment for scripts, tooling, and test runners.
- **Docker & Proof Server**: Local devnet services (`midnight-node`, `indexer-standalone`, and `proof-server:8.1.0`) for local zero-knowledge proof generation and verification.

## Prerequisites

Before running VeilPass, ensure the following tools are installed:
- **Node.js**: v22+
- **Docker & Docker Compose**: v2+
- **Compact Compiler**: v0.5.2+ (installed in WSL/Linux environment, e.g., `~/.local/bin/compact`)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/subhadip890/veilpass.git
cd veilpass
npm install
```

Start the local Midnight devnet services:

```bash
docker compose up -d
docker compose ps
```

Compile the Compact smart contract:

```bash
npm run compile
```

Run automated tests:

```bash
npm test
```

Typecheck the TypeScript source and scripts:

```bash
npm run build
```

Deploy the contract to local devnet:

```bash
npm run deploy
```

Run an end-to-end smoke test against the local indexer:

```bash
npm run test:e2e
```

Launch the interactive CLI:

```bash
npm run cli
```

## Run Tests

Execute the automated contract test suite:

```bash
npm test
```

The test suite runs against the compiled Compact JavaScript bytecode using `@midnight-ntwrk/compact-runtime` and covers 8 test cases:
1. **Contract Initialization**: Constructor sets `policy_threshold = 18`, `eligible = false`, and `threshold_used = 0`.
2. **Eligible Input**: `age = 25 >= threshold = 18` sets `eligible = true`, `threshold_used = 18`, and `policy_threshold = 18`.
3. **Ineligible Input**: `age = 16 < threshold = 18` triggers circuit assertion failure (`age is below threshold`).
4. **Policy Enforcement (Zero Threshold)**: Caller passing `threshold = 0` is strictly rejected (`threshold cannot be below policy threshold (18)`).
5. **Policy Enforcement (Sub-18 Threshold)**: Underage caller (`age = 17`) attempting to bypass the gate with `threshold = 17` is strictly rejected.
6. **Boundary Condition**: `age === threshold === policy_threshold` (all 18) evaluates as eligible (`eligible = true`).
7. **Configurable Threshold**: Caller proving 21+ (`age = 22 >= threshold = 21 >= policy 18`) succeeds with `threshold_used = 21`.
8. **Privacy Inspection**: Verifies that the private age witness value (`42n`) does not appear in any public ledger field or circuit return value.

## Initial Idea

VeilPass is envisioned as a universal, privacy-preserving age and eligibility gate for modern web applications, restricted online services, age-gated commerce, and decentralized communities. Rather than forcing users to upload sensitive identity documents, scans of passports, or credit cards to prove adulthood, VeilPass allows users to generate zero-knowledge proofs client-side that confirm they satisfy the required age or credential threshold without revealing any personal details. As the project evolves toward Level 3, VeilPass will integrate with decentralized identity (DID) standards and Verifiable Credentials, enabling seamless, privacy-preserving compliance for platforms while eliminating liability and centralized identity honeypots.

## Screenshots

### Successful Compact Compilation

![VeilPass Compact compilation showing the checkEligibility circuit](docs/screenshots/compile-success.png)

### Successful Preview Deployment

![VeilPass deployed successfully to Midnight Preview](docs/screenshots/preview-deployment.png)

## Security

- **Never Commit Secrets**: Wallet recovery phrases, private seeds, mnemonics, `.midnight-state.json`, and `.midnight-wallet-state/` are strictly gitignored and must never be committed to source control.
- **Private State Encryption**: LevelDB private state is stored in `veilpass-private-state/` (gitignored). On public networks (`preview`/`preprod`), a user-supplied `PRIVATE_STATE_PASSWORD` environment variable (minimum 16 characters) is strictly required and is never logged or printed.
- **Genesis Seed Restriction**: The hardcoded genesis seed in development scripts is restricted exclusively to local devnet (`undeployed`) and must never be used on testnets or mainnet.
