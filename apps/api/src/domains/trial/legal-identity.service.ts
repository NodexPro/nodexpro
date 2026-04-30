import { createHash } from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import { config } from '../../config.js';
import { badRequest } from '../../shared/errors.js';

const TZ_LENGTH = 9;
const MASK_LAST_DIGITS = 4;

/**
 * Mask normalized TZ for UI display only. E.g. 123456789 => ***6789
 */
export function maskNormalizedTz(normalized: string): string {
  if (normalized.length < MASK_LAST_DIGITS) return '***';
  return '***' + normalized.slice(-MASK_LAST_DIGITS);
}

/**
 * Normalize Israeli teudat zehut: digits only, 9 digits.
 * Other types: deferred.
 */
export function normalizeLegalIdentity(
  countryCode: string,
  legalIdentityType: string,
  value: string
): string {
  if (legalIdentityType === 'tz' && countryCode.toLowerCase() === 'il') {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== TZ_LENGTH) {
      throw badRequest(`Teudat zehut must be ${TZ_LENGTH} digits`);
    }
    return digits;
  }
  throw badRequest(`Unsupported legal identity type: ${legalIdentityType} for country ${countryCode}`);
}

/**
 * One-way hash for anti-abuse. Never log or expose.
 */
export function hashLegalIdentity(normalizedValue: string, legalIdentityType: string): string {
  const salt = config.legalIdentityHashSalt;
  const payload = `${normalizedValue}:${legalIdentityType}:${salt}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Returns true if this legal_identity_hash has ever been used for a full_platform trial (any org).
 */
export async function isTrialAlreadyUsed(legalIdentityHash: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('organization_trials')
    .select('id')
    .eq('legal_identity_hash', legalIdentityHash)
    .eq('trial_scope', 'full_platform')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Failed to check trial reuse');
  return !!data;
}

/**
 * Returns true if org has a locked legal identity (cannot be changed by normal users).
 */
export async function hasLockedLegalIdentity(organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organization_legal_identities')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_locked', true)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Normalize and hash legal identity without writing to DB.
 * Use to check trial eligibility (isTrialAlreadyUsed) before storing.
 */
export function normalizeAndHash(
  countryCode: string,
  legalIdentityType: string,
  value: string
): { normalized: string; hash: string; masked: string } {
  const normalized = normalizeLegalIdentity(countryCode, legalIdentityType, value.trim());
  const hash = hashLegalIdentity(normalized, legalIdentityType);
  const masked = legalIdentityType === 'tz' ? maskNormalizedTz(normalized) : '***';
  return { normalized, hash, masked };
}

/**
 * Set primary legal identity for org. Fails if identity is already locked.
 * Caller starts trial after; then call lockAndSetMasked.
 */
export async function setLegalIdentity(
  organizationId: string,
  countryCode: string,
  legalIdentityType: string,
  value: string
): Promise<{ normalized: string; hash: string; masked: string }> {
  const locked = await hasLockedLegalIdentity(organizationId);
  if (locked) {
    throw badRequest('Owner identity is locked and cannot be changed');
  }

  const normalized = normalizeLegalIdentity(countryCode, legalIdentityType, value);
  const hash = hashLegalIdentity(normalized, legalIdentityType);
  const masked = legalIdentityType === 'tz' ? maskNormalizedTz(normalized) : '***';

  await supabaseAdmin.from('organization_legal_identities').upsert(
    {
      organization_id: organizationId,
      country_code: countryCode.toUpperCase().slice(0, 2),
      legal_identity_type: legalIdentityType,
      legal_identity_value_normalized: normalized,
      legal_identity_hash: hash,
      legal_identity_masked: masked,
      is_primary: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' }
  );

  return { normalized, hash, masked };
}

/**
 * Lock owner identity after trial start. Sets is_locked, locked_at, ensures masked is set.
 */
export async function lockAndSetMasked(organizationId: string, maskedValue: string): Promise<void> {
  await supabaseAdmin
    .from('organization_legal_identities')
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      legal_identity_masked: maskedValue,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', organizationId);
}

export interface OwnerIdentitySettingsDto {
  legalIdentityType: string;
  countryCode: string;
  masked: string;
  isLocked: boolean;
  lockedAt: string | null;
  message?: string;
}

/**
 * Read-only owner identity for Company Settings. No raw, normalized, or hash.
 */
export async function getOwnerIdentityForSettings(organizationId: string): Promise<OwnerIdentitySettingsDto | null> {
  const { data } = await supabaseAdmin
    .from('organization_legal_identities')
    .select('legal_identity_type, country_code, legal_identity_masked, is_locked, locked_at')
    .eq('organization_id', organizationId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    legalIdentityType: data.legal_identity_type,
    countryCode: data.country_code,
    masked: data.legal_identity_masked ?? '***',
    isLocked: !!data.is_locked,
    lockedAt: data.locked_at ?? null,
    message: data.is_locked ? 'This identity cannot be changed after trial activation.' : undefined,
  };
}

/**
 * Check if org has any legal identity set (for API response only; no value returned).
 */
export async function hasLegalIdentity(organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organization_legal_identities')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1)
    .maybeSingle();
  return !!data;
}
