/**
 * Login UI outcomes. HTTP 200 is not success by itself — session_state is the contract.
 * Does not invent membership or create an organization.
 */

import { loginFailureCode } from './login-cooldown.pure';
import { isPrimaryOnboardingState } from './onboarding-session-route.pure';
import { isStaleWorkspaceError } from './session-auth-failure.pure';

export type LoginSubmitFailureKind = 'invalid_credentials' | 'rate_limit' | 'mfa' | 'session_error';
export type LoginUiErrorKind = 'invalid_credentials' | 'load_account' | 'none';
export type PostLoginNavigationKind =
  | 'mfa'
  | 'needs_onboarding'
  | 'needs_org_selection'
  | 'ready'
  | 'blocked'
  | 'platform_owner'
  | 'missing';

function errorShape(error: unknown): { code?: string; status?: number; name?: string; message?: string } {
  if (!error || typeof error !== 'object') return {};
  const record = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

export function classifyLoginSubmitFailure(error: unknown): LoginSubmitFailureKind {
  if (isStaleWorkspaceError(error)) return 'session_error';
  const shape = errorShape(error);
  if (shape.name === 'AbortError' || shape.name === 'LoginSessionContractError') return 'session_error';
  const code = loginFailureCode({ code: shape.code, status: shape.status });
  if (code === 'TOO_MANY_REQUESTS') return 'rate_limit';
  if (code === 'LOGIN_CHALLENGE_REQUIRED') return 'mfa';
  if (code === 'INVALID_CREDENTIALS') return 'invalid_credentials';
  return 'session_error';
}

/**
 * After AUTH.login succeeded, a null aggregate is a session problem — never a credential error.
 */
export function loginUiErrorAfterRefetch(input: {
  loginSucceeded: boolean;
  me?: { session_state?: string | null } | null;
}): LoginUiErrorKind {
  if (!input.loginSucceeded) return 'invalid_credentials';
  if (!input.me) return 'load_account';
  return 'none';
}

export function classifyPostLoginNavigation(input: {
  sessionState?: string | null;
  session_state?: string | null;
  redirectTo?: string | null;
  redirect_to?: string | null;
}): PostLoginNavigationKind {
  const state = String(input.sessionState ?? input.session_state ?? '').trim();
  if (!state) return 'missing';
  if (state === 'mfa_challenge') return 'mfa';
  if (isPrimaryOnboardingState(state)) return 'needs_onboarding';
  if (state === 'needs_org_selection') return 'needs_org_selection';
  if (state === 'blocked') return 'blocked';
  if (state === 'platform_owner') return 'platform_owner';
  if (state === 'ready') return 'ready';
  return 'missing';
}

export function sessionUserMatchesLoginIdentifier(
  me: {
    user?: { email?: string | null };
    account_security?: {
      primary_login_email?: string | null;
      additional_login_email?: string | null;
    };
  } | null | undefined,
  identifier: string | null | undefined,
): boolean {
  const id = String(identifier ?? '').trim().toLowerCase();
  if (!id || !me) return false;
  const emails = [
    me.user?.email,
    me.account_security?.primary_login_email,
    me.account_security?.additional_login_email,
  ];
  return emails.some((email) => String(email ?? '').trim().toLowerCase() === id);
}
