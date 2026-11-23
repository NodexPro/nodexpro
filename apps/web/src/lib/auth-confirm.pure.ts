export const AUTH_CONFIRM_PATH = '/auth/confirm';
export const AUTH_CALLBACK_PATH = '/auth/callback';

export type AuthConfirmOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email';

const OTP_TYPES = new Set<string>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

export function parseAuthConfirmOtpType(raw: string | null | undefined): AuthConfirmOtpType | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (OTP_TYPES.has(value)) return value as AuthConfirmOtpType;
  return null;
}

export function parseAuthConfirmLocation(search: string, hash: string): {
  tokenHash: string | null;
  type: AuthConfirmOtpType | null;
  code: string | null;
  errorCode: string | null;
} {
  const query = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  const fragment = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const tokenHash = (query.get('token_hash') ?? '').trim() || null;
  const code = (query.get('code') ?? '').trim() || null;
  const type = parseAuthConfirmOtpType(query.get('type') ?? fragment.get('type'));
  const errorCode = (query.get('error_code') ?? query.get('error') ?? fragment.get('error_code') ?? fragment.get('error') ?? '')
    .trim() || null;
  return { tokenHash, type, code, errorCode };
}

/** Safe for logs and UI telemetry. Never includes tokens, hashes, or codes. */
export function authConfirmPublicState(parsed: {
  tokenHash: string | null;
  type: AuthConfirmOtpType | null;
  code: string | null;
  errorCode: string | null;
}): {
  hasTokenHash: boolean;
  hasCode: boolean;
  hasError: boolean;
  type: AuthConfirmOtpType | null;
} {
  return {
    hasTokenHash: Boolean(parsed.tokenHash),
    hasCode: Boolean(parsed.code),
    hasError: Boolean(parsed.errorCode),
    type: parsed.type,
  };
}

export function isRecoveryAuthConfirmType(type: AuthConfirmOtpType | null): boolean {
  return type === 'recovery';
}

export function destinationAfterAuthConfirm(type: AuthConfirmOtpType | null): string {
  if (isRecoveryAuthConfirmType(type)) return '/reset-password';
  return '/login?confirmed=1';
}

export function loginShowsEmailConfirmed(search: string): boolean {
  const query = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  return query.get('confirmed') === '1';
}

export function stripAuthSensitiveUrl(href: string): string {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '/auth/confirm';
  }
}

export function recoveryHandoffHref(search: string, hash: string): string {
  const queryRaw = String(search ?? '');
  const hashRaw = String(hash ?? '');
  const query = !queryRaw || queryRaw.startsWith('?') ? queryRaw : `?${queryRaw}`;
  const fragment = !hashRaw || hashRaw.startsWith('#') ? hashRaw : `#${hashRaw}`;
  return `/reset-password${query}${fragment}`;
}
