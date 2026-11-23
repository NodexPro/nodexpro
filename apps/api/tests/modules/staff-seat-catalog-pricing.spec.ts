/**
 * Platform Owner global additional-staff-seat list price.
 * Updates platform_staff_seat_pricing only; office commercial terms stay untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaffSeatCatalogPricingBlock } from '../../src/domains/modules/staff-seat-entitlement.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('catalog block is list price for new seats and never claims to rewrite office terms', () => {
  const block = buildStaffSeatCatalogPricingBlock({
    unit_price_amount: 49,
    currency: 'ILS',
    billing_period: 'month',
  });
  assert.equal(block.code, 'default');
  assert.equal(block.unit_price_amount, 49);
  assert.equal(block.currency, 'ILS');
  assert.equal(block.applies_to, 'new_additional_staff_seats');
  assert.equal(block.does_not_rewrite_existing_office_terms, true);
  assert.equal(block.save.action_key, 'set_platform_staff_seat_pricing');
  assert.match(block.note, /Existing office commercial terms/);
});

test('set_platform_staff_seat_pricing is a Platform Owner command with audit and refreshed aggregate', () => {
  const service = read('apps/api/src/domains/modules/staff-seat-entitlement.service.ts');
  const commands = read('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const owner = read('apps/api/src/domains/owner-modules/owner-modules.service.ts');
  const audit = read('apps/api/src/shared/audit-events.ts');
  const fn = service.slice(
    service.indexOf('export async function setPlatformStaffSeatPricingCommand'),
    service.indexOf('export function buildOwnerCommercialSeatsSection'),
  );
  assert.match(fn, /assertPlatformOwner\(ctx\)/);
  assert.match(fn, /\.from\('platform_staff_seat_pricing'\)/);
  assert.match(fn, /\.eq\('code', 'default'\)/);
  assert.match(fn, /STAFF_SEAT_CATALOG_PRICE_SET/);
  assert.match(fn, /existing_office_terms_rewritten: false/);
  assert.doesNotMatch(fn, /organization_staff_seat_commercial_terms/);
  assert.doesNotMatch(fn, /apply_organization_staff_seat_commercial_terms/);
  assert.match(commands, /'set_platform_staff_seat_pricing'/);
  assert.match(commands, /setPlatformStaffSeatPricingCommand/);
  assert.match(commands, /owner_module_detail_aggregate/);
  assert.match(owner, /staff_seat_catalog_pricing/);
  assert.match(owner, /buildStaffSeatCatalogPricingBlock/);
  assert.match(audit, /STAFF_SEAT_CATALOG_PRICE_SET: 'staff_seat.catalog_price_set'/);
});

test('dashboard providers and entitlements stay batched/parallel', () => {
  const dash = read('apps/api/src/domains/dashboard/dashboard-aggregator.service.ts');
  const entitlement = read('apps/api/src/domains/modules/entitlement.service.ts');
  assert.match(dash, /Promise\.all\(/);
  assert.match(dash, /providers\.map/);
  assert.match(entitlement, /export async function resolveEntitlementsForOrganization/);
  assert.match(entitlement, /Promise\.all\(/);
  assert.doesNotMatch(dash, /setTimeout\(|sleep\(/);
});

test('Users & Roles next-seat price still reads catalog; office current terms stay separate', () => {
  const agg = read('apps/api/src/domains/memberships/users-roles-aggregate.service.ts');
  assert.match(agg, /list_unit_price_amount: catalogPrice/);
  assert.match(agg, /current_unit_price_amount: staffSeatTruth\?\.current_terms_unit_price_amount/);
  assert.match(agg, /checkout_available: false/);
});
