import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('Users & Roles sends extra seats to Billing and does not show a purchase block', () => {
  const page = read('../src/pages/UsersRoles.tsx');
  const agg = read('../../api/src/domains/memberships/users-roles-aggregate.service.ts');
  assert.match(page, /\/billing\?tab=staff-licenses/);
  assert.match(page, /staff_seats_add/);
  assert.match(page, /users-roles-add-seat-billing/);
  assert.doesNotMatch(page, /users-roles-staff-seats|nx-ur-seats|current_rate_label|next_seat_price_label/);
  assert.doesNotMatch(page, /unit_price_amount \* 1\.18|49 \+ 18/);
  assert.match(agg, /list_unit_price_amount: catalogPrice/);
  assert.match(agg, /current_unit_price_amount: staffSeatTruth\?\.current_terms_unit_price_amount/);
  assert.match(agg, /checkout_available: false/);
  assert.doesNotMatch(page, /selectPlan|createCheckout|quoteStaffSeatPurchaseCommand/);
});
