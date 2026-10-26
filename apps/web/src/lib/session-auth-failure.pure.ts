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
