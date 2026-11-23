import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '../src/pages/owner-modules/PlatformOwnerModuleDetailPage.tsx'), 'utf8');

test('Pricing tab edits catalog staff-seat list price via named command and refreshed aggregate', () => {
  assert.match(page, /staff_seat_catalog_pricing/);
  assert.match(page, /set_platform_staff_seat_pricing/);
  assert.match(page, /owner_module_detail_aggregate/);
  assert.match(page, /Save list price/);
  assert.doesNotMatch(page, /createCheckout|stripe|payment_intent/i);
  assert.doesNotMatch(page, /organization_staff_seat_commercial_terms/);
});
