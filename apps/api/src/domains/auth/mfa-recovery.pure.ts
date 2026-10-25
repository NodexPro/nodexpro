import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryGrantSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let raw = '';
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(normalizeRecoveryCode(code), salt, 32).toString('base64url');
  return { salt, hash };
}

export function recoveryCodeMatches(code: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(normalizeRecoveryCode(code), salt, 32);
  const expected = Buffer.from(hash, 'base64url');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** A missing or already consumed record cannot authorize factor removal. */
export function hashGrantSecret(secret: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(secret.trim(), salt, 32).toString('base64url');
  return { salt, hash };
}

export function grantSecretMatches(secret: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(secret.trim(), salt, 32);
  const expected = Buffer.from(hash, 'base64url');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function recoveryConsumeDecision(record: { consumedAt: string | null } | null): 'missing' | 'used' | 'ok' {
  if (!record) return 'missing';
  if (record.consumedAt) return 'used';
  return 'ok';
}
