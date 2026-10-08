/**
 * Same-site invite return path. Presentation/routing only.
 * Does not decide membership, role, or seat entitlement.
 */

export const INVITE_RETURN_STORAGE_KEY = 'nx.invite.accept.return';

type InviteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only `/invite/accept?token=<non-empty>`. Rejects absolute, protocol-relative, and other paths. */
export function parseInviteReturnPath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://') || value.includes('\\') || value.includes('\0')) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  if (decoded.includes('://') || decoded.includes('\\') || decoded.includes('\0')) return null;

  const queryAt = decoded.indexOf('?');
  if (queryAt < 0) return null;
  const path = decoded.slice(0, queryAt);
  if (path !== '/invite/accept') return null;

  const params = new URLSearchParams(decoded.slice(queryAt + 1));
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== 'token') return null;
  const token = (params.get('token') ?? '').trim();
  if (!token) return null;
  if (/[\/\\\s]/.test(token) || token.includes('..')) return null;

  return `/invite/accept?token=${encodeURIComponent(token)}`;
}

export function readStoredInviteReturnPath(storage: InviteStorage | null): string | null {
  if (!storage) return null;
  return parseInviteReturnPath(storage.getItem(INVITE_RETURN_STORAGE_KEY));
}

/** Stores a valid invite return path. Invalid candidates are not stored and do not replace a valid one. */
export function captureInviteReturnPath(storage: InviteStorage | null, candidate: string | null | undefined): string | null {
  const parsed = parseInviteReturnPath(candidate);
  if (parsed) {
    storage?.setItem(INVITE_RETURN_STORAGE_KEY, parsed);
    return parsed;
  }
  return readStoredInviteReturnPath(storage);
}

export function clearStoredInviteReturnPath(storage: InviteStorage | null): void {
  storage?.removeItem(INVITE_RETURN_STORAGE_KEY);
}

/** Invite accept wins over session onboarding / default route. Other redirects are not promoted. */
export function resolvePostLoginDestination(input: {
  inviteReturnPath: string | null;
  sessionRedirect: string | null | undefined;
  fallback: string;
}): string {
  const invite = parseInviteReturnPath(input.inviteReturnPath);
  if (invite) return invite;
  const sessionRedirect = (input.sessionRedirect ?? '').trim();
  if (sessionRedirect) return sessionRedirect;
  const fallback = (input.fallback ?? '').trim();
  return fallback || '/dashboard';
}

/** Invited registration returns to accept. Self-signup keeps owner onboarding. */
export function resolvePostRegisterDestination(inviteReturnPath: string | null): string {
  return parseInviteReturnPath(inviteReturnPath) ?? '/onboarding';
}

/** Owner onboarding yields to a preserved invite URL. Null means stay on onboarding. */
export function resolveOwnerOnboardingOverride(inviteReturnPath: string | null): string | null {
  return parseInviteReturnPath(inviteReturnPath);
}

/**
 * Clear stored context only when the invitation itself is finished or unusable.
 * Seat capacity and email mismatch keep the return path so onboarding cannot replace it.
 */
export function isDefinitiveInviteRejection(input: { message?: string | null; code?: string | null }): boolean {
  const code = String(input.code ?? '').trim();
  if (code === 'STAFF_SEAT_CAPACITY_EXCEEDED' || code === 'PENDING_ORGANIZATION_INVITATION') return false;
  const message = String(input.message ?? '').trim().toLowerCase();
  if (!message) return false;
  if (message.includes('different email') || message.includes('staff seat') || message.includes('no available staff seats')) {
    return false;
  }
  if (message.includes('invalid invitation') || message.includes('invalid invite')) return true;
  if (message.includes('expired')) return true;
  if (message.includes('revoked')) return true;
  if (message.includes('already used')) return true;
  return false;
}
