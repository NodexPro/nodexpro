import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_TABS, billingCopy, resolveBillingTab } from '../../src/domains/billing/billing-copy.pure.js';
import { buildModulePurchaseQuote, canActivateModulePurchase } from '../../src/domains/billing/module-purchase.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('six billing tabs exist in HE/EN and unknown tab falls back to overview', () => {
  assert.deepEqual(
    BILLING_TABS.map((tab) => tab.id),
    ['overview', 'modules', 'staff_licenses', 'billing_payments', 'billing_details', 'client_processing'],
  );
  assert.equal(resolveBillingTab('staff_licenses'), 'staff_licenses');
  assert.equal(resolveBillingTab('nope'), 'overview');
  const he = billingCopy('he');
  const en = billingCopy('en');
  assert.equal(he.tab_overview, 'סקירה כללית');
  assert.equal(en.tab_overview, 'Overview');
  assert.equal(he.tab_staff, 'רישיונות עובדים');
  assert.equal(en.not_configured, 'Not configured');
  assert.match(he.vat_not_configured, /מע״מ אינו מאושר/);
  assert.match(en.next_payment_unconfigured, /Next payment date is not set/);
  assert.doesNotMatch(en.vat_not_configured, /Country Pack|Accounting Base|catalog_only/);
});

test('module quote never treats fallback VAT as a legal total and never enables pay', () => {
  const legal = buildModulePurchaseQuote({
    moduleId: 'm1',
    modulePlanId: 'p1',
    unitPriceNet: 100,
    currency: 'ils',
    billingPeriod: 'month',
    vatRate: 0.18,
    vatPercentLabel: '18%',
    vatAuthoritative: true,
  });
  assert.equal(legal.vat_authoritative, true);
  assert.equal(legal.vat_amount, 18);
  assert.equal(legal.total_amount, 118);
  assert.equal(legal.checkout_available, false);
  assert.equal(legal.pay_enabled, false);
  const fallback = buildModulePurchaseQuote({
    moduleId: 'm1',
    modulePlanId: 'p1',
    unitPriceNet: 100,
    currency: 'ILS',
    billingPeriod: 'month',
    vatRate: 0.18,
    vatPercentLabel: '18%',
    vatAuthoritative: false,
  });
  assert.equal(fallback.vat_rate, 0);
  assert.equal(fallback.vat_amount, 0);
  assert.equal(fallback.total_amount, 100);
  assert.equal(fallback.labels.total, '');
  assert.equal(fallback.vat_authoritative, false);
});

test('module activation requires verified payment and rejects client confirm', () => {
  assert.equal(canActivateModulePurchase({ intentStatus: 'quoted', paymentVerified: false, alreadyActivated: false }).ok, false);
  assert.equal(canActivateModulePurchase({ intentStatus: 'quoted', paymentVerified: true, alreadyActivated: false }).ok, true);
  assert.equal(
    canActivateModulePurchase({ intentStatus: 'pending_payment', paymentVerified: true, alreadyActivated: false }).ok,
    true,
  );
  assert.equal(
    canActivateModulePurchase({ intentStatus: 'activated', paymentVerified: true, alreadyActivated: false }).ok,
    false,
  );
  const service = read('apps/api/src/domains/billing/module-purchase.service.ts');
  assert.match(service, /PAYMENT_CLIENT_REDIRECT_REJECTED/);
  assert.match(service, /seller_context !== 'nodexpro_platform'/);
  assert.match(service, /status !== 'verified'/);
  assert.doesNotMatch(service, /selectPlan\(/);
});

test('workspace stays light, tenant-scoped, and honest about unconfigured PSP', () => {
  const workspace = read('apps/api/src/domains/billing/billing-workspace.service.ts');
  const routes = read('apps/api/src/domains/billing/billing.routes.ts');
  const index = read('apps/api/src/index.ts');
  assert.match(workspace, /resolveStaffSeatEntitlement\(orgId\)/);
  assert.doesNotMatch(workspace, /getModulesState/);
  assert.match(workspace, /vat\.source === 'country_pack'/);
  assert.match(workspace, /seller_context: 'nodexpro_platform'/);
  assert.match(workspace, /checkout_available: false/);
  assert.match(workspace, /next_payment_unconfigured/);
  assert.match(workspace, /\.eq\('organization_id', orgId\)/);
  assert.match(workspace, /\.eq\('seller_context', 'nodexpro_platform'\)/);
  assert.match(workspace, /buildOfficePaymentsAggregate/);
  assert.match(workspace, /apply_organization_staff_seat_commercial_terms|nextPurchasedSeatQuantity/);
  assert.match(routes, /aggregates\/billing-workspace/);
  assert.match(routes, /isStaffSeatPurchaseCommand/);
  assert.match(routes, /Server-Timing/);
  assert.match(index, /billingRoutes/);
  const migration = read('supabase/migrations/224_module_purchase_intents.sql');
  assert.match(migration, /module_purchase_intents/);
  assert.match(migration, /organizations_for_current_auth_user/);
  assert.match(migration, /selectPlan mock is not the paid path/);
});

test('Users & Roles purchase UI is not a second checkout', () => {
  const page = read('apps/web/src/pages/UsersRoles.tsx');
  assert.match(page, /\/billing\?tab=staff_licenses/);
  assert.doesNotMatch(page, /quoteStaffSeatPurchaseCommand/);
});
