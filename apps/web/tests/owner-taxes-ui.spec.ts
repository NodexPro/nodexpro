import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('Platform Owner Taxes is a dedicated aggregate screen on Country Pack legal values', () => {
  const page = read('../src/pages/PlatformOwnerTaxesPage.tsx');
  const css = read('../src/styles/nx-owner-taxes.css');
  const shell = read('../src/pages/PlatformOwnerShell.tsx');
  const app = read('../src/App.tsx');
  const endpoints = read('../src/api/endpoints.ts');
  const routes = read('../../api/src/routes/owner-country-pack.routes.ts');
  const commands = read('../../api/src/domains/country-pack/country-pack-commands.service.ts');
  const migration = read('../../../supabase/migrations/226_platform_seller_vat_legal_value.sql');
  const copy = read('../../api/src/domains/country-pack/owner-taxes-copy.pure.ts');
  assert.match(shell, /\/platform-owner\/taxes/);
  assert.match(shell, /Taxes \/ מיסים/);
  assert.match(app, /path="taxes"/);
  assert.match(endpoints, /taxes: '\/owner\/taxes'/);
  assert.match(routes, /router\.get\('\/taxes'/);
  assert.match(page, /OWNER\.taxes/);
  assert.match(page, /schedule_tax_rate_change/);
  assert.match(page, /create_legal_value/);
  assert.match(page, /create_legal_value_version/);
  assert.match(page, /activate_legal_value_version/);
  assert.match(page, /owner_surface: 'taxes'/);
  assert.match(page, /nx-settings-deep-ocean/);
  assert.match(page, /nx-office-ocean/);
  assert.match(page, /dir=\{direction\}/);
  assert.match(page, /nx-owner-taxes-add/);
  assert.match(page, /nx-owner-taxes-settings/);
  assert.match(page, /nx-owner-taxes-country/);
  assert.match(page, /nx-owner-taxes-audit/);
  assert.match(page, /platform_seller_vat/);
  assert.match(page, /text\.change_history/);
  assert.match(page, /text\.version_history/);
  assert.doesNotMatch(page, /nx-owner-taxes-table/);
  assert.doesNotMatch(page, /nx-owner-sheet/);
  assert.doesNotMatch(page, /Payload \(JSON object\)/);
  assert.doesNotMatch(page, /eval\(|new Function|18 \* |0\.18 \*/);
  assert.match(css, /nx-owner-taxes__card/);
  assert.match(copy, /add_tax_type: 'Add tax'/);
  assert.match(copy, /add_tax_type: 'הוספת מס'/);
  assert.match(copy, /settings: 'הגדרות'/);
  assert.match(commands, /schedule_tax_rate_change/);
  assert.match(commands, /status: 'active'/);
  assert.match(commands, /activate_legal_value_version/);
  assert.match(commands, /closeOverlappingActiveTaxVersions/);
  assert.match(commands, /Active tax rates are immutable/);
  assert.doesNotMatch(
    commands.slice(commands.indexOf('handleScheduleTaxRateChange'), commands.indexOf('handleUpdateLegalValueVersion')),
    /payment_transactions|staff_seat_purchase_intents|module_purchase_intents|income_documents/,
  );
  assert.match(migration, /il_standard_vat_rate/);
  assert.match(migration, /on conflict \(country_code, value_key\) do nothing/);
  assert.match(migration, /not exists/);
  assert.doesNotMatch(migration, /value_payload_json/);
});

test('Platform Owner Taxes UI follows Settings glass and RTL from aggregate', () => {
  const page = read('../src/pages/PlatformOwnerTaxesPage.tsx');
  const css = read('../src/styles/nx-owner-taxes.css');
  const settings = read('../src/pages/Settings.tsx');
  assert.match(settings, /nx-glass-page nx-glass-page--wide nx-settings nx-settings-deep-ocean nx-office-ocean/);
  assert.match(page, /nx-glass-page nx-glass-page--wide nx-settings nx-settings-deep-ocean nx-office-ocean nx-owner-taxes/);
  assert.match(page, /nx-glass-btn nx-glass-btn--purple/);
  assert.match(page, /nx-glass-btn nx-glass-btn--secondary/);
  assert.match(page, /nx-glass-input/);
  assert.match(page, /nx-settings-identity-table/);
  assert.match(page, /aggregate\?\.ui\?\.locale === 'he'/);
  assert.match(page, /direction === 'rtl'/);
  assert.match(css, /padding: 8px 20px/);
  assert.match(css, /border-radius: 6px/);
  assert.match(css, /min-width: 96px/);
  assert.doesNotMatch(page, /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
});
