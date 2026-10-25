import type { PrivilegedMfaActivationState } from './privileged-mfa-activation.pure.js';

export const PRIVILEGED_MFA_GATE_REFRESH_MIN_INTERVAL_MS = 5_000;

export function decidePrivilegedMfaGateRefresh(input: {
  force: boolean;
  activationState: PrivilegedMfaActivationState;
  msSinceLastRefresh: number;
  minIntervalMs?: number;
  hasInFlight: boolean;
}): 'refresh' | 'join-inflight' | 'skip' {
  if (input.force) return input.hasInFlight ? 'join-inflight' : 'refresh';
  if (input.activationState === 'permanently_active') return 'skip';
  if (input.hasInFlight) return 'join-inflight';
  const min = input.minIntervalMs ?? PRIVILEGED_MFA_GATE_REFRESH_MIN_INTERVAL_MS;
  if (input.msSinceLastRefresh < min) return 'skip';
  return 'refresh';
}
