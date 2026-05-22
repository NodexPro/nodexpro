import type { ActiveIncomeIssuerScope } from './income.guards.js';
import {
  formatMoneyReference,
  normalizeDraftLines,
  type IncomeDraftLineRecord,
} from './income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type DraftTotalsPreview,
} from './income-document-draft-totals.pure.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  receipt: 'קבלה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס קבלה',
  credit_tax_invoice: 'חשבונית מס זיכוי',
  deal_invoice: 'חשבונית עסקה',
  quote: 'הצעת מחיר',
};

export type IncomeDocumentDetailsSettingField = {
  key: string;
  label: string;
  input_type: 'date' | 'select' | 'text';
  value: string | null;
  required: boolean;
  options?: { value: string; label: string }[];
  visible: boolean;
  disabled: boolean;
  disabled_reason: string | null;
};

export type IncomeDocumentDetailsLineRow = {
  line_id: string;
  row_number: number;
  description: { value: string; editable: boolean };
  quantity: { value: string; editable: boolean };
  unit_price: { value: string; display: string; editable: boolean };
  vat: { label: string };
  line_total: { display: string };
  allowed_actions: string[];
};

export type IncomeDocumentDetailsStep = {
  draft_id: string;
  header: {
    title: string;
    subtitle: string | null;
    document_number_preview: string | null;
  };
  settings_schema: IncomeDocumentDetailsSettingField[];
  line_items: {
    columns: { key: string; label: string }[];
    rows: IncomeDocumentDetailsLineRow[];
    allowed_actions: string[];
    add_row_label: string;
    empty_state: { visible: boolean; message: string };
    totals: {
      subtotal: { label: string; display: string };
      vat: { label: string; display: string } | null;
      grand_total: { label: string; display: string };
      currency: string;
      not_financial_truth: boolean;
    };
  };
  notes: { value: string; label: string; editable: boolean };
  delivery_contact: {
    email: string | null;
    label: string;
    editable: boolean;
    hint: string | null;
  };
  validation_warnings: { code: string; message: string }[];
};

export type IncomeWizardDraftRow = {
  id: string;
  document_type: IncomeDocumentType | null;
  document_date: string | null;
  due_date: string | null;
  notes: string | null;
  currency: string;
  language: string;
  draft_lines_json: unknown;
  payment_received_json: Record<string, unknown> | null;
  delivery_contact_json: Record<string, unknown> | null;
  document_settings_json: unknown;
  validation_warnings_json: unknown;
  income_customer_id: string | null;
  one_time_customer_snapshot_json: Record<string, unknown> | null;
};

function issuerDisplayName(scope: ActiveIncomeIssuerScope): string {
  return scope.represented_client_label ?? scope.issuer_label;
}

