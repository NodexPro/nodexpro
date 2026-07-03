/**
 * Recurring cycle overrides — pure helpers (projection-only, no Accounting Base).
 */

import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import { parseDocumentSettingsJson } from '../income/income-document-draft-totals.pure.js';
import type { IncomeDocumentType } from '../income/income.types.js';
import type { RecurringDocumentTemplateSnapshot } from './work-engine-invoice-retainer-draft.service.js';
import type {
  WorkEngineRecurringCycleOverrideSidebarField,
  WorkEngineRecurringCycleOverrideSidebarSection,
  WorkEngineRecurringCycleOverrideRetainerSettingsSidebar,
  WorkEngineInvoiceRetainerSettings,
} from './work-engine-invoice-retainer.types.js';
import {
  RECURRING_FREQUENCY_LABELS,
  RECURRING_FREQUENCY_OPTIONS,
  computeDraftCreationDateIso,
  computeNextUnitPriceBeforeVat,
  formatHebrewDateDisplay,
  type RecurringDocumentFrequency,
  type RecurringPriceIncreaseType,
  type RecurringProfileStatus,
} from './work-engine-invoice-retainer.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';

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

const RETAINER_DOC_TYPE_LABELS: Record<'quote' | 'deal_invoice' | 'tax_invoice', string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
};

const STATUS_LABELS: Record<RecurringProfileStatus, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  cancelled: 'מבוטל',
};

const STATUS_DESCRIPTIONS: Record<RecurringProfileStatus, string> = {
  active: 'הריטיינר ייצור טיוטות לפי התזמון',
  paused: 'לא ייווצרו טיוטות עד להפעלה מחדש',
  cancelled: 'הריטיינר נסגר ולא יפעל',
};

const ADVANCE_CREATION_HELP_TEXT =
  'כמה ימים לפני תאריך המסמך ליצור טיוטה לבדיקה';

const DRAFT_CREATION_DATE_LABEL = 'תאריך יצירת טיוטה צפוי';

const DOCUMENT_TYPE_CHANGE_NOTE =
  'שינוי סוג מסמך יחול על טיוטות עתידיות בלבד. מסמכים שכבר הופקו לא ישתנו.';

