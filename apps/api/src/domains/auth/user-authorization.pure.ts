/**
 * Canonical application-user status (public.users.status).
 * Not organization membership status. Not JWT claims.
 */
export const APP_USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type AppUserStatus = (typeof APP_USER_STATUSES)[number];

export const APP_USER_NOT_ACTIVE_CODE = 'USER_NOT_ACTIVE';
export const APP_USER_NOT_ACTIVE_MESSAGE = 'Account is not available';

export const CANONICAL_MEMBERSHIP_ACTIVE = 'active';

export function normalizeAppUserStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

/** Only `active` may call protected API routes. Unknown values deny-by-default. */
export function isAppUserStatusActive(status: string | null | undefined): boolean {
  return normalizeAppUserStatus(status) === 'active';
}

export function isCanonicalMembershipStatusActive(status: string | null | undefined): boolean {
  return normalizeAppUserStatus(status) === CANONICAL_MEMBERSHIP_ACTIVE;
}

export function inactiveAppUserError(status: string | null | undefined): {
  code: typeof APP_USER_NOT_ACTIVE_CODE;
  message: typeof APP_USER_NOT_ACTIVE_MESSAGE;
  stored_status: string;
} {
  return {
    code: APP_USER_NOT_ACTIVE_CODE,
    message: APP_USER_NOT_ACTIVE_MESSAGE,
    stored_status: normalizeAppUserStatus(status) || 'missing',
  };
}
