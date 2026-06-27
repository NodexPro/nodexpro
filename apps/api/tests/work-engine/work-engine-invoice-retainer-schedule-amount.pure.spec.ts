import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveScheduleProjectionBaseUnitPrice,
  unitPriceForScheduleCycleIndex,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-projection.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const projectionServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-projection.service.ts'),
  'utf8',
);

const increaseProfile = {
  price_increase_enabled: true,
  price_increase_type: 'percent' as const,
  price_increase_value: 2,
};

test('first schedule cycle does not receive +2% increase', () => {
  const base = 1000;
  const cycle0 = unitPriceForScheduleCycleIndex({
    base_unit_price_before_vat: base,
    cycle_index: 0,
    ...increaseProfile,
  });
  assert.equal(cycle0, 1000);
});

test('second schedule cycle receives +2%', () => {
  const base = 1000;
  const cycle1 = unitPriceForScheduleCycleIndex({
    base_unit_price_before_vat: base,
    cycle_index: 1,
    ...increaseProfile,
  });
  assert.equal(cycle1, 1020);
});

test('further schedule cycles compound +2%', () => {
  const base = 1000;
  const cycle2 = unitPriceForScheduleCycleIndex({
    base_unit_price_before_vat: base,
    cycle_index: 2,
    ...increaseProfile,
  });
  assert.equal(cycle2, 1040.4);
});

test('base unit price is restored from template snapshot after scheduler advance', () => {
  const base = resolveScheduleProjectionBaseUnitPrice({
    unit_price_before_vat_reference: 1020,
    ...increaseProfile,
    document_template_snapshot: {
      draft_lines_json: [{ description: 'x', quantity: 1, unit_price_reference: 1000, currency: 'ILS' }],
    },
    completed_generation_count: 1,
  });
  assert.equal(base, 1000);
});

test('base unit price walks back profile reference when snapshot is missing', () => {
  const base = resolveScheduleProjectionBaseUnitPrice({
    unit_price_before_vat_reference: 1020,
    ...increaseProfile,
    document_template_snapshot: null,
    completed_generation_count: 1,
  });
  assert.equal(base, 1000);
});

test('schedule projection never uses next-document preview for cycle index 0', () => {
  assert.match(
    projectionServiceSource,
    /params\.cycleIndex > 0[\s\S]*nextDocumentPreview/,
  );
});

test('waiting review row exposes open_generated_draft_for_review when draft exists', () => {
  assert.match(projectionServiceSource, /open_generated_draft_for_review/);
  assert.match(projectionServiceSource, /resume_income_document_draft/);
  assert.match(projectionServiceSource, /show_status_text/);
});

test('no open_generated_draft_for_review when cycle has no generated draft', () => {
  assert.match(projectionServiceSource, /if \(!params\.cycle\?\.generated_draft_id/);
});
