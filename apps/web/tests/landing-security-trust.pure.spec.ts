import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_SECURITY_TRUST_BLOCK_TYPE,
  LANDING_SECURITY_TRUST_CARD_KEYS,
  landingSecurityTrustCopyIsConservative,
} from '../src/components/landing/landing-security-trust.pure.js';

test('security_trust is the reserved Website Studio block id, not a second CMS', () => {
  assert.equal(LANDING_SECURITY_TRUST_BLOCK_TYPE, 'security_trust');
  assert.deepEqual([...LANDING_SECURITY_TRUST_CARD_KEYS], [
    'access',
    'protection',
    'accountability',
    'ongoing',
  ]);
});

test('published trust copy stays conservative', () => {
  assert.equal(
    landingSecurityTrustCopyIsConservative(
      'Security considerations are incorporated into ongoing product development.',
    ),
    true,
  );
  assert.equal(landingSecurityTrustCopyIsConservative('ISO 27001 certified'), false);
  assert.equal(landingSecurityTrustCopyIsConservative('SOC 2 Type II'), false);
});
