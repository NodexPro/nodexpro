/**
 * Onboarding route gate. Backend session_state is the only source.
 * Load errors are not treated as an empty organization.
 */

import {
  isStaleWorkspaceError,
  isTransientTokenRefreshError,
  shouldClearLocalAuthSession,
} from './session-auth-failure.pure';

export function isPrimaryOnboardingState(sessionState: string | null | undefined): boolean {
  return String(sessionState ?? '').trim() === 'needs_onboarding';
}

export const isPrimaryOnboardingSession = isPrimaryOnboardingState;

export function destinationWhenOnboardingBlocked(input: {
  sessionState: string | null | undefined;
  redirectTo: string | null | undefined;
}): string {
  const state = String(input.sessionState ?? '').trim();
  const redirect = String(input.redirectTo ?? '').trim();
  if (state === 'needs_org_selection') return redirect || '/select-org';
  if (state === 'mfa_challenge' || state === 'blocked') return redirect || '/login';
  if (state === 'platform_owner') return redirect || '/platform-owner/legal-control';
  return redirect || '/dashboard';
}

export const destinationWhenOnboardingNotAllowed = destinationWhenOnboardingBlocked;

export function sessionBootFailureKind(error: unknown): 'clear_auth' | 'retryable' {
  return shouldClearLocalAuthSession(error) ? 'clear_auth' : 'retryable';
}

export function classifySessionFetchFailure(error: unknown): 'clear_auth' | 'session_error' | 'ignore' {
  if (!error || typeof error !== 'object') return 'session_error';
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  if (name === 'AbortError' || isStaleWorkspaceError(error)) return 'ignore';
  if (isTransientTokenRefreshError(error)) return 'session_error';
  if (shouldClearLocalAuthSession(error)) return 'clear_auth';
  return 'session_error';
}
