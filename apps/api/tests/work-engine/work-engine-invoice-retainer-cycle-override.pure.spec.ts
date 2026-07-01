import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverrideSaveScopeDialog,
  ensureProjectionEditableLineItems,
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

test('ensureProjectionEditableLineItems enables add/update line actions for projection rows', () => {
  const step = ensureProjectionEditableLineItems({
    draft_id: 'projection:test',
    document_type_key: 'deal_invoice',
    document_discount: {
      enabled: false,
      editable: false,
      type: 'percent',
      value: '',
      currency: 'ILS',
      amount_display: null,
      percent_display: null,
      calculated_discount_amount_display: null,
      affects_vat: true,
      field_errors: {},
      allowed_actions: [],
    },
    totals_block: {
      rows: [],
      grand_total_display: '₪0.00',
      currency: 'ILS',
    },
    line_items: {
      columns: [],
      rows: [
        {
          id: 'line-1',
          line_id: 'line-1',
          row_number: 1,
          can_drag: false,
          description: { value: 'שירות', editable: false, placeholder: '' },
          quantity: { value: '1', editable: false },
          unit_price: { value: '100', editable: false },
          currency: { value: 'ILS', editable: false, options: [{ value: 'ILS', label: '₪' }] },
          allowed_currencies: [{ value: 'ILS', label: '₪' }],
          vat_rate_code: 'standard',
          vat_rate_label: 'מע״מ',
          allowed_vat_rates: [{ value: 'standard', label: 'מע״מ' }],
          price_includes_vat: false,
          price_mode_options: [],
          exchange_rate_official: null,
          exchange_rate_effective: null,
          exchange_rate_override: null,
          exchange_rate_date: null,
          exchange_rate_source_label: null,
          exchange_rate_editable: false,
          line_total_display: '₪100.00',
          line_total: { display: '₪100.00' },
          field_errors: [],
          allowed_actions: [],
        },
      ],
      allowed_actions: [],
      add_row_label: 'הוספת שורה',
      empty_state: { visible: false, message: '' },
      totals: null,
      document_fields: null,
    },
    settings_schema: [],
    notes: { value: '', editable: true },
    delivery_contact: { email: null, editable: true },
    header: { title: '', subtitle: null, document_number_preview: null },
    document_preview: null,
    document_branding_profile: null,
  } as never);

  assert.ok(step.line_items.allowed_actions.includes('add_income_document_line'));
  assert.ok(step.line_items.rows[0]?.allowed_actions.includes('update_income_document_line'));
  assert.equal(step.line_items.rows[0]?.description.editable, true);
});
