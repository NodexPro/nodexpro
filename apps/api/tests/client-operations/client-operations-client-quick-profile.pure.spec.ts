/**
 * Client Operations — Client Quick Profile pure builders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuickProfileIdentityRow,
  buildQuickProfileRecurringExpenseRows,
  buildQuickProfileVehicleExpenseRows,
  resolveOperationalReportingPeriodKey,
  resolveQuickProfilePhoneDisplay,
  QUICK_PROFILE_EMPTY_DISPLAY,
} from '../../src/domains/client-operations/client-operations-client-quick-profile.pure.js';

test('phone: primary contact wins over clients.phone', () => {
  assert.equal(
    resolveQuickProfilePhoneDisplay({
      client_phone: '050-111',
      primary_contact_phone: '050-222',
    }),
    '050-222'
  );
  assert.equal(
    resolveQuickProfilePhoneDisplay({
      client_phone: '050-111',
      primary_contact_phone: null,
    }),
    '050-111'
  );
});

test('reporting period is prior Asia/Jerusalem month', () => {
  const key = resolveOperationalReportingPeriodKey(new Date('2026-09-21T12:00:00+03:00'));
  assert.equal(key, '2026-08');
});

test('identity copy metadata only when copyable and non-empty', () => {
  const withCopy = buildQuickProfileIdentityRow({
    key: 'tax_id',
    label_he: 'ת.ז / ח.פ',
    raw: '123',
    copyable: true,
  });
  assert.equal(withCopy.copy_enabled, true);
  assert.equal(withCopy.copy_value, '123');

  const empty = buildQuickProfileIdentityRow({
    key: 'phone',
    label_he: 'טלפון',
    raw: null,
    copyable: true,
  });
  assert.equal(empty.copy_enabled, false);
  assert.equal(empty.display_value, QUICK_PROFILE_EMPTY_DISPLAY);
});

test('only selected expenses appear; amount kinds have no ₪ amount', () => {
  const rows = buildQuickProfileRecurringExpenseRows([
    { expense_type_code: 'rent', business_percent: null, monthly_amount_ils: 5000 },
    { expense_type_code: 'water', business_percent: 25, monthly_amount_ils: null },
    { expense_type_code: 'arnona', business_percent: 25, monthly_amount_ils: null },
  ]);
  assert.equal(rows.length, 3);
  const rent = rows.find((r) => r.key === 'expense_rent');
  assert.ok(rent);
  assert.equal(rent!.label_he, 'שכירות');
  assert.equal(rent!.display_value, '');
  assert.doesNotMatch(rent!.display_value, /₪|5000/);
  const water = rows.find((r) => r.key === 'expense_water');
  assert.equal(water!.display_value, '25%');
});

test('unselected expense types are absent', () => {
  const rows = buildQuickProfileRecurringExpenseRows([
    { expense_type_code: 'internet', business_percent: 100, monthly_amount_ils: null },
  ]);
  assert.equal(rows.length, 1);
  assert.ok(!rows.some((r) => r.label_he === 'שכירות'));
  assert.ok(!rows.some((r) => r.label_he === 'מים'));
});

test('vehicle absent when not configured; percent backend-supplied when present', () => {
  assert.deepEqual(
    buildQuickProfileVehicleExpenseRows({ has_vehicles: false, vehicles: [] }),
    []
  );
  assert.deepEqual(
    buildQuickProfileVehicleExpenseRows({
      has_vehicles: true,
      vehicles: [{ vehicle_status: 'active', business_use_percent: null }],
    }),
    []
  );
  const rows = buildQuickProfileVehicleExpenseRows({
    has_vehicles: true,
    vehicles: [{ vehicle_status: 'active', business_use_percent: 45 }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.label_he, 'רכב');
  assert.equal(rows[0]!.display_value, '45%');
});
