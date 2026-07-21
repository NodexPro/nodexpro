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
const primaryActionSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-primary-action.pure.ts'),
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

test('waiting review row exposes generated_draft_review primary action when draft exists', () => {
  assert.match(projectionServiceSource, /resolveScheduleRowPrimaryAction/);
  assert.match(projectionServiceSource, /row_interaction_kind: rowInteraction\.row_interaction_kind/);
  assert.match(projectionServiceSource, /primary_action: rowInteraction\.primary_action/);
  assert.match(projectionServiceSource, /show_status_text/);
});

test('no primary action when cycle has no generated draft', () => {
  assert.match(primaryActionSource, /!params\.generated_draft_id/);
});

test('schedule projection resolves VAT once and skips future rebuild without override', () => {
  assert.match(projectionServiceSource, /scheduleVatResolution = await resolveIncomeDraftVatForOrg/);
  assert.match(projectionServiceSource, /amountByCycleIndex/);
  assert.match(projectionServiceSource, /vatResolution: scheduleVatResolution/);
  assert.match(
    projectionServiceSource,
    /row_interaction_kind === 'future_projection'[\s\S]*params\.templateBaseStep[\s\S]*cycleOverride/,
  );
  assert.doesNotMatch(
    projectionServiceSource,
    /await resolveIncomeDraftVatForOrg\(params\.orgId, 'IL', params\.documentDate\)/,
  );
});

test('retainer setup omits template snapshots from client and parallelizes schedule loads', () => {
  const readModelSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.read-model.service.ts'),
    'utf8',
  );
  assert.match(readModelSource, /document_template_snapshot: null, \/\* Server-only/);
  assert.match(readModelSource, /loadProfileTemplateSnapshot/);
  assert.match(readModelSource, /load_cycles_work_items_overrides/);
  assert.match(readModelSource, /Promise\.all\(\[\s*loadRecurringProfileCycles/);
});
