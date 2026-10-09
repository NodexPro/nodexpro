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
const modalCss = readFileSync(join(dir, '../src/pages/owner-modules/StaffSeatTermsModal.css'), 'utf8');

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
  assert.match(modal, /Included/);
  assert.match(modal, /scheduled \|\| blocked \?/);
  assert.match(modal, /Scheduled terms/);
  assert.doesNotMatch(modal, /unitPrice\s*\*|discount\s*\/\s*100/);
  assert.doesNotMatch(modal, /organization_memberships|organization_users/);
  assert.doesNotMatch(`${page}\n${modal}`, /Buy seat|Purchase seat|Checkout|payment_intent/);
});

test('Staff Seats modal keeps header and footer visible and stays compact', () => {
  assert.match(modal, /aria-label="Close"/);
  assert.match(modal, />\s*Cancel\s*</);
  assert.match(modal, /Save seat terms/);
  const headerAt = modal.indexOf('nx-staff-seat-modal__header');
  const bodyAt = modal.indexOf('nx-staff-seat-modal__body');
  const footerAt = modal.indexOf('nx-staff-seat-modal__footer');
  assert.ok(headerAt >= 0 && bodyAt > headerAt && footerAt > bodyAt);
  assert.match(modalCss, /\.nx-staff-seat-modal\s*\{[^}]*max-height:\s*90vh/s);
  assert.match(modalCss, /\.nx-staff-seat-modal__body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(modalCss, /\.nx-staff-seat-modal__form\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
  assert.match(modal, /No commercial seat terms configured\./);
  assert.match(modal, /current \? \(/);
  assert.match(modal, /\{scheduled \|\| blocked \? \(/);
  assert.doesNotMatch(modal, /fetch\(|supabase|\.rpc\(/);
});
