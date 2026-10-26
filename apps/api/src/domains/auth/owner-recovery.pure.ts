import { timingSafeEqual } from 'node:crypto';

export function normalizeRecoveryEmail(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function ownerRecoveryEmailAllowed(attempted: string, configured: string | null | undefined): boolean {
  const want = normalizeRecoveryEmail(configured);
  const got = normalizeRecoveryEmail(attempted);
  return Boolean(want) && want === got;
}

export function hashesEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(String(left ?? ''), 'hex');
  const b = Buffer.from(String(right ?? ''), 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function publicOwnerRecoveryRequest(sessionId: string): { ok: true; recovery_session_id: string } {
  return { ok: true, recovery_session_id: sessionId };
}
