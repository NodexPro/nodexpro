/**
 * Platform Owner staff-seat terms UI is render-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '../src/pages/owner-modules/PlatformOwnerModuleDetailPage.tsx'), 'utf8');
const modal = readFileSync(join(dir, '../src/pages/owner-modules/StaffSeatTermsModal.tsx'), 'utf8');

test('Users table renders organization seat labels from the aggregate', () => {
  assert.match(page, /Staff Seats/);
  assert.match(page, /Seat Charge/);
  assert.match(page, /staff_seats_label/);
  assert.match(page, /seat_charge_label/);
  assert.match(page, /Extend Trial/);
  assert.match(page, /activate_org_module_access/);
});

test('Staff Seats modal saves one terms command and does not calculate charges', () => {
  assert.match(page, /set_organization_staff_seat_terms/);
  assert.match(page, /owner_module_detail_aggregate/);
  assert.match(modal, /Staff Seats —/);
  assert.match(modal, /Save seat terms/);
  assert.match(modal, /Included seats/);
  assert.match(modal, /Scheduled terms/);
  assert.doesNotMatch(modal, /unitPrice\s*\*|discount\s*\/\s*100/);
  assert.doesNotMatch(modal, /organization_memberships|organization_users/);
  assert.doesNotMatch(`${page}\n${modal}`, /Buy seat|Purchase seat|Checkout|payment_intent/);
});
