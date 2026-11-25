import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATIC_PAYMENT_PROVIDER_CATALOG,
  checkoutAvailableForScenario,
  publicProviderView,
} from '../../src/domains/payments/payment-provider-catalog.pure.js';
import {
  catalogOnlyAdapter,
  clientRedirectIsNotPaymentProof,
  sellerContextForScenario,
} from '../../src/domains/payments/payment-adapter.pure.js';
import {
  buildStaffSeatPurchaseQuote,
  canActivateSeatPurchase,
  formatSeatMoneyAmount,
  nextPurchasedSeatQuantity,
  normalizeSeatPurchaseQuantity,
} from '../../src/domains/payments/staff-seat-purchase-quote.pure.js';
import { digestWebhookPayload, redactPaymentLog, webhookMayMutateState } from '../../src/domains/payments/payment-webhook.pure.js';
import { paymentCopy } from '../../src/domains/payments/payment-copy.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('catalog providers stay catalog-only with secrets never exposed', () => {
  assert.equal(STATIC_PAYMENT_PROVIDER_CATALOG.length, 5);
  for (const row of STATIC_PAYMENT_PROVIDER_CATALOG) {
    assert.equal(row.adapter_status, 'catalog_only');
    assert.equal(row.capabilities.hosted_checkout, false);
    const view = publicProviderView(row);
    assert.equal(view.secrets_present, false);
    assert.equal(view.connectable, false);
    assert.equal(checkoutAvailableForScenario({
      adapterStatus: row.adapter_status,
      supportedScenarios: row.supported_scenarios,
      scenario: 'PLATFORM_BILLING',
    }), false);
  }
});

test('catalog-only adapter never verifies a webhook', () => {
  const adapter = catalogOnlyAdapter('tranzila', STATIC_PAYMENT_PROVIDER_CATALOG[0].capabilities);
  assert.deepEqual(adapter.verifyWebhook({ headers: {}, rawBody: '{}', secret: 'x' }), {
    ok: false,
    code: 'PAYMENT_ADAPTER_NOT_READY',
  });
  assert.equal(clientRedirectIsNotPaymentProof('success'), true);
});

test('seller contexts stay separated', () => {
  assert.equal(sellerContextForScenario('PLATFORM_BILLING'), 'nodexpro_platform');
  assert.equal(sellerContextForScenario('OFFICE_EXTERNAL'), 'office');
  assert.equal(sellerContextForScenario('OFFICE_EMBEDDED'), 'office');
});

test('seat quote uses office commercial terms when set and never enables pay', () => {
  const office = buildStaffSeatPurchaseQuote({
    quantity: 2,
    catalogUnitPrice: 49,
    officeCurrentUnitPrice: 30,
    currency: 'ILS',
    billingPeriod: 'month',
    vatRate: 0.18,
    vatPercentLabel: '18%',
  });
  assert.equal(office.price_source, 'office_commercial_terms');
  assert.equal(office.unit_price_net, 30);
  assert.equal(office.net_amount, 60);
  assert.equal(office.checkout_available, false);
  assert.equal(office.pay_enabled, false);
  const catalog = buildStaffSeatPurchaseQuote({
    quantity: 1,
    catalogUnitPrice: 49,
    officeCurrentUnitPrice: null,
    currency: 'ILS',
    billingPeriod: 'month',
    vatRate: 0.18,
    vatPercentLabel: '18%',
  });
  assert.equal(catalog.price_source, 'platform_catalog');
  assert.equal(catalog.unit_price_net, 49);
  assert.equal(normalizeSeatPurchaseQuantity(0), null);
  assert.equal(formatSeatMoneyAmount(49, 'ils'), '49.00 ILS');
});

test('activation requires verified payment and never shrinks purchased seats', () => {
  assert.equal(canActivateSeatPurchase({ intentStatus: 'quoted', paymentVerified: true, alreadyActivated: false }).ok, false);
  assert.equal(
    canActivateSeatPurchase({ intentStatus: 'paid_pending_activation', paymentVerified: false, alreadyActivated: false }).ok,
    false,
  );
  assert.equal(
    canActivateSeatPurchase({ intentStatus: 'paid_pending_activation', paymentVerified: true, alreadyActivated: false }).ok,
    true,
  );
  assert.equal(nextPurchasedSeatQuantity(3, 2), 5);
  assert.equal(nextPurchasedSeatQuantity(3, -9), 3);
});

test('webhooks mutate only after signature and against replay', () => {
  assert.equal(webhookMayMutateState({ signatureOk: false, alreadyProcessed: false }).ok, false);
  assert.equal(webhookMayMutateState({ signatureOk: true, alreadyProcessed: true }).ok, false);
  assert.equal(webhookMayMutateState({ signatureOk: true, alreadyProcessed: false }).ok, true);
  assert.equal(digestWebhookPayload('abc').length, 64);
  assert.equal(redactPaymentLog({ api_key: 'secret', provider_code: 'tranzila' }).api_key, '[redacted]');
});

test('office and owner copy is HE/EN and honest about availability', () => {
  assert.match(paymentCopy('he').office_title, /סליקה מלקוחות/);
  assert.match(paymentCopy('en').office_title, /Client Payment Processing/);
  assert.match(paymentCopy('he').unavailable, /עדיין לא מחובר/);
  assert.match(paymentCopy('en').no_ready_adapter, /No signed payment adapter/);
});

test('migration and services keep checkout off and reuse existing seat entitlement RPC', () => {
  const migration = read('supabase/migrations/223_payment_infrastructure.sql');
  const purchase = read('apps/api/src/domains/payments/staff-seat-purchase.service.ts');
  const infra = read('apps/api/src/domains/payments/payment-infrastructure.service.ts');
  const agg = read('apps/api/src/domains/memberships/users-roles-aggregate.service.ts');
  assert.match(migration, /payment_provider_catalog/);
  assert.match(migration, /staff_seat_purchase_intents/);
  assert.match(migration, /platform_billing_subscriptions/);
  assert.match(migration, /payments\.office\.connect/);
  assert.match(migration, /organizations_for_current_auth_user/);
  assert.match(purchase, /apply_organization_staff_seat_commercial_terms/);
  assert.match(purchase, /PAYMENT_CLIENT_REDIRECT_REJECTED/);
  assert.match(purchase, /checkout_available: false/);
  assert.doesNotMatch(purchase, /checkout_available:\s*true/);
  assert.match(infra, /PAYMENT_ADAPTER_NOT_READY/);
  assert.match(infra, /API keys are not accepted until an adapter is ready/);
  assert.match(agg, /checkout_available: false/);
  assert.match(agg, /pay: \{ enabled: false \}/);
});
