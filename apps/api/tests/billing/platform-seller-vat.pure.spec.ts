import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAuthoritativeSellerVat,
  parseLegalVatRate,
  platformSellerVatFromCountryPackRate,
  unresolvedPlatformSellerVat,
} from '../../src/domains/billing/platform-seller-vat.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('platform seller VAT is authoritative only from Country Pack legal values', () => {
  const legal = platformSellerVatFromCountryPackRate(0.18);
  assert.equal(legal.seller_context, 'nodexpro_platform');
  assert.equal(legal.source, 'country_pack');
  assert.equal(legal.authoritative, true);
  assert.equal(legal.standard_rate, 0.18);
  assert.equal(legal.standard_rate_percent_label, '18%');
  assert.deepEqual(applyAuthoritativeSellerVat(legal), { vatRate: 0.18, vatPercentLabel: '18%' });

  const missing = unresolvedPlatformSellerVat();
  assert.equal(missing.authoritative, false);
  assert.equal(missing.source, 'unresolved');
  assert.equal(missing.standard_rate, 0);
  assert.deepEqual(applyAuthoritativeSellerVat(missing), { vatRate: 0, vatPercentLabel: '' });
});

test('legal VAT payload parser accepts percent or fraction and rejects junk', () => {
  assert.equal(parseLegalVatRate(18), 0.18);
  assert.equal(parseLegalVatRate(0.18), 0.18);
  assert.equal(parseLegalVatRate({ rate: 18 }), 0.18);
  assert.equal(parseLegalVatRate({ rate: 0.18 }), 0.18);
  assert.equal(parseLegalVatRate({ percent: '18%' }), 0.18);
  assert.equal(parseLegalVatRate(null), null);
  assert.equal(parseLegalVatRate({}), null);
  const applied = applyAuthoritativeSellerVat(platformSellerVatFromCountryPackRate(0.18, 'ver-1'));
  assert.equal(applied.vatRate, 0.18);
  assert.equal(applied.vatPercentLabel, '18%');
});

test('staff license VAT uses NodexPro seller Country Pack, not office income VAT', () => {
  const workspace = read('apps/api/src/domains/billing/billing-workspace.service.ts');
  const purchase = read('apps/api/src/domains/payments/staff-seat-purchase.service.ts');
  const modules = read('apps/api/src/domains/billing/module-purchase.service.ts');
  const seller = read('apps/api/src/domains/billing/platform-seller-vat.service.ts');
  assert.match(seller, /resolveOwnerLegalValueRulesetContextForCountry/);
  assert.match(seller, /PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY/);
  assert.match(seller, /legal_value_missing|active_version_missing/);
  assert.doesNotMatch(seller, /resolveIncomeDraftVatForOrg|IL_DRAFT_VAT_FALLBACK_RATE/);
  assert.match(workspace, /resolvePlatformSellerVat/);
  assert.doesNotMatch(workspace, /resolveIncomeDraftVatForOrg/);
  assert.match(workspace, /pay: \{ enabled: false, disabled_reason:/);
  assert.match(purchase, /resolvePlatformSellerVat/);
  assert.doesNotMatch(purchase, /resolveIncomeDraftVatForOrg/);
  assert.match(purchase, /status: 'quoted'/);
  assert.match(purchase, /entitlement_changed: false/);
  assert.doesNotMatch(purchase, /activateStaffSeatPurchaseFromVerifiedPayment\(ctx/);
  assert.match(modules, /resolvePlatformSellerVat/);
  assert.doesNotMatch(modules, /resolveIncomeDraftVatForOrg/);
});
