import { createHash, randomBytes } from 'node:crypto';

export const MFA_DEVICE_COOKIE = 'nx_mfa_device';
export const MFA_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type TrustedDeviceState = 'trusted' | 'recheck' | 'unavailable';

export function newDeviceCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

/** A boolean flag is not a credential. Only the httpOnly cookie value is read. */
export function deviceCredentialFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() !== MFA_DEVICE_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (!value || value === 'true' || value === '1') return null;
    return value;
  }
  return null;
}

export function deviceCookieHeader(credential: string, secure: boolean): string {
  const parts = [
    `${MFA_DEVICE_COOKIE}=${encodeURIComponent(credential)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${MFA_DEVICE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Backend proof only. A browser flag is not an argument. */
export function trustedDeviceState(input: {
  storageReady: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  now: string;
}): TrustedDeviceState {
  if (!input.storageReady || !input.expiresAt) return 'unavailable';
  if (input.revokedAt) return 'recheck';
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) return 'recheck';
  return 'trusted';
}

export function clientDeviceFlagIsIgnored(flag: unknown): true {
  void flag;
  return true;
}
