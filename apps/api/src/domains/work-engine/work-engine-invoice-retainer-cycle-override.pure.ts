/**
 * Recurring cycle overrides — pure helpers (projection-only, no Accounting Base).
 */

import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import { parseDocumentSettingsJson } from '../income/income-document-draft-totals.pure.js';
import type { IncomeDocumentType } from '../income/income.types.js';
import type { RecurringDocumentTemplateSnapshot } from './work-engine-invoice-retainer-draft.service.js';

function retainerOverrideDocumentType(
  documentType: IncomeDocumentType,
): 'quote' | 'deal_invoice' | 'tax_invoice' {
  if (documentType === 'quote' || documentType === 'deal_invoice' || documentType === 'tax_invoice') {
    return documentType;
  }
  return 'deal_invoice';
}

export type RecurringCycleOverrideScope = 'single_cycle' | 'this_and_future';

export type RecurringCycleOverrideApplyScope = RecurringCycleOverrideScope;

export type RecurringCycleOverridePayload = {
  snapshot_version: 1;
  snapshot_kind: 'recurring_cycle_override';
  document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
  document_settings_json: Record<string, unknown>;
  draft_lines_json: unknown[];
  notes: string | null;
  delivery_contact_json: Record<string, unknown> | null;
};

export type RecurringCycleOverrideRow = {
  cycle_date: string;
  override_scope: RecurringCycleOverrideScope;
  override_payload: RecurringCycleOverridePayload;
};

export function isRecurringCycleOverrideApplyScope(value: string): value is RecurringCycleOverrideApplyScope {
  return value === 'single_cycle' || value === 'this_and_future';
}

export function overridePayloadFromTemplateSnapshot(
  snapshot: RecurringDocumentTemplateSnapshot,
): RecurringCycleOverridePayload {
  return {
    snapshot_version: 1,
    snapshot_kind: 'recurring_cycle_override',
    document_type: retainerOverrideDocumentType(snapshot.document_type),
    document_settings_json: snapshot.document_settings_json,
    draft_lines_json: snapshot.draft_lines_json,
    notes: snapshot.notes,
    delivery_contact_json: snapshot.delivery_contact_json,
  };
}

export function overridePayloadFromDocumentDetailsStep(
  step: IncomeDocumentDetailsStep,
): RecurringCycleOverridePayload {
  const documentType = step.document_type_key;
  if (documentType !== 'quote' && documentType !== 'deal_invoice' && documentType !== 'tax_invoice') {
    throw new Error('document_type_key is required for override payload');
  }
  const settings: Record<string, unknown> = {};
  for (const field of step.settings_schema) {
    if (field.value != null && field.value !== '') {
      settings[field.key] = field.value;
    }
  }
  const draft_lines_json = normalizeDraftLines(
    step.line_items.rows.map((row) => ({
      line_id: row.line_id,
      sort_index: row.row_number,
      description: row.description.value,
      quantity: Number(row.quantity.value) || 1,
      unit_price_reference: Number(String(row.unit_price.value).replace(/,/g, '')) || null,
      currency: row.currency.value,
      exchange_rate_to_ils_override: row.exchange_rate_override?.value
        ? Number(row.exchange_rate_override.value)
        : null,
      price_includes_vat: row.price_includes_vat,
      vat_rate_code: row.vat_rate_code,
    })),
  );
  const deliveryEmail = step.delivery_contact?.email ?? null;
  const delivery_contact_json = deliveryEmail ? { email: deliveryEmail } : null;
  return {
    snapshot_version: 1,
    snapshot_kind: 'recurring_cycle_override',
    document_type: documentType,
    document_settings_json: settings,
    draft_lines_json,
    notes: step.notes?.value ?? null,
    delivery_contact_json,
  };
}

export function mergeOverridePayloadIntoTemplateSnapshot(
  base: RecurringDocumentTemplateSnapshot,
  override: RecurringCycleOverridePayload | null | undefined,
): RecurringDocumentTemplateSnapshot {
  if (!override) return base;
  return {
    ...base,
    document_type: override.document_type,
    document_settings_json: override.document_settings_json,
    draft_lines_json: override.draft_lines_json,
    notes: override.notes,
    delivery_contact_json: override.delivery_contact_json,
  };
}

export function resolveCycleOverrideForDate(
  cycleDate: string,
  overridesByDate: ReadonlyMap<string, RecurringCycleOverrideRow>,
): RecurringCycleOverrideRow | null {
  return overridesByDate.get(cycleDate) ?? null;
}

export function buildOverrideSaveScopeDialog(visible: boolean) {
  return {
    title: 'להחיל על',
    prompt: 'בחר כיצד לשמור את השינויים במסמך העתידי:',
    option_single_cycle: {
      key: 'single_cycle' as const,
      label: 'רק למסמך הזה',
      description: 'שמירת שינוי חד-פעמי למחזור זה בלבד.',
    },
    option_this_and_future: {
      key: 'this_and_future' as const,
      label: 'מהמסמך הזה והלאה',
      description: 'עדכון תבנית הריטיינר לכל המחזורים מהתאריך הזה.',
    },
    confirm_label: 'שמירה',
    cancel_label: 'ביטול',
    persistence_note: visible
      ? 'השינויים נשמרים כהגדרות תצוגה עתידית בלבד — ללא יצירת טיוטה או מסמך.'
      : null,
  };
}
