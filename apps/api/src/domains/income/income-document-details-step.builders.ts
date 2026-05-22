import type { ActiveIncomeIssuerScope } from './income.guards.js';
import {
  formatMoneyReference,
  normalizeDraftLines,
  type IncomeDraftLineRecord,
} from './income-document-draft-lines.pure.js';
import {
  allowedCurrencyOptions,
  resolveDraftExchangeRateToIls,
} from './income-draft-exchange-rate.pure.js';
import { computeDraftLineAmounts } from './income-draft-line-compute.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type DraftTotalsPreview,
  type IncomeDocumentSettings,
} from './income-document-draft-totals.pure.js';
import { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';
import {
  compactVatSelectLabel,
  readVatResolutionFromDraftPreview,
  type IncomeDraftVatResolution,
} from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import { loadIncomeRecipientById } from './income-recipient.service.js';
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

export type IncomeDocumentDetailsSelectField = {
  input_type: 'select';
  value: string;
  options: { value: string; label: string }[];
  editable: boolean;
  disabled_reason: string | null;
};

export type IncomeDocumentDetailsLineRow = {
  id: string;
  row_number: number;
  can_drag: boolean;
  description: { value: string; editable: boolean; placeholder: string };
  quantity: { value: string; editable: boolean };
  unit_price: { value: string; editable: boolean };
  currency: {
    value: string;
    editable: boolean;
    options: { value: string; label: string }[];
  };
  allowed_currencies: { value: string; label: string }[];
  vat_rate_code: string;
  vat_rate_label: string;
  allowed_vat_rates: { value: string; label: string }[];
  price_includes_vat: boolean;
  price_mode_options: { value: boolean; label: string }[];
  exchange_rate_default: string | null;
  exchange_rate_override: { value: string; editable: boolean } | null;
  exchange_rate_source_label: string | null;
  exchange_rate_editable: boolean;
  line_total_display: string;
  field_errors: { code: string; message: string }[];
  allowed_actions: string[];
  /** @deprecated use id */
  line_id: string;
  /** @deprecated use line_total_display */
  line_total: { display: string };
};

export type IncomeDocumentDetailsLineTableFields = {
  currency: IncomeDocumentDetailsSelectField;
  vat_mode: IncomeDocumentDetailsSelectField;
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
    document_fields: IncomeDocumentDetailsLineTableFields;
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
  draft_totals_preview_json?: unknown;
  income_customer_id: string | null;
  one_time_customer_snapshot_json: Record<string, unknown> | null;
};

const CURRENCY_OPTIONS = [
  { value: 'ILS', label: '₪' },
  { value: 'USD', label: '$' },
  { value: 'EUR', label: '€' },
] as const;

function effectiveVatModeForUi(vatMode: IncomeDocumentSettings['vat_mode']): 'standard' | 'exempt' {
  return vatMode === 'standard' ? 'standard' : 'exempt';
}

function buildDocumentLineTableFields(
  row: IncomeWizardDraftRow,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  canEdit: boolean,
): IncomeDocumentDetailsLineTableFields {
  const vatUi = effectiveVatModeForUi(settings.vat_mode);
  return {
    currency: {
      input_type: 'select',
      value: row.currency,
      options: [...CURRENCY_OPTIONS],
      editable: canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
    vat_mode: {
      input_type: 'select',
      value: vatUi,
      options: [
        { value: 'standard', label: compactVatSelectLabel(vatResolution) },
        { value: 'exempt', label: 'פטור' },
      ],
      editable: canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    },
  };
}

function readWizardUiCacheFromDraftPreview(raw: unknown): {
  document_number_preview: string | null;
  recipient_display_name: string | null;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { document_number_preview: null, recipient_display_name: null };
  }
  const o = raw as Record<string, unknown>;
  return {
    document_number_preview:
      typeof o.document_number_preview === 'string' ? o.document_number_preview : null,
    recipient_display_name:
      typeof o.recipient_display_name === 'string' ? o.recipient_display_name : null,
  };
}

function recipientDisplayNameFromRow(row: IncomeWizardDraftRow): string | null {
  const snap = row.one_time_customer_snapshot_json;
  if (snap && typeof snap.display_name === 'string' && snap.display_name.trim()) {
    return snap.display_name.trim();
  }
  return null;
}

async function resolveRecipientDisplayName(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
): Promise<string> {
  if (row.income_customer_id) {
    const customer = await loadIncomeRecipientById(scope, row.income_customer_id);
    if (customer?.display_name?.trim()) return customer.display_name.trim();
  }
  const snap = row.one_time_customer_snapshot_json;
  if (snap && typeof snap.display_name === 'string' && snap.display_name.trim()) {
    return snap.display_name.trim();
  }
  return '—';
}

export { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';

function buildSettingsSchema(
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
  vatResolution: IncomeDraftVatResolution,
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
      visible: false,
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
      label: 'מע״מ מסמך',
      input_type: 'select',
      value: effectiveVatModeForUi(settings.vat_mode),
      required: true,
      options: [
        { value: 'standard', label: vatResolution.standard_vat_mode_option_label },
        { value: 'exempt', label: 'פטור ממע״מ' },
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

const PRICE_MODE_OPTIONS: { value: boolean; label: string }[] = [
  { value: false, label: 'לפני מע״מ' },
  { value: true, label: 'כולל מע״מ' },
];

function lineAllowedVatRates(
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): { value: string; label: string }[] {
  if (settings.vat_mode === 'exempt') {
    return [{ value: 'exempt', label: 'פטור' }];
  }
  return [
    { value: 'standard', label: compactVatSelectLabel(vatResolution) },
    { value: 'exempt', label: 'פטור' },
  ];
}

function buildLineRows(
  lines: IncomeDraftLineRecord[],
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate: string,
  canEdit: boolean,
): IncomeDocumentDetailsLineRow[] {
  const currencyOptions = allowedCurrencyOptions();
  const allowedVatRates = lineAllowedVatRates(settings, vatResolution);

  return lines.map((line, index) => {
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, documentDate);
    const fxDefault = resolveDraftExchangeRateToIls(line.currency, documentDate, null);
    const fxEffective = resolveDraftExchangeRateToIls(
      line.currency,
      documentDate,
      line.exchange_rate_to_ils_override,
    );
    const vatLabel =
      allowedVatRates.find((o) => o.value === line.vat_rate_code)?.label ??
      (line.vat_rate_code === 'exempt' ? 'פטור' : compactVatSelectLabel(vatResolution));
    const lineTotalDisplay = formatMoneyReference(amounts.line_total_ils, 'ILS');
    const showFx = line.currency !== 'ILS';

    return {
      id: line.line_id,
      line_id: line.line_id,
      row_number: index + 1,
      can_drag: canEdit && lines.length > 1,
      description: {
        value: line.description,
        editable: canEdit,
        placeholder: 'תיאור שירות או מוצר',
      },
      quantity: { value: String(line.quantity), editable: canEdit },
      unit_price: {
        value: line.unit_price_reference != null ? String(line.unit_price_reference) : '',
        editable: canEdit,
      },
      currency: {
        value: line.currency,
        editable: canEdit,
        options: currencyOptions.map((o) => ({ value: o.value, label: o.label })),
      },
      allowed_currencies: currencyOptions.map((o) => ({ value: o.value, label: o.label })),
      vat_rate_code: line.vat_rate_code,
      vat_rate_label: vatLabel,
      allowed_vat_rates: allowedVatRates,
      price_includes_vat: line.price_includes_vat,
      price_mode_options: PRICE_MODE_OPTIONS,
      exchange_rate_default: showFx ? fxDefault.rate_display : null,
      exchange_rate_override: showFx
        ? {
            value:
              line.exchange_rate_to_ils_override != null
                ? String(line.exchange_rate_to_ils_override)
                : '',
            editable: canEdit,
          }
        : null,
      exchange_rate_source_label: showFx ? fxEffective.source_label : null,
      exchange_rate_editable: showFx && canEdit,
      line_total_display: lineTotalDisplay,
      line_total: { display: lineTotalDisplay },
      field_errors: [],
      allowed_actions: canEdit
        ? [
            'update_income_document_line',
            'delete_income_document_line',
            'reorder_income_document_lines',
          ]
        : [],
    };
  });
}

export type BuildIncomeDocumentDetailsStepOptions = {
  vatResolution?: IncomeDraftVatResolution;
  totalsPreview?: DraftTotalsPreview;
};

export async function buildIncomeDocumentDetailsStep(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
  options: BuildIncomeDocumentDetailsStepOptions = {},
): Promise<IncomeDocumentDetailsStep> {
  const lines = normalizeDraftLines(row.draft_lines_json);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const documentDate = row.document_date ?? new Date().toISOString().slice(0, 10);
  const vatResolution =
    options.vatResolution ??
    readVatResolutionFromDraftPreview(row.draft_totals_preview_json, documentDate) ??
    (await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate));
  const totals =
    options.totalsPreview ??
    computeDraftTotalsPreview(lines, row.currency, settings, vatResolution);

  const uiCache = readWizardUiCacheFromDraftPreview(row.draft_totals_preview_json);

  const docTypeLabel =
    row.document_type && DOCUMENT_TYPE_LABELS[row.document_type]
      ? DOCUMENT_TYPE_LABELS[row.document_type]
      : 'מסמך';
  let numberPreview = uiCache.document_number_preview;
  if (!numberPreview && row.document_type != null) {
    numberPreview = await previewNextIncomeDocumentNumber(scope, row.document_type);
  }
  let recipientName = uiCache.recipient_display_name ?? recipientDisplayNameFromRow(row);
  if (!recipientName) {
    recipientName = await resolveRecipientDisplayName(scope, row);
  }
  const headerTitle = buildDocumentDetailsHeaderTitle(scope, docTypeLabel, numberPreview, recipientName);

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
      title: headerTitle,
      subtitle: docType?.legal_hint ?? null,
      document_number_preview: numberPreview,
    },
    settings_schema: buildSettingsSchema(row, docType, canEdit, vatResolution),
    line_items: {
      columns: [
        { key: 'row_number', label: '#' },
        { key: 'drag', label: '' },
        { key: 'description', label: 'פירוט *' },
        { key: 'quantity', label: 'כמות *' },
        { key: 'unit_price', label: "מחיר ליח'" },
        { key: 'currency', label: 'מטבע' },
        { key: 'vat', label: 'מע״מ' },
        { key: 'confirm', label: '' },
        { key: 'line_total', label: 'סה״כ' },
        { key: 'delete', label: '' },
      ],
      document_fields: buildDocumentLineTableFields(row, settings, vatResolution, canEdit),
      rows: buildLineRows(lines, settings, vatResolution, documentDate, canEdit),
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
            ? {
                label:
                  settings.vat_mode === 'standard'
                    ? `מע״מ (${vatResolution.standard_rate_percent_label})`
                    : 'מע״מ',
                display: totals.vat_display,
              }
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
