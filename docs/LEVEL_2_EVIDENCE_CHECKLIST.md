# VeilPass Level 2 Evidence Capture Checklist

This document details the manual screenshot evidence required for the VeilPass Level 2 submission, along with step-by-step instructions for capturing each asset safely without leaking sensitive information.

---

## 🔒 Security & Privacy Warning

When capturing screenshots, ensure you:
- **Never reveal recovery phrases or seed phrases** (24-word or 12-word mnemonic).
- **Never reveal private keys or passwords**.
- **Hide full wallet balances** if unnecessary.
- **Keep private age input masked**: Ensure the password toggle is hidden (`••••`) or obscure the entered age.
- **Use Midnight Preprod only**: Verify that your wallet is on the Preprod network.

---

## Required Screenshots Summary

Save all screenshots into `docs/screenshots/` using the exact filenames listed below:

| Target Filename | Description | Key Elements to Display | Status |
|---|---|---|---|
| `live-application.png` | Live DApp loaded in browser | URL bar showing `https://veilpass-ashy.vercel.app/`, VeilPass header, status badge | ✅ Present in `docs/screenshots/` |
| `wallet-connected.png` | Midnight wallet connected | Connected wallet address (shortened), Preprod badge, active input form | ✅ Present in `docs/screenshots/` |
| `eligibility-verified.png` | Successful eligibility proof | `Verified` badge, `Eligible` verdict, `Threshold verified: age >= 18`, genuine Preprod Tx ID | ✅ Present in `docs/screenshots/` |
| `underage-rejected.png` | Local circuit rejection | `Not Eligible` verdict, *"Rejected locally by the eligibility circuit — no transaction was submitted."* | ✅ Present in `docs/screenshots/` |
| `preprod-deployment.png` | Preprod contract deployment | Canonical address `ffcaf903...`, deployment Tx ID `000c72b3...` | ✅ Present in `docs/screenshots/` |

---

## Step-by-Step Capture Instructions

### 1. `live-application.png` (Live DApp Overview)
1. Open your browser and navigate to [https://veilpass-ashy.vercel.app/](https://veilpass-ashy.vercel.app/).
2. Capture the full browser window showing the browser address bar with `https://veilpass-ashy.vercel.app/`.
3. Verify that the initial locked or idle state is clearly visible.
4. Save the screenshot to `docs/screenshots/live-application.png`.

---

### 2. `wallet-connected.png` (Wallet Connected on Preprod)
1. Ensure your Lace / Midnight-compatible wallet extension is unlocked and configured to **Midnight Preprod**.
2. Click **Connect Wallet** in the top navigation bar.
3. Once connected, confirm:
   - The shortened wallet address appears in the header (e.g. `0x...`).
   - The green `Preprod` network badge is visible.
   - The "Check Eligibility" card unlocks, displaying the private age input field.
4. Capture the browser window and save to `docs/screenshots/wallet-connected.png`.

---

### 3. `eligibility-verified.png` (Genuine Verified On-Chain Result)
1. Ensure your local proof server is running:
   ```bash
   npm run proof-server:start
   ```
2. Enter an eligible age (e.g. `21` or `25`) into the private age input field. Keep the password mask enabled (`Show` toggle unchecked).
3. Click **Generate Eligibility Proof**.
4. Authorize the transaction in your Midnight wallet when prompted.
5. Wait for the transaction to finalize and confirm on Preprod.
6. The UI must show:
   - Green `Verified` badge in the header.
   - `Eligible` verdict with the `✦` icon.
   - `Threshold verified: age >= 18 (Policy minimum: 18)`.
   - Genuine Preprod `Tx ID: <transaction-id>`.
   - Privacy banner: *"Only the verification result is on-chain. Your exact age was never disclosed."*
7. Capture the screen and save to `docs/screenshots/eligibility-verified.png`.
8. Copy the full genuine transaction ID to update the submission documentation.

---

### 4. `underage-rejected.png` (Local Circuit Rejection)
1. Enter an underage value (e.g. `16`) into the private age input field.
2. Click **Generate Eligibility Proof**.
3. The local Compact circuit will reject the input before transaction submission.
4. The UI must show:
   - Red `Not Eligible` badge in the header.
   - `Rejected Locally` verdict with the `✗` icon.
   - Explicit confirmation message:
     > *"Rejected locally by the eligibility circuit — no transaction was submitted."*
   - Privacy notice confirming that private input never left the device.
   - **No transaction ID** and no on-chain ledger state.
5. Capture the screen and save to `docs/screenshots/underage-rejected.png`.

---

### 5. `preprod-deployment.png` (Canonical Deployment Record)
1. If you have the terminal output or explorer view of the canonical contract deployment:
   - Contract Address: `ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2`
   - Transaction ID: `000c72b3c6c4a08870cf57e9f5eccda3751ac5bd4ef7503ff357aadf724c5f17a9`
2. Capture the record showing this transaction ID and contract address.
3. Save to `docs/screenshots/preprod-deployment.png`.

---

## Verifying Captured Files

After capturing the screenshots, verify they are in place and non-empty:
```bash
ls -lh docs/screenshots/
```

Expected files:
```
docs/screenshots/compile-success.png
docs/screenshots/preview-deployment.png
docs/screenshots/preprod-deployment.png
docs/screenshots/wallet-connected.png
docs/screenshots/eligibility-verified.png
docs/screenshots/underage-rejected.png
docs/screenshots/live-application.png
```