export function buildCycleOverrideRetainerSettingsSidebar(params: {
  profile: {
    id: string;
    end_customer_id: string;
    document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
    frequency: RecurringDocumentFrequency;
    advance_days: number;
    service_period_start: string;
    service_period_end: string;
    auto_advance_period: boolean;
    price_increase_enabled: boolean;
    price_increase_type: RecurringPriceIncreaseType | null;
    price_increase_value: number | null;
    status: RecurringProfileStatus;
    next_document_date: string;
    unit_price_before_vat_reference: number;
    currency: string;
    source_draft_template_id: string | null;
    document_template_snapshot: RecurringDocumentTemplateSnapshot | null;
  };
  endCustomerDisplayName: string;
  cycleDate: string;
  documentTypeOptions: WorkEngineRecurringCycleOverrideRetainerSettingsSidebar['document_type_options'];
}): WorkEngineRecurringCycleOverrideRetainerSettingsSidebar {
  const profile = params.profile;
  const frequency = profile.frequency;
  const advanceDays = profile.advance_days;
  const priceIncreaseEnabled = profile.price_increase_enabled;
  const priceIncreaseType = priceIncreaseEnabled ? profile.price_increase_type : null;
  const priceIncreaseValue = priceIncreaseEnabled ? profile.price_increase_value : null;
  const nextCyclePrice = computeNextUnitPriceBeforeVat({
    current_unit_price_before_vat_reference: profile.unit_price_before_vat_reference,
    price_increase_enabled: priceIncreaseEnabled,
    price_increase_type: priceIncreaseType,
    price_increase_value: priceIncreaseValue,
  });
  const status = profile.status;

  const retainer_settings: WorkEngineInvoiceRetainerSettings = {
    profile_id: profile.id,
    end_customer_id: profile.end_customer_id,
    end_customer_display_name: params.endCustomerDisplayName,
    source_draft_template_id: profile.source_draft_template_id,
    document_template_snapshot: profile.document_template_snapshot,
    document_type: profile.document_type,
    document_type_label: RETAINER_DOC_TYPE_LABELS[profile.document_type],
    document_type_change_note: DOCUMENT_TYPE_CHANGE_NOTE,
    frequency,
    frequency_label: RECURRING_FREQUENCY_LABELS[frequency],
    advance_days: advanceDays,
    advance_creation_help_text: ADVANCE_CREATION_HELP_TEXT,
    draft_creation_date_label: DRAFT_CREATION_DATE_LABEL,
    draft_creation_date_display: formatHebrewDateDisplay(
      computeDraftCreationDateIso(params.cycleDate, advanceDays),
    ),
    service_period_start: profile.service_period_start,
    service_period_start_display: formatHebrewDateDisplay(profile.service_period_start),
    service_period_end: profile.service_period_end,
    service_period_end_display: formatHebrewDateDisplay(profile.service_period_end),
    auto_advance_period: profile.auto_advance_period,
    price_increase_enabled: priceIncreaseEnabled,
    price_increase_type: priceIncreaseType,
    price_increase_value: priceIncreaseValue,
    next_cycle_unit_price_before_vat_display: priceIncreaseEnabled
      ? formatMoneyReference(nextCyclePrice, profile.currency)
      : null,
    status,
    status_label: STATUS_LABELS[status],
    status_description: STATUS_DESCRIPTIONS[status],
    next_document_date: profile.next_document_date,
    next_document_date_display: formatHebrewDateDisplay(profile.next_document_date),
    last_generated_draft_id: null,
    last_generated_at: null,
    last_generated_at_display: null,
  };

  return {
    retainer_settings,
    document_type_options: params.documentTypeOptions,
    frequency_options: [...RECURRING_FREQUENCY_OPTIONS],
    status_actions: {
      can_pause: status === 'active',
      can_resume: status === 'paused',
      can_cancel: status !== 'cancelled',
      pause_label: 'השהה ריטיינר',
      resume_label: 'חידוש ריטיינר',
      cancel_label: 'ביטול ריטיינר',
    },
  };
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

function mapSidebarField(
  field: IncomeDocumentDetailsStep['settings_schema'][number],
): WorkEngineRecurringCycleOverrideSidebarField {
  return {
    key: field.key,
    label: field.label,
    input_type:
      field.input_type === 'select'
        ? 'select'
        : field.input_type === 'date'
          ? 'date'
          : 'text',
    value: field.value,
    editable: !field.disabled,
    disabled_reason: field.disabled_reason,
    hint: null,
    options: field.options ?? [],
    required: field.required,
    min_value: field.min_value ?? null,
  };
}

export function buildCycleOverrideSidebarSections(
  step: IncomeDocumentDetailsStep,
): WorkEngineRecurringCycleOverrideSidebarSection[] {
  const sections: WorkEngineRecurringCycleOverrideSidebarSection[] = [];

  const paymentTerms = step.settings_schema.find((field) => field.key === 'payment_terms');
  if (paymentTerms?.visible) {
    sections.push({
      key: 'payment_terms',
      title: 'תנאי תשלום',
      fields: [mapSidebarField(paymentTerms)],
    });
  }

  const documentSettings = step.settings_schema.filter(
    (field) => field.visible && field.key !== 'payment_terms',
  );
  if (documentSettings.length > 0) {
    sections.push({
      key: 'document_settings',
      title: 'הגדרות מסמך',
      fields: documentSettings.map(mapSidebarField),
    });
  }

  if (step.notes) {
    sections.push({
      key: 'notes',
      title: step.notes.label,
      fields: [
        {
          key: 'notes',
          label: step.notes.label,
          input_type: 'textarea',
          value: step.notes.value,
          editable: step.notes.editable,
          disabled_reason: null,
          hint: null,
          options: [],
          required: false,
          min_value: null,
        },
      ],
    });
  }

  if (step.delivery_contact) {
    sections.push({
      key: 'delivery_contact',
      title: step.delivery_contact.label,
      fields: [
        {
          key: 'delivery_contact_email',
          label: step.delivery_contact.label,
          input_type: 'email',
          value: step.delivery_contact.email,
          editable: step.delivery_contact.editable,
          disabled_reason: null,
          hint: step.delivery_contact.hint,
          options: [],
          required: false,
          min_value: null,
        },
      ],
    });
  }

  return sections;
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

const PROJECTION_LINE_ITEM_ACTIONS = [
  'add_income_document_line',
  'update_income_document_line',
  'delete_income_document_line',
  'reorder_income_document_lines',
] as const;

const PROJECTION_LINE_ROW_ACTIONS = [
  'update_income_document_line',
  'delete_income_document_line',
] as const;

export function ensureProjectionEditableLineItems(
  step: IncomeDocumentDetailsStep,
): IncomeDocumentDetailsStep {
  return {
    ...step,
    line_items: {
      ...step.line_items,
      allowed_actions: [...PROJECTION_LINE_ITEM_ACTIONS],
      rows: step.line_items.rows.map((row) => ({
        ...row,
        description: { ...row.description, editable: true },
        quantity: { ...row.quantity, editable: true },
        unit_price: { ...row.unit_price, editable: true },
        currency: { ...row.currency, editable: true },
        allowed_actions: row.allowed_actions.includes('update_income_document_line')
          ? row.allowed_actions
          : [...PROJECTION_LINE_ROW_ACTIONS],
      })),
    },
    document_discount: {
      ...step.document_discount,
      editable: true,
      allowed_actions: step.document_discount.allowed_actions.includes(
        'update_income_document_discount',
      )
        ? step.document_discount.allowed_actions
        : ['update_income_document_discount'],
    },
  };
}