function buildSettingsSchema(
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
): IncomeDocumentDetailsSettingField[] {
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const paymentNote =
    row.payment_received_json && typeof row.payment_received_json.note === 'string'
      ? row.payment_received_json.note
      : '';

  const fields: IncomeDocumentDetailsSettingField[] = [
    {
      key: 'document_date',
      label: 'תאריך מסמך',
      input_type: 'date',
      value: row.document_date,
      required: true,
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
    {
      key: 'currency',
      label: 'מטבע',
      input_type: 'select',
      value: row.currency,
      required: true,
      options: [
        { value: 'ILS', label: '₪ שקל' },
        { value: 'USD', label: '$ דולר' },
        { value: 'EUR', label: '€ אירו' },
      ],
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
    {
      key: 'language',
      label: 'שפה',
      input_type: 'select',
      value: row.language,
      required: true,
      options: [
        { value: 'he', label: 'עברית' },
        { value: 'en', label: 'English' },
      ],
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
    {
      key: 'vat_mode',
      label: 'סוג מע״מ',
      input_type: 'select',
      value: settings.vat_mode,
      required: true,
      options: [
        { value: 'standard', label: 'מע״מ רגיל (17%)' },
        { value: 'exempt', label: 'פטור ממע״מ' },
        { value: 'zero', label: 'מע״מ אפס' },
      ],
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
    {
      key: 'amount_rounding',
      label: 'עיגול סכום',
      input_type: 'select',
      value: settings.amount_rounding,
      required: false,
      options: [
        { value: 'none', label: 'ללא עיגול' },
        { value: 'nearest_agora', label: 'עיגול לאגורה' },
      ],
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
  ];

  if (docType?.requires_due_date) {
    fields.push({
      key: 'due_date',
      label: 'תאריך לתשלום',
      input_type: 'date',
      value: row.due_date,
      required: false,
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    });
  }

  if (docType?.requires_payment_received) {
    fields.push({
      key: 'payment_received_note',
      label: 'פרטי תשלום',
      input_type: 'text',
      value: paymentNote || null,
      required: false,
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    });
  }

  return fields;
}

function buildLineRows(
  lines: IncomeDraftLineRecord[],
  totals: DraftTotalsPreview,
  canEdit: boolean,
): IncomeDocumentDetailsLineRow[] {
  const vatLabel = totals.vat_rate_label ?? '—';
  return lines.map((line, index) => ({
    line_id: line.line_id,
    row_number: index + 1,
    description: { value: line.description, editable: canEdit },
    quantity: { value: String(line.quantity), editable: canEdit },
    unit_price: {
      value: line.unit_price_reference != null ? String(line.unit_price_reference) : '',
      display: formatMoneyReference(line.unit_price_reference, totals.currency),
      editable: canEdit,
    },
    vat: { label: vatLabel },
    line_total: {
      display: formatMoneyReference(line.amount_reference, totals.currency),
    },
    allowed_actions: canEdit ? ['update_income_document_line', 'delete_income_document_line'] : [],
  }));
}

export async function buildIncomeDocumentDetailsStep(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
): Promise<IncomeDocumentDetailsStep> {
  const lines = normalizeDraftLines(row.draft_lines_json);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const totals = computeDraftTotalsPreview(lines, row.currency, settings);

  const docTypeLabel =
    row.document_type && DOCUMENT_TYPE_LABELS[row.document_type]
      ? DOCUMENT_TYPE_LABELS[row.document_type]
      : 'מסמך';
  const issuerName = issuerDisplayName(scope);
  const numberPreview =
    row.document_type != null
      ? await previewNextIncomeDocumentNumber(scope, row.document_type)
      : null;

  const warnings = Array.isArray(row.validation_warnings_json)
    ? (row.validation_warnings_json as { code?: string; message?: string }[])
        .filter((w) => w && typeof w === 'object')
        .map((w) => ({
          code: String(w.code ?? 'warning'),
          message: String(w.message ?? ''),
        }))
        .filter((w) => w.message)
    : [];

  const deliveryEmail =
    row.delivery_contact_json && typeof row.delivery_contact_json.email === 'string'
      ? row.delivery_contact_json.email
      : null;

  const lineActions = canEdit
    ? [
        'add_income_document_line',
        'update_income_document_line',
        'delete_income_document_line',
        'reorder_income_document_lines',
      ]
    : [];

  return {
    draft_id: row.id,
    header: {
      title: `הפקת ${docTypeLabel} עבור ${issuerName}`,
      subtitle: docType?.legal_hint ?? null,
      document_number_preview: numberPreview,
    },
    settings_schema: buildSettingsSchema(row, docType, canEdit),
    line_items: {
      columns: [
        { key: 'row_number', label: '#' },
        { key: 'description', label: 'תיאור' },
        { key: 'quantity', label: 'כמות' },
        { key: 'unit_price', label: 'מחיר ליח׳' },
        { key: 'vat', label: 'מע״מ' },
        { key: 'line_total', label: 'סה״כ' },
        { key: 'actions', label: 'פעולות' },
      ],
      rows: buildLineRows(lines, totals, canEdit),
      allowed_actions: lineActions,
      add_row_label: '+ הוסף שורה',
      empty_state: {
        visible: lines.length === 0,
        message: 'הוסף שורה ראשונה למסמך',
      },
      totals: {
        subtotal: { label: 'סכום ביניים', display: totals.subtotal_display },
        vat:
          totals.vat_display != null
            ? { label: 'מע״מ', display: totals.vat_display }
            : null,
        grand_total: { label: 'סה״כ לתשלום', display: totals.grand_total_display },
        currency: totals.currency,
        not_financial_truth: true,
      },
    },
    notes: {
      value: row.notes ?? '',
      label: 'הערות שיופיעו במסמך',
      editable: canEdit,
    },
    delivery_contact: {
      email: deliveryEmail,
      label: 'אימייל למשלוח המסמך',
      editable: canEdit,
      hint: 'נשמר כצילום למסמך — לא מעדכן את כרטיס הלקוח במערכת',
    },
    validation_warnings: warnings,
  };
}
