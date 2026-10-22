import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnerLegalIdentity } from '../../src/domains/trial/legal-identity.pure.js';

const VALID_TZ = '123456782';

test('direct API-shaped payloads cannot skip owner-identity checksum', () => {
  const bypassAttempts: Array<{ countryCode: string; legalIdentityType: string; value: string; code: 'digits' | 'checksum' | 'unsupported' }> = [
    { countryCode: 'IL', legalIdentityType: 'tz', value: '', code: 'digits' },
    { countryCode: 'IL', legalIdentityType: 'tz', value: '         ', code: 'digits' },
    { countryCode: 'IL', legalIdentityType: 'tz', value: '123456789', code: 'checksum' },
    { countryCode: 'IL', legalIdentityType: 'ssn', value: VALID_TZ, code: 'unsupported' },
    { countryCode: 'IL', legalIdentityType: 'hp', value: VALID_TZ, code: 'unsupported' },
    { countryCode: 'US', legalIdentityType: 'tz', value: VALID_TZ, code: 'unsupported' },
  ];
  for (const body of bypassAttempts) {
    assert.deepEqual(normalizeOwnerLegalIdentity(body.countryCode, body.legalIdentityType, body.value), {
      ok: false,
      code: body.code,
    });
  }
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', VALID_TZ), { ok: true, value: VALID_TZ });
});

test('same ID with different formatting normalizes to one value', () => {
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', '123456782'), { ok: true, value: VALID_TZ });
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', '123-456-782'), { ok: true, value: VALID_TZ });
  assert.deepEqual(normalizeOwnerLegalIdentity('IL', 'tz', '123 456 782'), { ok: true, value: VALID_TZ });
});
