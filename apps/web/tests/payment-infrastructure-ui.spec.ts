import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('Users & Roles sends extra-seat purchase to Billing Staff Licenses', () => {
  const page = read('../src/pages/UsersRoles.tsx');
  assert.match(page, /\/billing\?tab=staff-licenses/);
  assert.match(page, /staff_seats_add/);
  assert.doesNotMatch(page, /quoteStaffSeatPurchaseCommand/);
  assert.doesNotMatch(page, /users-roles-staff-seat-quote/);
  assert.doesNotMatch(page, /unit_price_net \*|vat_rate \*|selectPlan|createCheckout|purchaseStaffSeat/);
  assert.doesNotMatch(page, /confirm_staff_seat_purchase_from_client/);
});

test('Platform Owner Payments and office Payments & Processing are dedicated aggregates', () => {
  const owner = read('../src/pages/PlatformOwnerPaymentsPage.tsx');
  const office = read('../src/pages/OfficePaymentsPage.tsx');
  const billing = read('../src/pages/Billing.tsx');
  const app = read('../src/App.tsx');
  const shell = read('../src/pages/PlatformOwnerShell.tsx');
  const settings = read('../src/pages/Settings.tsx');
  const en = read('../src/i18n/en.json');
  const he = read('../src/i18n/he.json');
  assert.match(owner, /OWNER\.payments/);
  assert.match(owner, /save_platform_payment_provider_credentials/);
  assert.match(owner, /upsert_payment_provider_catalog/);
  assert.doesNotMatch(owner, /type="password"/);
  assert.match(office, /Navigate to="\/billing\?tab=client_processing"/);
  assert.match(billing, /orgBillingClientProcessing/);
  assert.match(billing, /enter_api_keys/);
  assert.match(billing, /credential_fields/);
  assert.match(billing, /field.secret \? 'password'/);
  assert.match(app, /path="payments" element=\{<PlatformOwnerPaymentsPage \/>\}/);
  assert.match(app, /path="settings\/payments" element=\{<OfficePaymentsPage \/>\}/);
  assert.match(shell, /\/platform-owner\/payments/);
  assert.match(settings, /settings-payments-link/);
  assert.match(en, /"payments": "Payments & Processing"/);
  assert.match(he, /"payments": "תשלומים וסליקה"/);
});
