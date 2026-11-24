import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('Billing workspace lazy-loads tabs, keeps pay disabled, and does not stitch money', () => {
  const page = read('../src/pages/Billing.tsx');
  const css = read('../src/styles/nx-billing.css');
  assert.match(page, /role="tablist"/);
  assert.match(page, /staff_licenses/);
  assert.match(page, /client_processing/);
  assert.match(page, /orgBillingWorkspace/);
  assert.match(page, /orgBillingModules/);
  assert.match(page, /orgBillingStaffLicenses/);
  assert.match(page, /orgBillingPlatformPayments/);
  assert.match(page, /orgBillingClientProcessing/);
  assert.match(page, /AbortController/);
  assert.doesNotMatch(page, /orgModulesState/);
  assert.doesNotMatch(page, /selectPlan|createCheckout/);
  assert.doesNotMatch(page, /vat_rate \*|1\.18|priceAmount\s*\+/);
  assert.match(page, /checkout_unavailable/);
  assert.match(page, /disabled/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /border-radius: 6px/);
});

test('Settings and Users & Roles route extra-seat and office payments into Billing', () => {
  const users = read('../src/pages/UsersRoles.tsx');
  const settings = read('../src/pages/Settings.tsx');
  const office = read('../src/pages/OfficePaymentsPage.tsx');
  const app = read('../src/App.tsx');
  assert.match(users, /\/billing\?tab=staff_licenses/);
  assert.match(settings, /\/billing\?tab=client_processing/);
  assert.match(office, /Navigate to="\/billing\?tab=client_processing"/);
  assert.match(app, /path="billing" element=\{<Billing \/>\}/);
  assert.match(app, /path="payments" element=\{<PlatformOwnerPaymentsPage \/>\}/);
});
