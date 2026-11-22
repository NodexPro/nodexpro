/**
 * Auth-event identity transitions. Does not decide membership, MFA, or tenant access.
 */

export type AuthIdentityTransition =
  | 'user_switched'
  | 'signed_out'
  | 'signed_in'
  | 'token_refresh_same'
  | 'token_refresh_mismatch'
  | 'noop';

export function classifyAuthIdentityTransition(input: {
  event?: string | null;
  previousAuthUserId?: string | null;
  nextAuthUserId?: string | null;
}): AuthIdentityTransition {
  const event = String(input.event ?? '').trim();
  const previous = String(input.previousAuthUserId ?? '').trim();
  const next = String(input.nextAuthUserId ?? '').trim();

  if (event === 'TOKEN_REFRESHED') {
    if (previous && next && previous !== next) return 'token_refresh_mismatch';
    if (previous && next && previous === next) return 'token_refresh_same';
    if (!next) return 'signed_out';
    return 'noop';
  }

  if (event === 'SIGNED_OUT' || !next) return 'signed_out';
  if (previous && next && previous !== next) return 'user_switched';
  if (event === 'INITIAL_SESSION') return 'noop';
  if (!previous && next) return 'signed_in';
  return 'noop';
}

export function shouldDropAuthenticatedUi(transition: AuthIdentityTransition): boolean {
  return transition === 'signed_out' || transition === 'user_switched' || transition === 'token_refresh_mismatch';
}

export function shouldRefetchSessionAfterAuthEvent(transition: AuthIdentityTransition): boolean {
  return transition === 'user_switched' || transition === 'signed_in' || transition === 'token_refresh_mismatch';
}

/**
 * User switch / sign-out must not join an in-flight GET started under a previous identity.
 * Fresh SIGNED_IN (no previous user) keeps the password-login session fetch.
 * TOKEN_REFRESHED for the same user keeps the in-flight session.
 */
export function shouldInvalidateInFlightSession(transition: AuthIdentityTransition): boolean {
  return (
    transition === 'user_switched'
    || transition === 'signed_out'
    || transition === 'token_refresh_mismatch'
  );
}

export function canReuseInFlightSession(input: {
  inFlightGeneration?: number | null;
  currentGeneration?: number | null;
  inFlightAuthUserId?: string | null;
  currentAuthUserId?: string | null;
}): boolean {
  if (input.inFlightGeneration == null || input.currentGeneration == null) return false;
  if (input.inFlightGeneration !== input.currentGeneration) return false;
  const inFlightUser = String(input.inFlightAuthUserId ?? '').trim();
  const currentUser = String(input.currentAuthUserId ?? '').trim();
  if (inFlightUser && currentUser && inFlightUser !== currentUser) return false;
  return true;
}

/** A late getSession() must not overwrite a newer live identity with an empty or other user. */
export function shouldApplyBootstrappedSession(input: {
  bootAuthUserId?: string | null;
  currentAuthUserId?: string | null;
}): boolean {
  const boot = String(input.bootAuthUserId ?? '').trim();
  const current = String(input.currentAuthUserId ?? '').trim();
  if (!boot && current) return false;
  if (boot && current && boot !== current) return false;
  return true;
}

/**
 * Local account-switch signOut emits SIGNED_OUT. If setSession(B) already won,
 * that late event must not paint logged-out over B.
 * Do not call supabase.auth.getSession() from onAuthStateChange — that deadlocks GoTrue's lock.
 */
export function shouldApplySignedOutUi(input: {
  event?: string | null;
  liveAuthUserId?: string | null;
  currentAuthUserId?: string | null;
  switchInstalledUserId?: string | null;
}): boolean {
  if (String(input.event ?? '').trim() !== 'SIGNED_OUT') return true;
  if (String(input.liveAuthUserId ?? '').trim()) return false;
  if (String(input.switchInstalledUserId ?? '').trim()) return false;
  return true;
}

/** GoTrue deadlocks if onAuthStateChange awaits other auth APIs under its exclusive lock. */
export function authStateChangeCallbackAwaitsAuthLock(source: string): boolean {
  return /onAuthStateChange\(\s*async\s*\(/.test(source)
    || /event === 'SIGNED_OUT'[\s\S]{0,400}auth\.getSession\(/.test(source);
}

export function nextAuthGeneration(current: number): number {
  return current + 1;
}

export function isCurrentAuthGeneration(started: number, current: number): boolean {
  return started === current;
}

export const nextRequestGeneration = nextAuthGeneration;

export function isStaleRequestGeneration(started: number, current: number): boolean {
  return !isCurrentAuthGeneration(started, current);
}
