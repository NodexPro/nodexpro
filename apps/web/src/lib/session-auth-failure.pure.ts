/**
 * Session-boot hygiene only. Does not decide user status or membership.
 * Backend remains the source of USER_NOT_ACTIVE / 401 on /auth/session.
 */

export function shouldClearLocalAuthSession(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status =
    'status' in error && typeof (error as { status: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;
  const code =
    'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (code === 'USER_NOT_ACTIVE') return true;
  if (code === 'LOGIN_CHALLENGE_REQUIRED') return false;
  return status === 401;
}

export function sessionAccessTokenNeedsRefresh(
  expiresAtSeconds: number | null | undefined,
  nowMs: number,
  skewMs = 15_000,
): boolean {
  if (expiresAtSeconds == null || !Number.isFinite(expiresAtSeconds)) return false;
  return expiresAtSeconds * 1000 <= nowMs + skewMs;
}

export type UnauthorizedRetryDecision = 'retry' | 'clear_auth' | 'propagate' | 'transient_refresh';

/**
 * 401 during a live refresh is retryable once a new session exists.
 * Confirmed expiry / USER_NOT_ACTIVE still clear. MFA challenge is not logout.
 * A thrown refresh (network) is transient — not confirmed unauth.
 */
export function classifyUnauthorizedRetry(input: {
  status: number;
  code?: string | null;
  alreadyRetried: boolean;
  refreshReturnedSession: boolean;
  refreshFailedTransient?: boolean;
}): UnauthorizedRetryDecision {
  if (input.status !== 401) return 'propagate';
  if (input.code === 'LOGIN_CHALLENGE_REQUIRED') return 'propagate';
  if (input.code === 'USER_NOT_ACTIVE') return 'clear_auth';
  if (!input.alreadyRetried && input.refreshReturnedSession) return 'retry';
  if (!input.alreadyRetried && input.refreshFailedTransient) return 'transient_refresh';
  return 'clear_auth';
}

export function isStaleWorkspaceError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'StaleWorkspaceError');
}

export function isTransientTokenRefreshError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'TokenRefreshError');
}

export type WorkspaceApplyDecision = 'apply' | 'discard_stale';

export function classifyWorkspaceApplyDecision(input: {
  startedGeneration: number;
  currentGeneration: number;
}): WorkspaceApplyDecision {
  return input.startedGeneration === input.currentGeneration ? 'apply' : 'discard_stale';
}

export function classifyCommandResultApply(input: {
  startedGeneration: number;
  currentGeneration: number;
  commandUserId?: string | null;
  currentUserId?: string | null;
  commandOrganizationId?: string | null;
  currentOrganizationId?: string | null;
}): WorkspaceApplyDecision {
  if (classifyWorkspaceApplyDecision(input) === 'discard_stale') return 'discard_stale';
  const commandUser = String(input.commandUserId ?? '').trim();
  const currentUser = String(input.currentUserId ?? '').trim();
  if (commandUser && currentUser && commandUser !== currentUser) return 'discard_stale';
  const commandOrg = String(input.commandOrganizationId ?? '').trim();
  const currentOrg = String(input.currentOrganizationId ?? '').trim();
  if (commandOrg && currentOrg && commandOrg !== currentOrg) return 'discard_stale';
  return 'apply';
}
