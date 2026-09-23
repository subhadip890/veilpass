# VeilPass — Level 2 Submission Package

## Project Overview

**VeilPass** is a privacy-first eligibility verification platform built on the Midnight Network that allows users to prove compliance with policy thresholds—such as verifying adulthood (age &ge; 18)—without ever revealing their date of birth, exact age, or real-world identity. By combining Compact smart contracts with client-side zero-knowledge proof generation and Midnight-compatible wallet authorization, VeilPass demonstrates how modern web applications can replace intrusive identity document uploads with cryptographic, tamper-proof assertions.

---

## Canonical Deployment & Repository Reference

| Attribute | Verified Canonical Record |
|---|---|
| **Project Name** | VeilPass |
| **Live Application URL** | [https://veilpass-ashy.vercel.app/](https://veilpass-ashy.vercel.app/) |
| **GitHub Repository** | [https://github.com/subhadip890/veilpass.git](https://github.com/subhadip890/veilpass.git) |
| **Target Network** | Midnight Preprod |
| **Canonical Contract Address** | `ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2` |
| **Deployment Transaction ID** | `000c72b3c6c4a08870cf57e9f5eccda3751ac5bd4ef7503ff357aadf724c5f17a9` |
| **Eligibility Proof Transaction ID** | `007ef8790fd8729f3214c9c575e9fb5e2b7c6a07195d6771d504dae9aea53359da` |
| **Implementation Commit** | `9a34001` |

---

## Implemented Level 2 Features

1. **Midnight Preprod Wallet Integration**:
   - Automated discovery of installed Midnight-compatible browser wallets (e.g. Lace on Preprod).
   - Dynamic provider state tracking (ready, connecting, connected, disconnecting, unavailable).
   - Safe Remote API proxy management via React refs (preventing stale channel locks).
   - Display of shortened wallet address and Preprod network badge.

2. **Real Contract Joining & Interaction**:
   - Dynamic loading and execution using `@midnight-ntwrk/midnight-js-contracts` v4.1.1.
   - Genuine `findDeployedContract` binding to canonical contract `ffcaf903...`.
   - Invocation of `callTx.checkEligibility(18n)` against the immutable on-chain policy threshold.
   - Zero synthetic simulation: all proof outputs originate from the genuine prover and indexer.

3. **Ephemeral Zero-Knowledge Proving**:
   - Private age witness closure created via `CompiledContract.make(...).pipe(withWitnesses(...))`.
   - Local Docker proof server integration (`proof-server:8.1.0`) at `http://localhost:6300`.
   - Real-time progression tracking (`proving` &rarr; `authorizing in wallet` &rarr; `submitting` &rarr; `confirmed`).

4. **Zero-Knowledge Privacy Lifecycle**:
   - Ephemeral memory only: private input is never stored in `localStorage`, `sessionStorage`, cookies, query parameters, or console logs.
   - Form input is wiped immediately upon submission.
   - Witness ref is strictly cleared in `finally` and unmount cleanup.
   - Only minimal public disclosures are written to the ledger: `eligible: true`, `threshold_used: 18`, `policy_threshold: 18`.

5. **Local Underage Rejection Without Network Waste**:
   - If age < 18 is entered, the Compact circuit assertion rejects locally before transaction creation.
   - **No transaction is submitted to Preprod**, and zero fees are expended.
   - Clear UI notice: *"Rejected locally by the eligibility circuit — no transaction was submitted."*
   - Strictly zero synthetic ledger data (`thresholdUsed: null`, `policyThreshold: null`, `txHash: null`).

6. **Hardened Error Sanitization**:
   - Strict allowlist mapping for known error conditions (user rejection, prover offline, channel locked, timeout, contract not found).
   - Fallback protection: unknown errors return a generic message to prevent leaking stack traces, internal circuit numbers, or sensitive witness fragments.

---

## Trust Boundaries & Known Limitations

- **Self-Attested Age**: In this Level 2 implementation, the private age is entered by the user. The ZK circuit proves mathematically that the supplied private integer satisfies `age >= threshold >= 18`; it does not verify legal birth dates or government-issued credentials without an accredited issuer (the Level 3 DID roadmap).
- **Shared Contract State**: The `eligible` field in the public ledger records that a valid proof was confirmed on this shared contract. It is not a soulbound token or per-user identity record.
- **Local Proof Server Requirement**: Because private witness data must never leave the user's custody, proof generation requires a local proof server running on the user's machine at `http://localhost:6300`.

---

## Build & Test Verification Commands

The repository contains an automated verification suite across both smart contracts and frontend:

```bash
# 1. Typecheck TypeScript
npm run build

# 2. Run Compact smart contract test suite (8 tests)
npm test

# 3. Build web production bundle (Vite + WASM)
npm run build:web

# 4. Run web test suite (8 test suites, 77 tests)
npm run test:web

# 5. Run ESLint (0 errors, 0 warnings)
npm run lint

# 6. Verify Git tree formatting and consistency
git diff --check
```

---

## Evidence Checklist

| Evidence Item | Location | Status |
|---|---|---|
| Compact smart contract source | `contracts/veilpass.compact` | ✅ Committed |
| Preprod deployment record | `README.md`, `docs/LEVEL_2_SUBMISSION.md` | ✅ Committed |
| Real contract integration hook | `web/src/hooks/useVeilPass.ts` | ✅ Committed |
| Interactive verification UI | `web/src/components/EligibilityProof.tsx` | ✅ Committed |
| Comprehensive test suite | `scripts/test.ts`, `web/src/test/*` (85 total tests) | ✅ Passing |
| Live Vercel deployment | [https://veilpass-ashy.vercel.app/](https://veilpass-ashy.vercel.app/) | ✅ Live |
| Screenshot evidence package | `docs/screenshots/` | ✅ Present in `docs/screenshots/` (see [`docs/LEVEL_2_EVIDENCE_CHECKLIST.md`](LEVEL_2_EVIDENCE_CHECKLIST.md)) |
