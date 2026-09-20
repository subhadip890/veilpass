/**
 * useVeilPass hook — shell for the Level 2 eligibility proof flow.
 *
 * The actual circuit call (checkEligibility) is NOT implemented here yet.
 * It requires:
 *   - A funded Preprod wallet connected via Lace
 *   - VITE_CONTRACT_ADDRESS set to a real Preprod contract address
 *   - Working proof server (local Docker or remote)
 *   - midnight-js providers configured (indexer, proof-server)
 *
 * This shell surfaces the "unavailable" state to the UI so that
 * the EligibilityProof component can render its locked/placeholder view
 * without making any fake circuit calls.
 */

export type EligibilityStatus =
  | 'not_configured'   // contract address or providers not set
  | 'idle'             // wallet connected, ready to attempt
  | 'awaiting_input'   // user must supply private age witness
  | 'proving'          // local ZK proof generation in progress
  | 'submitting'       // proof submitted to network
  | 'eligible'         // on-chain state: eligible = true
  | 'ineligible'       // on-chain state: eligible = false
  | 'error';           // circuit or network error

export interface EligibilityResult {
  eligible: boolean | null;
  thresholdUsed: number | null;
  txHash: string | null;
}

export interface VeilPassState {
  status: EligibilityStatus;
  result: EligibilityResult;
  errorMessage: string | null;
}

const CONTRACT_ADDRESS = (import.meta.env as Record<string, string | undefined>)['VITE_CONTRACT_ADDRESS'];

const initial: VeilPassState = {
  status: CONTRACT_ADDRESS ? 'idle' : 'not_configured',
  result: { eligible: null, thresholdUsed: null, txHash: null },
  errorMessage: CONTRACT_ADDRESS
    ? null
    : 'VITE_CONTRACT_ADDRESS is not configured. Set it in .env.local to a real Preprod contract address.',
};

export function useVeilPass(): VeilPassState {
  // The hook is intentionally not implemented beyond the shell.
  // Returning static initial state ensures no fake proofs are generated.
  return initial;
}
