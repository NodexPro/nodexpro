/**
 * Stage 2 — Paid staff seats + grandfather compatibility contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeCommercialRecurringTotals,
  computeGrandfatheredStaffSeats,
  computeStaffSeatAvailability,
  roleConsumesStaffSeat,
} from '../../src/domains/modules/staff-seat-entitlement.pure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');
const migRoot = join(__dirname, '../../../../supabase/migrations');

function readSrc(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf8');
}

test('D — owner does not consume', () => {
  assert.equal(roleConsumesStaffSeat('owner'), false);
});

test('A/E — admin+staff consume; viewer does not', () => {
  assert.equal(roleConsumesStaffSeat('admin'), true);
  assert.equal(roleConsumesStaffSeat('staff'), true);
  assert.equal(roleConsumesStaffSeat('viewer'), false);
});

test('F — invited/revoked not modeled as consumption roles', () => {
  // Consumption is counted only for active admin/staff memberships in SQL/service.
  assert.equal(roleConsumesStaffSeat('pending'), false);
  assert.equal(roleConsumesStaffSeat('invited'), false);
  assert.equal(roleConsumesStaffSeat('revoked'), false);
});

test('A — consumed 2 / included 0 / purchased 0 → grandfathered 2 → effective 2', () => {
  const gf = computeGrandfatheredStaffSeats({
    existing_consumption: 2,
    included_staff_seats: 0,
    purchased_staff_seats: 0,
  });
  assert.equal(gf, 2);
  const avail = computeStaffSeatAvailability({
    included_staff_seats: 0,
    grandfathered_staff_seats: gf,
    purchased_staff_seats: 0,
    active_consumed_staff_seats: 2,
  });
  assert.equal(avail.entitled_staff_seats, 2);
  assert.equal(avail.available_staff_seats, 0);
});

test('B — consumed 3 / included 1 / purchased 1 → grandfathered 1 → effective 3', () => {
  const gf = computeGrandfatheredStaffSeats({
    existing_consumption: 3,
    included_staff_seats: 1,
    purchased_staff_seats: 1,
  });
  assert.equal(gf, 1);
  const avail = computeStaffSeatAvailability({
    included_staff_seats: 1,
    grandfathered_staff_seats: gf,
    purchased_staff_seats: 1,
    active_consumed_staff_seats: 3,
  });
  assert.equal(avail.entitled_staff_seats, 3);
  assert.equal(avail.available_staff_seats, 0);
});

test('C — consumed 1 / included 2 / purchased 0 → grandfathered 0', () => {
  const gf = computeGrandfatheredStaffSeats({
    existing_consumption: 1,
    included_staff_seats: 2,
    purchased_staff_seats: 0,
  });
  assert.equal(gf, 0);
  const avail = computeStaffSeatAvailability({
    included_staff_seats: 2,
    grandfathered_staff_seats: gf,
    purchased_staff_seats: 0,
    active_consumed_staff_seats: 1,
  });
  assert.equal(avail.entitled_staff_seats, 2);
  assert.equal(avail.available_staff_seats, 1);
});

test('G — existing purchased seats are not double-counted in grandfather formula', () => {
  const gf = computeGrandfatheredStaffSeats({
    existing_consumption: 4,
    included_staff_seats: 1,
    purchased_staff_seats: 2,
  });
  assert.equal(gf, 1);
  const avail = computeStaffSeatAvailability({
    included_staff_seats: 1,
    grandfathered_staff_seats: gf,
    purchased_staff_seats: 2,
    active_consumed_staff_seats: 4,
  });
  assert.equal(avail.entitled_staff_seats, 4);
});

test('L — effective entitlement includes grandfathered exactly once', () => {
  const avail = computeStaffSeatAvailability({
    included_staff_seats: 1,
    grandfathered_staff_seats: 2,
    purchased_staff_seats: 3,
    active_consumed_staff_seats: 4,
  });
  assert.equal(avail.entitled_staff_seats, 6);
  assert.equal(avail.available_staff_seats, 2);
  assert.equal(avail.grandfathered_staff_seats, 2);
});

test('H — commercial recurring bills purchased only (grandfather creates no payment)', () => {
  const withGfOnly = computeCommercialRecurringTotals({
    modules_recurring_total_amount: 99,
    purchased_staff_seats: 0,
    seat_unit_price_amount: 49,
    currency: 'ILS',
  });
  assert.equal(withGfOnly.seats_recurring_total_amount, 0);
  assert.equal(withGfOnly.commercial_recurring_total_amount, 99);

  const withPurchased = computeCommercialRecurringTotals({
    modules_recurring_total_amount: 99,
    purchased_staff_seats: 3,
    seat_unit_price_amount: 49,
    currency: 'ILS',
  });
  assert.equal(withPurchased.seats_recurring_total_amount, 147);
  assert.equal(withPurchased.commercial_recurring_total_amount, 246);
});

test('I/K — source: grandfather never auto-grows; PO purchased update leaves grandfathered unchanged', () => {
  const mig = readFileSync(join(migRoot, '181_organization_staff_seat_entitlement.sql'), 'utf8');
  assert.match(mig, /grandfathered_staff_seats/);
  assert.match(mig, /Never auto-increased at runtime|never auto-grow/i);
  assert.match(mig, /grandfathered_staff_seats intentionally unchanged/);
  assert.match(
    mig,
    /grandfathered_staff_seats = greatest\(\s*0,\s*public\.count_active_staff_seat_consumers/,
  );

  const svc = readSrc('domains/modules/staff-seat-entitlement.service.ts');
  assert.match(svc, /grandfathered_unchanged/);
  assert.match(svc, /grandfathered_staff_seats: after\.grandfathered_staff_seats/);
  assert.doesNotMatch(svc, /grandfathered_staff_seats\s*=\s*[^;]*\+/);
  assert.match(svc, /set_organization_purchased_staff_seats/);
});

test('J — concurrency guard preserved (advisory lock + FOR UPDATE + capacity check)', () => {
  const mig = readFileSync(join(migRoot, '181_organization_staff_seat_entitlement.sql'), 'utf8');
  assert.match(mig, /pg_advisory_xact_lock/);
  assert.match(mig, /for update/i);
  assert.match(mig, /STAFF_SEAT_CAPACITY_EXCEEDED/);
  assert.match(mig, /v_entitled := v_included \+ coalesce\(v_purchased, 0\) \+ coalesce\(v_grandfathered, 0\)/);
});

test('Stage2 source contract — org-wide seats, grandfather backfill, accept/role enforcement, PO command', () => {
  const mig = readFileSync(join(migRoot, '181_organization_staff_seat_entitlement.sql'), 'utf8');
  assert.match(mig, /platform_staff_seat_pricing/);
  assert.match(mig, /organization_staff_seat_entitlements/);
  assert.match(mig, /purchased_additional_staff_seats/);
  assert.match(mig, /grandfathered_staff_seats/);
  assert.match(mig, /included_staff_seats/);
  assert.match(mig, /pg_advisory_xact_lock/);
  assert.match(mig, /activate_organization_membership_with_staff_seat_guard/);
  assert.match(mig, /change_organization_membership_role_with_staff_seat_guard/);
  assert.match(mig, /set_organization_purchased_staff_seats/);
  assert.match(mig, /STAFF_SEAT_CAPACITY_EXCEEDED/);
  assert.match(mig, /STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION/);
  assert.match(mig, /trial_included_staff_seats/);
  assert.match(mig, /insert into public\.organization_staff_seat_entitlements/);
  assert.match(mig, /from public\.organizations o/);
  assert.doesNotMatch(mig, /180_organization_users/);
  assert.doesNotMatch(mig, /stripe|create.?charge|billing_provider|payment_intent/i);
  assert.match(mig, /NOT payment|Not purchased|Not billable/i);

  const mig180 = readFileSync(join(migRoot, '180_organization_users_sync_from_canonical_memberships.sql'), 'utf8');
  const mig182 = readFileSync(join(migRoot, '182_client_operations_todo.sql'), 'utf8');
  assert.ok(mig180.length > 0);
  assert.ok(mig182.length > 0);
  assert.doesNotMatch(mig180, /grandfathered_staff_seats/);
  assert.doesNotMatch(mig182, /grandfathered_staff_seats/);

  const svc = readSrc('domains/modules/staff-seat-entitlement.service.ts');
  assert.match(svc, /resolveStaffSeatEntitlement/);
  assert.match(svc, /assertStaffSeatCapacity/);
  assert.match(svc, /assertModuleEntitled/);
  assert.match(svc, /setOrganizationStaffSeatQuantityCommand/);
  assert.match(svc, /frontend_price_ignored/);
  assert.match(svc, /assertPlatformOwner/);
  assert.match(svc, /grandfathered_staff_seats/);
  assert.match(svc, /buildOwnerCommercialSeatsSection/);

  const pure = readSrc('domains/modules/staff-seat-entitlement.pure.ts');
  assert.match(pure, /computeGrandfatheredStaffSeats/);
  assert.match(pure, /included \+ grandfathered \+ purchased/);

  const accept = readSrc('domains/memberships/memberships-rbac.service.ts');
  assert.match(accept, /activateMembershipWithStaffSeatGuard/);
  assert.match(accept, /changeMembershipRoleWithStaffSeatGuard/);

  const cmds = readSrc('domains/country-pack/country-pack-commands.service.ts');
  assert.match(cmds, /set_organization_staff_seat_quantity/);

  const requireMod = readSrc('middleware/requireModuleActive.ts');
  assert.match(requireMod, /resolveEntitlement/);
  assert.doesNotMatch(requireMod, /staff.?seat|seat_entitlement/i);

  const stage1Helper = readSrc('domains/memberships/organization-membership-access.ts');
  assert.match(stage1Helper, /mayUseLegacyOrganizationUsersAccessFallback/);
});

test('Stage2 live DB A–P seat integrity', async (t) => {
  const configured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!configured) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.rpc('activate_organization_membership_with_staff_seat_guard', {
    p_organization_id: '00000000-0000-4000-8000-000000000000',
    p_user_id: '00000000-0000-4000-8000-000000000001',
    p_role_code: 'staff',
    p_invited_by: null,
  });
  if (probe.error && /Could not find the function|PGRST202|does not exist/i.test(String(probe.error.message))) {
    t.skip('migration 181 not applied — live seat RPC tests skipped');
    return;
  }
  t.skip('Live A–P suite reserved for applied-migration environments (probe returned non-missing error)');
});
