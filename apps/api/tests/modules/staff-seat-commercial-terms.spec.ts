/**
 * Organization staff-seat commercial terms.
 * Purchased quantity comes only from the dated terms version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeStaffSeatCommercialCharge,
  projectStaffSeatOrganization,
  resolveOperationalPurchasedStaffSeats,
  roleConsumesStaffSeat,
  type StaffSeatTermVersion,
} from '../../src/domains/modules/staff-seat-entitlement.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const migration183 = readFileSync(
  join(root, 'supabase/migrations/183_organization_staff_seat_commercial_terms.sql'),
  'utf8',
);
const service = readFileSync(
  join(root, 'apps/api/src/domains/modules/staff-seat-entitlement.service.ts'),
  'utf8',
);
const commands = readFileSync(
  join(root, 'apps/api/src/domains/country-pack/country-pack-commands.service.ts'),
  'utf8',
);
const readModel = readFileSync(
  join(root, 'apps/api/src/domains/country-pack/country-pack-read-models.service.ts'),
  'utf8',
);
const page = readFileSync(
  join(root, 'apps/web/src/pages/owner-modules/PlatformOwnerModuleDetailPage.tsx'),
  'utf8',
);
const modal = readFileSync(
  join(root, 'apps/web/src/pages/owner-modules/StaffSeatTermsModal.tsx'),
  'utf8',
);

function version(partial: Partial<StaffSeatTermVersion> & Pick<StaffSeatTermVersion, 'effective_from' | 'additional_seat_quantity'>): StaffSeatTermVersion {
  return {
    effective_to: null,
    currency: 'ILS',
    unit_price_amount: 49,
    discount_percent: 0,
    billing_period: 'month',
    ...partial,
  };
}

test('1-3 backfill keeps quantity, null price, and drops the purchased column', () => {
  assert.match(migration183, /where e\.purchased_additional_staff_seats > 0/);
  assert.match(migration183, /null,\s*null,\s*0/);
  assert.match(migration183, /drop column if exists purchased_additional_staff_seats/);
  assert.doesNotMatch(migration183, /unit_price_amount,\s*49/);
  assert.doesNotMatch(service, /purchased_additional_staff_seats, grandfathered_staff_seats, included_staff_seats_override/);
});

test('2 null price displays an em dash and never falls back to 49', () => {
  const charge = computeStaffSeatCommercialCharge({
    additional_seat_quantity: 2,
    unit_price_amount: null,
    discount_percent: 0,
    currency: null,
    billing_period: 'month',
  });
  assert.equal(charge.seat_charge_label, '—');
  assert.equal(charge.recurring_seat_charge, null);
  assert.doesNotMatch(charge.seat_charge_label, /49/);
});

test('4 no terms resolves purchased quantity 0', () => {
  const resolved = resolveOperationalPurchasedStaffSeats({
    as_of: '2026-10-08',
    versions: [],
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 0,
  });
  assert.equal(resolved.purchased_staff_seats, 0);
});

test('5-7 current terms apply, future terms wait, then apply on the effective date', () => {
  const versions = [
    version({ effective_from: '2026-10-01', effective_to: '2026-10-31', additional_seat_quantity: 1 }),
    version({ effective_from: '2026-11-01', additional_seat_quantity: 2, discount_percent: 20 }),
  ];
  const before = resolveOperationalPurchasedStaffSeats({
    as_of: '2026-10-08',
    versions,
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 0,
  });
  assert.equal(before.purchased_staff_seats, 1);
  assert.equal(before.scheduled_version?.additional_seat_quantity, 2);
  const onDate = resolveOperationalPurchasedStaffSeats({
    as_of: '2026-11-01',
    versions,
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 0,
  });
  assert.equal(onDate.purchased_staff_seats, 2);
  assert.equal(versions[0]?.additional_seat_quantity, 1);
});

test('8-9 historical version is not rewritten and periods do not overlap in the migration', () => {
  assert.match(migration183, /STAFF_SEAT_TERMS_HISTORY_IMMUTABLE/);
  assert.match(migration183, /organization_staff_seat_commercial_terms_no_overlap/);
  assert.match(migration183, /effective_from < p_effective_from/);
});

test('10-11 server charge is quantity times discounted unit price', () => {
  const one = computeStaffSeatCommercialCharge({
    additional_seat_quantity: 1,
    unit_price_amount: 49,
    discount_percent: 20,
    currency: 'ILS',
    billing_period: 'month',
  });
  assert.equal(one.effective_unit_price, 39.2);
  assert.equal(one.recurring_seat_charge, 39.2);
  assert.equal(one.seat_charge_label, '₪49.00 → ₪39.20/month');
  const two = computeStaffSeatCommercialCharge({
    additional_seat_quantity: 2,
    unit_price_amount: 49,
    discount_percent: 20,
    currency: 'ILS',
    billing_period: 'month',
  });
  assert.equal(two.recurring_seat_charge, 78.4);
  assert.equal(two.seat_charge_label, '₪98.00 → ₪78.40/month');
});

test('13-17 unsafe reduction is rejected now, scheduled later, and becomes operational only when safe', () => {
  assert.match(migration183, /p_effective_from <= current_date/);
  assert.match(migration183, /STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION/);
  assert.doesNotMatch(migration183, /revoked_at = now\(\)|status = 'revoked'|delete from public\.organization_memberships/i);
  const versions = [
    version({ effective_from: '2026-10-01', effective_to: '2026-10-31', additional_seat_quantity: 2, unit_price_amount: 49 }),
    version({ effective_from: '2026-11-01', additional_seat_quantity: 1, unit_price_amount: 49 }),
  ];
  const blocked = projectStaffSeatOrganization({
    as_of: '2026-11-01',
    versions,
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 2,
  });
  assert.equal(blocked.purchased_additional_staff_seats, 2);
  assert.equal(blocked.blocked_scheduled_reduction?.status_code, 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION');
  assert.equal(blocked.staff_seats_label, '2 additional / 2 total');
  const later = projectStaffSeatOrganization({
    as_of: '2026-11-02',
    versions,
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 1,
  });
  assert.equal(later.purchased_additional_staff_seats, 1);
  assert.equal(later.blocked_scheduled_reduction, null);
  assert.equal(versions[0]?.additional_seat_quantity, 2);
});

test('18-23 guards use the resolver; owner and viewer do not consume', () => {
  assert.match(migration183, /v_purchased := public\.resolve_org_purchased_staff_seats\(p_organization_id\)/);
  assert.match(migration183, /activate_organization_membership_with_staff_seat_guard/);
  assert.match(migration183, /change_organization_membership_role_with_staff_seat_guard/);
  assert.match(migration183, /count_active_staff_seat_consumers/);
  assert.equal(roleConsumesStaffSeat('owner'), false);
  assert.equal(roleConsumesStaffSeat('viewer'), false);
  assert.equal(roleConsumesStaffSeat('admin'), true);
  assert.equal(roleConsumesStaffSeat('staff'), true);
});

test('24-28 quantity command writes today and preserves price; terms command is platform owner only', () => {
  assert.match(migration183, /p_preserve_commercial_price/);
  assert.match(migration183, /current_date/);
  assert.match(service, /setOrganizationStaffSeatQuantityCommand/);
  assert.match(service, /frontend_price_ignored/);
  assert.match(service, /p_preserve_commercial_price: false/);
  assert.match(service, /assertPlatformOwner\(ctx\)/);
  assert.match(commands, /set_organization_staff_seat_terms/);
  assert.match(commands, /owner_module_detail_aggregate/);
  assert.doesNotMatch(commands, /case 'set_organization_staff_seat_terms'[\s\S]{0,500}stripe|payment_intent|invoice/i);
});

test('29-33 aggregate labels, modal, existing actions, and no payment', () => {
  assert.match(readModel, /staff_seats: staffSeatsByOrg/);
  const row = projectStaffSeatOrganization({
    as_of: '2026-10-08',
    versions: [version({ effective_from: '2026-10-01', additional_seat_quantity: 2, unit_price_amount: 39.2 })],
    included_staff_seats: 0,
    grandfathered_staff_seats: 0,
    active_consumed_staff_seats: 0,
  });
  assert.equal(row.staff_seats_label, '2 additional / 2 total');
  assert.equal(row.seat_charge_label, '₪78.40/month');
  assert.match(page, /staff_seats_label/);
  assert.match(page, /seat_charge_label/);
  assert.match(page, /set_organization_staff_seat_terms/);
  assert.match(page, /Extend Trial/);
  assert.match(page, /activate_org_module_access/);
  assert.match(modal, /Save seat terms/);
  assert.match(modal, /effective_unit_price_label/);
  assert.doesNotMatch(modal, /unitPrice\s*\*\s*|discount\s*\/\s*100/);
  assert.doesNotMatch(page, /Buy|Purchase|Pay|Checkout|Paid/);
  assert.doesNotMatch(migration183, /stripe|payment_intent|create table public\.invoices/i);
});
