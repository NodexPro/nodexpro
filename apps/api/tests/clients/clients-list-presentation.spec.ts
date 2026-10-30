import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE,
  formatCoreClientsListBusinessTypeDisplayHe,
} from '../../src/domains/clients/clients-list-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(
  join(dir, '../../src/domains/clients/clients.service.ts'),
  'utf8'
);

test('saved Hebrew business types pass through; empty → לא הוגדר', () => {
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe('חברה'), 'חברה');
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe('עוסק מורשה'), 'עוסק מורשה');
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe('עוסק פטור'), 'עוסק פטור');
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe(null), CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE);
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe('  '), CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE);
  assert.equal(formatCoreClientsListBusinessTypeDisplayHe('—'), CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE);
});

test('listClients attaches display from client_operational_profiles, org-scoped', () => {
  assert.match(service, /client_operational_profiles/);
  assert.match(service, /business_type_display_he/);
  assert.match(service, /formatCoreClientsListBusinessTypeDisplayHe/);
  assert.match(service, /\.eq\('organization_id', orgId\)/);
  assert.doesNotMatch(service, /tax_id\.length|display_name\.includes/);
});
