import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCycleOverrideSidebarSections } from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-override.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const overrideModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineRecurringCycleOverrideModal.tsx'),
  'utf8',
);
const schedulePanelSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSchedulePanel.tsx'),
  'utf8',
);

test('future override modal sidebar includes document settings sections and debounced totals refresh', () => {
  assert.ok(overrideModalSource.includes('WorkEngineRecurringCycleOverrideSidebar'));
  assert.ok(overrideModalSource.includes('aggregate.sidebar_sections'));
  assert.ok(overrideModalSource.includes('linesOnly'));
  assert.ok(overrideModalSource.includes('TOTALS_REFRESH_DEBOUNCE_MS'));
  assert.ok(overrideModalSource.includes('scheduleTotalsRefresh'));
  assert.ok(!overrideModalSource.includes('busy={busy || projectionRefreshing}'));
  assert.ok(overrideModalSource.includes('setPreviewOpen(true)'));
  assert.ok(overrideModalSource.includes('setPreviewBusy(true)'));
  assert.ok(overrideModalSource.includes('WorkEngineRecurringCycleOverrideSaveDialog'));
});

test('preview opens before backend command completes', () => {
  const previewStart = overrideModalSource.indexOf('const handlePreview');
  const block = overrideModalSource.slice(previewStart, previewStart + 900);
  const openIdx = block.indexOf('setPreviewOpen(true)');
  const commandIdx = block.indexOf('executeWorkEngineInvoiceRetainerCommand');
  assert.ok(openIdx >= 0);
  assert.ok(commandIdx > openIdx);
});

test('schedule panel sidebar remains unchanged', () => {
  assert.ok(!schedulePanelSource.includes('sidebar_sections'));
  assert.ok(!schedulePanelSource.includes('WorkEngineRecurringCycleOverrideSidebar'));
});

test('buildCycleOverrideSidebarSections includes payment terms, document settings, notes, delivery', () => {
  const sections = buildCycleOverrideSidebarSections({
    draft_id: 'projection:test',
    document_type_key: 'tax_invoice',
    document_discount: {
      enabled: false,
      editable: true,
      type: 'percent',
      value: '',
      currency: 'ILS',
      amount_display: null,
      percent_display: null,
      calculated_discount_amount_display: null,
      affects_vat: true,
      field_errors: {},
      allowed_actions: ['update_income_document_discount'],
    },
    totals_block: { rows: [], grand_total_display: '₪0.00', currency: 'ILS' },
    line_items: {
      columns: [],
      rows: [],
      allowed_actions: [],
      add_row_label: 'הוספת שורה',
      empty_state: { visible: false, message: '' },
      totals: null,
      document_fields: null,
    },
    settings_schema: [
      {
        key: 'payment_terms',
        label: 'תנאי תשלום',
        input_type: 'select',
        value: 'net_30',
        required: false,
        options: [{ value: 'net_30', label: 'שוטף + 30' }],
        visible: true,
        disabled: false,
        disabled_reason: null,
      },
      {
        key: 'document_date',
        label: 'תאריך מסמך',
        input_type: 'date',
        value: '2026-08-20',
        required: true,
        visible: true,
        disabled: true,
        disabled_reason: null,
        min_value: null,
      },
    ],
    notes: { label: 'הערות', value: 'הערה', editable: true },
    delivery_contact: {
      label: 'דוא״ל למשלוח',
      email: 'a@b.com',
      editable: true,
      hint: 'אופציונלי',
    },
    header: { title: '', subtitle: null, document_number_preview: null },
    document_preview: null,
    document_branding_profile: null,
    validation_warnings: [],
  } as never);

  const keys = sections.map((section) => section.key);
  assert.deepEqual(keys, ['payment_terms', 'document_settings', 'notes', 'delivery_contact']);
});
