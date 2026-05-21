import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const coreSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-client-core.read.ts'),
  'utf8',
);
const weWizardSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-document-creation.builders.ts'),
  'utf8',
);

test('maps Client Operations Hebrew עוסק מורשה to osek_murshe', () => {
  assert.match(coreSource, /CLIENT_OPERATIONS_BUSINESS_TYPE_OSEK_MURSHE/);
  assert.match(coreSource, /return 'osek_murshe'/);
});

test('business type display uses stored CO profile value', () => {
  assert.match(coreSource, /clientOperationsBusinessTypeDisplayHe/);
  assert.doesNotMatch(weWizardSource, /unknown:\s*'לא מוגדר'/);
  assert.match(weWizardSource, /clientOperationsBusinessTypeDisplayHe\(c\.business_type\)/);
});

test('reads clients.address and city like client operations case', () => {
  assert.match(coreSource, /select\('id, display_name, tax_id, email, phone, address, city'\)/);
  assert.match(coreSource, /buildClientOperationsAddressJson/);
  assert.doesNotMatch(weWizardSource, /clients[\s\S]*address_json/);
});
