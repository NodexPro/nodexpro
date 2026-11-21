/** Login MFA UI follows backend challenge truth only. A missing session is not a challenge. */

export function loginMfaFormVisible(input: {
  loginChallengeRequired?: boolean;
  sessionState?: string | null;
  sessionChallengeRequired?: boolean;
}): boolean {
  if (input.loginChallengeRequired === true) return true;
  if (input.sessionState === 'mfa_challenge') return true;
  if (input.sessionChallengeRequired === true) return true;
  return false;
}

export function shouldAttachOrganizationHeader(path: string): boolean {
  const value = String(path ?? '').split('?')[0] ?? '';
  if (!value) return false;
  if (value.startsWith('/owner/')) return false;
  if (value.startsWith('/docflow/portal')) return false;
  // /auth/session and /auth/me accept a membership-checked header so the
  // returned aggregate matches this tab. Stale headers for a non-member are
  // ignored on the backend (resolve_stored), not 403.
  return !(
    /\/auth\/logout$/.test(value)
    || /\/auth\/aggregates\/mfa$/.test(value)
    || /\/auth\/commands\/verify_mfa$/.test(value)
    || /\/auth\/commands\/verify_mfa_recovery$/.test(value)
  );
}
