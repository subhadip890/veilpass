# VeilPass

**Rise In Midnight Builder Challenge — Level 1: VeilPass (Age / Eligibility Gate)**

VeilPass is a privacy-preserving smart contract built on the **Midnight Network**. It enables users to prove eligibility (such as meeting an age threshold of 18+ or 21+) using zero-knowledge proofs without exposing their actual age, birth date, or identity on the public ledger.

---

## The Concept & Privacy Model

In traditional online age-gating systems, users are forced to overshare personal identifying information (IDs, driver's licenses, credit cards, or exact dates of birth). This creates centralized honeypots of sensitive identity data.

VeilPass demonstrates zero-knowledge selective disclosure on Midnight:

### What is Public (On-Chain Ledger State)
- `policy_threshold`: Uint<16> initialized to 18 by the contract constructor. Enforces the contract's immutable minimum age requirement.
- `eligible`: Boolean (`true` / `false`) indicating that a valid proof was executed on this shared contract.
- `threshold_used`: Uint<16> recording the threshold tested in the proof (must satisfy `threshold >= policy_threshold`).
- The ZK proof itself, attesting to computational correctness on-chain.

### What is Private (Client-Side Witness)
- `age`: Uint<16> witness passed only to the local prover off-chain. It **never** leaves the caller's machine, is never sent to the network or ledger, and is never logged in error messages.

### What the Circuit Proves
- **Policy Enforcement**: `threshold >= policy_threshold`. A caller requesting proof cannot lower the threshold to zero or any value below 18.
- **Eligibility Compliance**: The caller possesses a private integer `age` such that `age >= threshold`.
- **Truthful State Update**: The `eligible` status and `threshold_used` fields are updated truthfully according to this verified proof.
- **Selective Disclosure**: `disclose()` is used deliberately and exclusively on the minimum outputs (`isEligible` and `threshold`) needed for on-chain state updates.

---

## Important Trust & Architectural Limitations

### 1. Self-Entered Age Trust Boundary
> **Trust Caveat:**
> In this Level 1 demonstration, the private age is self-entered by the user. The zero-knowledge circuit proves only that **the supplied private value meets or exceeds the required threshold**. It does **not** cryptographically prove a person's real-world identity, legal birth date, or physical age without a credential issued by an accredited authority.
>
> In the Level 3 vision, VeilPass will extend this foundation to consume Verifiable Credentials / Decentralized Identifiers (DIDs) signed by trusted identity issuers.

### 2. Global State Limitation (Shared Ledger State)
> **Global State Boundary:**
> In this Level 1 contract, `eligible: Boolean` is a **shared global ledger variable** on the contract. It records that a valid proof was executed on-chain.
>
> **Crucial distinction:** It does **NOT** authenticate, identify, or certify the individual user or connected wallet viewing the state. Any frontend or dApp integrating this contract must never present `eligible: true` as proof about the currently connected viewer. Level 2 and Level 3 designs introduce per-user nullifiers, commitments, and session-bound tokens.

### 3. Guidance for Future Frontend Implementations
When building a web frontend or dApp for VeilPass:
- **Never present the global `eligible` Boolean as the connected wallet's status**: Querying `eligible: true` from the shared contract indicates only that someone successfully ran a valid proof on this contract instance; it does NOT mean the user who connected their wallet is verified.
- **Do not gate application access purely on shared contract state**: Reading the public ledger state cannot authenticate the current user. Access gates require session-bound signatures or nullifier-backed commitments.
- **Level 1 UI Presentation**: Frontends should explicitly label the value as *"Contract Ledger Status: Valid Proof Recorded On-Chain"*, and only show user-specific success within the ephemeral local proof generation flow.

---

## Contract Deployments

| Network | Status | Contract Address |
|---|---|---|
| **Local Devnet** (`undeployed`) | **Deployed (Local)** | `74f727d9dca0d28ef6b30953a250b061ad6da95859b0c4826b4a3fc06702a3c6` |
| **Preprod** (`preprod`) | *Pending* | *(Pending deployment)* |
| **Preview** (`preview`) | *Pending* | *(Pending deployment)* |

---

## Fresh Clone & Setup Instructions

### Prerequisites
- **Node.js**: v22+
- **Docker & Docker Compose**: v2+
- **Compact Compiler**: v0.5.2+ installed in WSL/Linux environment (e.g. `~/.local/bin/compact`)

### Step-by-Step Commands for a Fresh Clone

```bash
# 1. Clone repository and install dependencies
git clone <repo-url> veilpass
cd veilpass
npm install

# 2. Start local Midnight devnet services (node, indexer, proof-server)
docker compose up -d

# 3. Verify services are healthy
docker compose ps

# 4. Compile the Compact smart contract
npm run compile

# 5. Run the automated contract unit test suite
npm test

# 6. Typecheck source and test scripts
npm run build

# 7. Deploy to local devnet
npm run deploy

# 8. Run an end-to-end smoke test
npm run test:e2e

# 9. Launch interactive CLI
npm run cli
```

---

## Automated Test Coverage

Run the unit test suite:
```bash
npm test
```

The test suite runs against the compiled Compact JavaScript bytecode using `@midnight-ntwrk/compact-runtime` and covers 8 test cases:
1. **Contract Initialization**: Constructor sets `policy_threshold = 18`, `eligible = false`, `threshold_used = 0`.
2. **Eligible Input**: `age = 25 >= threshold = 18` sets `eligible = true` and `threshold_used = 18`.
3. **Ineligible Input**: `age = 16 < threshold = 18` triggers circuit assertion failure (`age is below threshold`).
4. **Policy Enforcement (Zero Threshold)**: Caller passing `threshold = 0` is strictly rejected (`threshold cannot be below policy threshold (18)`).
5. **Policy Enforcement (Sub-18 Threshold)**: Underage caller (age 17) attempting to pass `threshold = 17` is strictly rejected.
6. **Boundary Condition**: `age === threshold === policy_threshold` (all 18) evaluates as eligible.
7. **Configurable Threshold**: Caller proving 21+ (`age = 22 >= threshold = 21 >= policy 18`) succeeds with `threshold_used = 21`.
8. **Privacy Inspection**: Verifies that the private age witness value (`42n`) does not appear in any public ledger field or circuit return value.

---

## Private State Password Handling

LevelDB private state storage requires an encryption password:
- **Local Devnet (`undeployed`)**: Defaults to a development placeholder (`Local-Devnet-Development-Placeholder-1`) for zero-config local testing.
- **Public Networks (`preview` / `preprod`)**: A user-supplied `PRIVATE_STATE_PASSWORD` environment variable is strictly required (minimum 16 characters). Scripts will abort with an error if it is missing, and the password is never logged or printed:
  ```bash
  export PRIVATE_STATE_PASSWORD="YourSecurePassword123!"
  npm run deploy -- --network preview
  ```

---

## Security & Privacy Practices

- **Never Commit Secrets**: Wallet seeds, recovery mnemonics, private keys, `.midnight-state.json`, and `.midnight-wallet-state/` are strictly gitignored and must never be committed to source control.
- **Local Private Databases**: LevelDB private state is stored in `veilpass-private-state/` (gitignored by `*-state/`), ensuring no database binaries are tracked by Git.
- **Genesis Seed Restriction**: The hardcoded genesis seed is strictly restricted to local devnet (`undeployed`) and must never be used on testnets or mainnet.
