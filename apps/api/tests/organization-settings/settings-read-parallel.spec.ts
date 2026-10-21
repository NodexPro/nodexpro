import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/organization-settings/organization-settings.service.ts'),
  'utf8',
);

test('getOrganizationSettings keeps the same DTO and parallelizes independent reads', () => {
  assert.match(service, /export async function getOrganizationSettings/);
  assert.match(service, /country_configuration/);
  assert.match(
    service,
    /Promise\.all\(\[[\s\S]*getOwnerIdentityForSettings[\s\S]*getTrialState[\s\S]*organization_settings/,
  );
  assert.match(service, /Promise\.all\(\[[\s\S]*getCountryRegistryWarningForDisplay/);
});
