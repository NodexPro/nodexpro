import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isValidIsraeliTeudatZehutChecksum,
  normalizeIsraeliTzDigits,
  normalizeOwnerLegalIdentity,
} from '../../src/domains/trial/legal-identity.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const VALID_TZ = '123456782';
const INVALID_CHECKSUM = '123456789';

test('valid Israeli ID checksum and punctuation/spacing normalize to 9 digits', () => {
  assert.equal(isValidIsraeliTeudatZehutChecksum(VALID_TZ), true);
  assert.equal(normalizeIsraeliTzDigits('123-456-782'), VALID_TZ);
  assert.equal(normalizeIsraeliTzDigits(' 123 456 782 '), VALID_TZ);
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', '123-456-782'), { ok: true, value: VALID_TZ });
});

test('leading zeros pad to 9 digits then checksum', () => {
  assert.equal(normalizeIsraeliTzDigits('000000018'), '000000018');
  assert.equal(isValidIsraeliTeudatZehutChecksum('000000018'), true);
  assert.deepEqual(normalizeOwnerLegalIdentity('il', 'tz', '000000018'), { ok: true, value: '000000018' });
});

test('invalid checksum, all zeros, missing, letters and overlong values are rejected', () => {
  assert.equal(isValidIsraeliTeudatZehutChecksum(INVALID_CHECKSUM), false);
  assert.equal(isValidIsraeliTeudatZehutChecksum('000000000'), false);
  assert.equal(normalizeIsraeliTzDigits(''), null);
  assert.equal(normalizeIsraeliTzDigits('abcdefghi'), null);
  assert.equal(normalizeIsraeliTzDigits('1234567820'), null);
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', INVALID_CHECKSUM), { ok: false, code: 'checksum' });
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', ''), { ok: false, code: 'digits' });
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', 'abc'), { ok: false, code: 'digits' });
  assert.deepEqual(normalizeOwnerLegalIdentity('US', 'tz', VALID_TZ), { ok: false, code: 'unsupported' });
});

test('account register does not collect or require Teudat Zehut', () => {
  const registerPage = readFileSync(join(dir, '../../../web/src/pages/Register.tsx'), 'utf8');
  const authService = readFileSync(join(dir, '../../src/domains/auth/auth.service.ts'), 'utf8');
  const authRoutes = readFileSync(join(dir, '../../src/domains/auth/auth.routes.ts'), 'utf8');
  assert.match(authService, /register\(params: \{ email: string; password: string; fullName\?: string \}\)/);
  assert.doesNotMatch(registerPage, /legalIdentity|teudat|tzPlaceholder|legal_identity/i);
  assert.doesNotMatch(authRoutes, /legalIdentity|teudat zehut/i);
  assert.match(authRoutes, /const \{ email, password, fullName \} = req\.body/);
});

test('organization create does not require Teudat Zehut; trial legal-identity does', () => {
  const orgRoutes = readFileSync(join(dir, '../../src/domains/organizations/organizations.routes.ts'), 'utf8');
  const orgService = readFileSync(join(dir, '../../src/domains/organizations/organizations.service.ts'), 'utf8');
  const trialRoutes = readFileSync(join(dir, '../../src/domains/trial/trial.routes.ts'), 'utf8');
  assert.match(orgRoutes, /name, legalName, countryCode, timezone/);
  assert.doesNotMatch(orgService, /legalIdentity|teudat|legal_identity_value/);
  assert.match(trialRoutes, /authMiddleware/);
  assert.match(trialRoutes, /requireOfficeAdministration/);
  assert.match(trialRoutes, /requirePermission\('modules:write'\)/);
  assert.match(trialRoutes, /countryCode, legalIdentityType, and value required/);
  assert.match(trialRoutes, /normalizeAndHash/);
  assert.match(trialRoutes, /isTrialAlreadyUsed/);
  assert.match(trialRoutes, /TRIAL_DENIED/);
  assert.doesNotMatch(trialRoutes, /already registered|user exists|belongs to/i);
});

test('trial uniqueness is one active full-platform trial per hash, not a global person lock', () => {
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/012_trial_one_per_tz_hash.sql'),
    'utf8',
  );
  assert.match(migration, /idx_org_trials_one_trialing_per_hash/);
  assert.match(migration, /legal_identity_hash/);
  assert.match(migration, /status = 'trialing'/);
  const users = readFileSync(join(dir, '../../../../supabase/migrations/001_core_schema.sql'), 'utf8');
  assert.doesNotMatch(users, /teudat|legal_identity|national_id/);
  const accept = readFileSync(join(dir, '../../src/domains/memberships/memberships-rbac.service.ts'), 'utf8');
  assert.match(accept, /export async function acceptInviteRbac\(ctx: RequestContext, token: string\)/);
  assert.doesNotMatch(accept, /legalIdentity|teudat|legal_identity/);
});
