import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/organization-settings/organization-settings.service.ts'),
  'utf8',
);

test('settings PATCH auto-configures Country Pack only when country is in the payload', () => {
  assert.match(service, /shouldAutoConfigureCountrySettings =\s*\n\s*body\.country !== undefined && effectiveCountryCode\.length === 2/);
  assert.doesNotMatch(service, /body\.country !== undefined \|\| !hasConfiguredBinding/);
});

test('settings PATCH syncs income issuer only for issuer-owned profile fields', () => {
  assert.match(service, /shouldSyncIssuerProfile/);
  assert.match(service, /if \(shouldSyncIssuerProfile\) \{\s*\n\s*await syncIncomeIssuerProfileFromOrganization/);
  assert.match(service, /body\.organizationName !== undefined/);
  assert.match(service, /body\.legalEntityType !== undefined/);
  assert.match(service, /body\.legalIdNumber !== undefined/);
  assert.match(service, /body\.country !== undefined/);
});

test('settings PATCH still returns the full refreshed settings aggregate', () => {
  assert.match(service, /return getOrganizationSettings\(ctx, orgId\)/);
  assert.match(service, /Promise\.all\(\[[\s\S]*owner_user_id[\s\S]*organization_settings/);
});
