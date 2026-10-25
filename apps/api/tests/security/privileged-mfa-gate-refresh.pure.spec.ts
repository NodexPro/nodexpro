import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePrivilegedMfaGateRefresh } from '../../src/shared/privileged-mfa-gate-refresh.pure.js';

test('owner reads skip a fresh gate refresh while MFA stays not activated', () => {
  assert.equal(
    decidePrivilegedMfaGateRefresh({
      force: false,
      activationState: 'not_activated',
      msSinceLastRefresh: 100,
      hasInFlight: false,
    }),
    'skip',
  );
  assert.equal(
    decidePrivilegedMfaGateRefresh({
      force: false,
      activationState: 'not_activated',
      msSinceLastRefresh: 10_000,
      hasInFlight: true,
    }),
    'join-inflight',
  );
});

test('permanently active gate is not re-queried on ordinary owner reads', () => {
  assert.equal(
    decidePrivilegedMfaGateRefresh({
      force: false,
      activationState: 'permanently_active',
      msSinceLastRefresh: 60_000,
      hasInFlight: false,
    }),
    'skip',
  );
});

test('MFA writes still force a fresh gate read', () => {
  assert.equal(
    decidePrivilegedMfaGateRefresh({
      force: true,
      activationState: 'not_activated',
      msSinceLastRefresh: 0,
      hasInFlight: false,
    }),
    'refresh',
  );
});

test('owner routes still refresh the gate without weakening authorization', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const routes = readFileSync(join(here, '../../src/routes/owner-country-pack.routes.ts'), 'utf8');
  const activation = readFileSync(join(here, '../../src/domains/auth/platform-owner-mfa-activation.service.ts'), 'utf8');
  assert.match(routes, /assertOwnerOrAuditFailure/);
  assert.match(routes, /refreshPrivilegedMfaGate\(\)/);
  assert.match(activation, /refreshPrivilegedMfaGate\(\{ force: true \}\)/);
  assert.equal(routes.includes('deactivate_platform_owner_mfa'), false);
});
