import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EligibilityProof } from '../components/EligibilityProof';
import type { VeilPassState, VeilPassActions } from '../hooks/useVeilPass';
import type { MidnightState } from '../hooks/useMidnight';

const mockWalletStateConnected: MidnightState = {
  status: 'connected',
  connectPhase: null,
  providers: [{ key: 'mnLace', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' }],
  selectedProvider: { key: 'mnLace', rdns: 'io.lace.midnight', name: 'Lace', apiVersion: '4.0.1' },
  shortAddress: '0x1234...cdef',
  fullAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  networkId: 'preprod',
  errorKind: null,
  errorMessage: null,
};

const mockWalletStateDisconnected: MidnightState = {
  status: 'ready',
  connectPhase: null,
  providers: [],
  selectedProvider: null,
  shortAddress: null,
  fullAddress: null,
  networkId: null,
  errorKind: null,
  errorMessage: null,
};

const mockVeilPassIdle: VeilPassState = {
  status: 'idle',
  result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
  errorMessage: null,
  contractAddress: 'ffcaf903776ee108e1b5b891b5945d6dd3bc11ae9e557ba137c8f04fedafcba2',
};

const mockVeilPassNotConfigured: VeilPassState = {
  status: 'not_configured',
  result: { eligible: null, thresholdUsed: null, policyThreshold: null, txHash: null },
  errorMessage: 'VITE_CONTRACT_ADDRESS is not configured.',
  contractAddress: null,
};

describe('EligibilityProof Component', () => {
  let mockActions: VeilPassActions;

  beforeEach(() => {
    mockActions = {
      proveEligibility: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      clearError: vi.fn(),
    };
  });

  it('1. Renders locked state when wallet is disconnected or contract is not configured', () => {
    const { rerender } = render(
      <EligibilityProof
        walletState={mockWalletStateDisconnected}
        veilPass={mockVeilPassIdle}
        actions={mockActions}
      />
    );

    expect(screen.getByText(/Eligibility Proof Locked/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Private Age Witness/i)).not.toBeInTheDocument();

    // Rerender with wallet connected but contract not configured
    rerender(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassNotConfigured}
        actions={mockActions}
      />
    );

    expect(screen.getByText(/Eligibility Proof Locked/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Private Age Witness/i)).not.toBeInTheDocument();
  });

  it('2. Renders active form when wallet is connected and contract is configured', () => {
    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassIdle}
        actions={mockActions}
      />
    );

    expect(screen.queryByText(/Eligibility Proof Locked/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Private Age Witness/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Eligibility Proof/i })).toBeInTheDocument();
  });

  it('3. Toggles age password mask between password and number type', () => {
    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassIdle}
        actions={mockActions}
      />
    );

    const input = screen.getByLabelText(/Private Age Witness/i);
    const toggleBtn = screen.getByRole('button', { name: /Show age input/i });

    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(toggleBtn);
    expect(input).toHaveAttribute('type', 'number');
    expect(screen.getByRole('button', { name: /Hide age input/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide age input/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('4. Validates age range (0..65535, integer only) and prevents invalid submission', async () => {
    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassIdle}
        actions={mockActions}
      />
    );

    const input = screen.getByLabelText(/Private Age Witness/i);
    const submitBtn = screen.getByRole('button', { name: /Generate Eligibility Proof/i });

    // 4a. Negative age
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.click(submitBtn);

    expect(mockActions.proveEligibility).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Age must be a whole number between 0 and 65,535/i);

    // 4b. Out of 16-bit range
    fireEvent.change(input, { target: { value: '70000' } });
    fireEvent.click(submitBtn);

    expect(mockActions.proveEligibility).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Age must be a whole number between 0 and 65,535/i);

    // 4c. Decimal number
    fireEvent.change(input, { target: { value: '21.5' } });
    fireEvent.click(submitBtn);

    expect(mockActions.proveEligibility).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Age must be a whole number between 0 and 65,535/i);
  });

  it('5. Successfully submits valid age, calls proveEligibility, and wipes input value', async () => {
    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassIdle}
        actions={mockActions}
      />
    );

    const input = screen.getByLabelText(/Private Age Witness/i);
    const submitBtn = screen.getByRole('button', { name: /Generate Eligibility Proof/i });

    fireEvent.change(input, { target: { value: '25' } });
    expect(input).toHaveValue('25');

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockActions.proveEligibility).toHaveBeenCalledWith(25);
    });

    // Privacy protection: input value wiped after submission
    expect(input).toHaveValue('');
  });

  it('6. Disables form controls during proof generation phases', () => {
    const mockVeilPassProving: VeilPassState = {
      ...mockVeilPassIdle,
      status: 'proving',
    };

    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassProving}
        actions={mockActions}
      />
    );

    const input = screen.getByLabelText(/Private Age Witness/i);
    const submitBtn = screen.getByRole('button', { name: /Generating ZK Proof/i });

    expect(input).toBeDisabled();
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');
  });

  it('7. Displays error alert with dismiss button when status is error', () => {
    const mockVeilPassError: VeilPassState = {
      ...mockVeilPassIdle,
      status: 'error',
      errorMessage: 'Transaction was rejected in Midnight wallet.',
    };

    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassError}
        actions={mockActions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Transaction was rejected in Midnight wallet./i);

    const dismissBtn = screen.getByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtn);

    expect(mockActions.clearError).toHaveBeenCalledTimes(1);
  });

  it('8. Displays ineligible alert and clearly shows local rejection with no transaction submitted', () => {
    const mockVeilPassIneligible: VeilPassState = {
      ...mockVeilPassIdle,
      status: 'ineligible',
      errorMessage: 'Rejected locally by the eligibility circuit — no transaction was submitted.',
      result: { eligible: false, thresholdUsed: null, policyThreshold: null, txHash: null },
    };

    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassIneligible}
        actions={mockActions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Not Eligible/i);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Rejected locally by the eligibility circuit — no transaction was submitted./i
    );
    // UI must NOT claim on-chain verification for local circuit rejection
    expect(screen.queryByText(/verified on-chain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Only the verification result is on-chain/i)).not.toBeInTheDocument();
  });

  it('9. Displays genuine confirmed result with tx hash when status is eligible', () => {
    const mockVeilPassEligible: VeilPassState = {
      ...mockVeilPassIdle,
      status: 'eligible',
      result: {
        eligible: true,
        thresholdUsed: 18,
        policyThreshold: 18,
        txHash: 'tx-genuine-preprod-hash-78901234',
      },
    };

    render(
      <EligibilityProof
        walletState={mockWalletStateConnected}
        veilPass={mockVeilPassEligible}
        actions={mockActions}
      />
    );

    expect(screen.getByText(/Eligible/i)).toBeInTheDocument();
    expect(screen.getByTitle('tx-genuine-preprod-hash-78901234')).toBeInTheDocument();
    expect(screen.getByText(/Threshold verified: age/i)).toBeInTheDocument();
    expect(screen.getByText(/Only the verification result is on-chain/i)).toBeInTheDocument();
  });
});
