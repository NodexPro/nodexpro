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
