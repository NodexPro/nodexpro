import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('Platform Owner Taxes is a dedicated aggregate screen on Country Pack legal values', () => {
  const page = read('../src/pages/PlatformOwnerTaxesPage.tsx');
  const shell = read('../src/pages/PlatformOwnerShell.tsx');
  const app = read('../src/App.tsx');
  const endpoints = read('../src/api/endpoints.ts');
  const routes = read('../../api/src/routes/owner-country-pack.routes.ts');
  const commands = read('../../api/src/domains/country-pack/country-pack-commands.service.ts');
  const migration = read('../../../supabase/migrations/226_platform_seller_vat_legal_value.sql');
  assert.match(shell, /\/platform-owner\/taxes/);
  assert.match(shell, /Taxes \/ מיסים/);
  assert.match(app, /path="taxes"/);
  assert.match(endpoints, /taxes: '\/owner\/taxes'/);
  assert.match(routes, /router\.get\('\/taxes'/);
  assert.match(page, /OWNER\.taxes/);
  assert.match(page, /schedule_tax_rate_change|nx-owner-taxes-table/);
  assert.match(page, /owner_surface: 'taxes'/);
  assert.doesNotMatch(page, /eval\(|new Function|18 \* |0\.18 \*/);
  assert.match(commands, /schedule_tax_rate_change/);
  assert.match(commands, /status: 'active'/);
  assert.match(commands, /activate_legal_value_version/);
  assert.match(commands, /closeOverlappingActiveTaxVersions/);
  assert.match(commands, /Active tax rates are immutable/);
  assert.doesNotMatch(commands.slice(commands.indexOf('handleScheduleTaxRateChange'), commands.indexOf('handleUpdateLegalValueVersion')), /payment_transactions|staff_seat_purchase_intents|module_purchase_intents|income_documents/);
  assert.match(page, /platform_seller_vat/);
  assert.match(migration, /il_standard_vat_rate/);
  assert.match(migration, /on conflict \(country_code, value_key\) do nothing/);
  assert.match(migration, /not exists/);
  assert.doesNotMatch(migration, /value_payload_json/);
});
