import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverrideSaveScopeDialog,
  isRecurringCycleOverrideApplyScope,
  mergeOverridePayloadIntoTemplateSnapshot,
  overridePayloadFromTemplateSnapshot,
  resolveCycleOverrideForDate,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-override.pure.js';

test('override apply scope accepts single_cycle and this_and_future only', () => {
  assert.equal(isRecurringCycleOverrideApplyScope('single_cycle'), true);
  assert.equal(isRecurringCycleOverrideApplyScope('this_and_future'), true);
  assert.equal(isRecurringCycleOverrideApplyScope('next_cycle_only'), false);
});

test('save scope dialog exposes backend-owned single vs this-and-future options', () => {
  const dialog = buildOverrideSaveScopeDialog(true);
  assert.equal(dialog.option_single_cycle.key, 'single_cycle');
  assert.equal(dialog.option_this_and_future.key, 'this_and_future');
  assert.match(dialog.option_single_cycle.label, /רק למסמך הזה/);
  assert.match(dialog.option_this_and_future.label, /מהמסמך הזה והלאה/);
});

test('resolveCycleOverrideForDate returns override for exact cycle date', () => {
  const overrides = new Map([
    [
      '2026-08-20',
      {
        cycle_date: '2026-08-20',
        override_scope: 'single_cycle' as const,
        override_payload: overridePayloadFromTemplateSnapshot({
          snapshot_version: 1,
          snapshot_kind: 'recurring_document_template',
          document_type: 'deal_invoice',
          document_settings_json: {},
          draft_lines_json: [],
          notes: null,
          delivery_contact_json: null,
          document_date: '2026-07-20',
        }),
      },
    ],
  ]);
  assert.ok(resolveCycleOverrideForDate('2026-08-20', overrides));
  assert.equal(resolveCycleOverrideForDate('2026-09-20', overrides), null);
});

test('mergeOverridePayloadIntoTemplateSnapshot applies override fields only', () => {
  const base = {
    snapshot_version: 1 as const,
    snapshot_kind: 'recurring_document_template' as const,
    document_type: 'deal_invoice' as const,
    document_settings_json: { currency: 'ILS' },
    draft_lines_json: [],
    notes: 'base',
    delivery_contact_json: null,
    document_date: '2026-07-20',
  };
  const override = overridePayloadFromTemplateSnapshot({
    ...base,
    notes: 'override',
    document_settings_json: { currency: 'USD' },
  });
  const merged = mergeOverridePayloadIntoTemplateSnapshot(base, override);
  assert.equal(merged.notes, 'override');
  assert.deepEqual(merged.document_settings_json, { currency: 'USD' });
});
