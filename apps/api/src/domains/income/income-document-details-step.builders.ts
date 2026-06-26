import type { ActiveIncomeIssuerScope } from './income.guards.js';
import {
  formatMoneyReference,
  normalizeDraftLines,
  type IncomeDraftLineRecord,
} from './income-document-draft-lines.pure.js';
import { allowedCurrencyOptions } from './income-draft-exchange-rate.pure.js';
import {
  computeDraftLineAmounts,
  recomputeDraftLineAmounts,
  resolveFxMapForDraftLines,
  resolveLineFx,
} from './income-draft-line-compute.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type DraftTotalsPreview,
  type IncomeDocumentDiscount,
  type IncomeDocumentSettings,
} from './income-document-draft-totals.pure.js';
import {
  formatDiscountAmountDisplay,
  formatDiscountPercentDisplay,
  validateDocumentDiscount,
} from './income-document-discount.pure.js';
import { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';
import {
  compactVatSelectLabel,
  readVatResolutionFromDraftPreview,
  type IncomeDraftVatResolution,
} from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import { toPublicPreviewParty } from './income-document-preview-party.pure.js';
import { buildIncomeIssuerSnapshotForScope } from './income-issuer-snapshot.service.js';
import { buildDocumentBrandingProfileAggregate, loadResolvedBrandingProfileForDocumentType } from './income-document-branding.service.js';
import { renderIncomeBrandedPreviewHtml } from './income-document-branding-preview.renderer.js';
import type { IncomeDocumentBrandingProfileAggregate } from './income-document-branding.types.js';
import { loadIncomeCustomerDefaultPaymentTerms, loadIncomeRecipientById } from './income-recipient.service.js';
import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';
import {
  incomeCustomerPaymentTermsLabel,
  INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS,
  resolveTaxInvoiceDueDate,
  type IncomeCustomerPaymentTermsKey,
} from './income-customer-payment-terms.pure.js';
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  receipt: 'קבלה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס קבלה',
  credit_tax_invoice: 'חשבונית מס זיכוי',
  deal_invoice: 'חשבונית עסקה',
  quote: 'הצעת מחיר',
};

function previewPartyAddressLine(addressJson: unknown): string | null {
  if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson)) return null;
  const o = addressJson as Record<string, unknown>;
  const parts = [o.line1, o.line2, o.city, o.zip]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function escapeHtml(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadIssuerPreviewBlock(
  scope: ActiveIncomeIssuerScope,
): Promise<IncomeDocumentPreviewPartyBlock> {
  const snap = await buildIncomeIssuerSnapshotForScope(scope);
  return toPublicPreviewParty(
    {
      display_name: snap.display_name?.trim() ? snap.display_name.trim() : scope.issuer_label,
      tax_id: snap.tax_id?.trim() ? snap.tax_id.trim() : null,
      address: previewPartyAddressLine(snap.address_json),
      phone: snap.phone?.trim() ? snap.phone.trim() : null,
      email: snap.email?.trim() ? snap.email.trim() : null,
    },
    scope.issuer_label,
  );
}

async function loadRecipientPreviewBlock(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  fallbackDisplayName: string,
): Promise<IncomeDocumentPreviewPartyBlock> {
  const snap = row.one_time_customer_snapshot_json;
  if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
    const s = snap as Record<string, unknown>;
    return toPublicPreviewParty(
      {
        display_name:
          typeof s.display_name === 'string' && s.display_name.trim()
            ? s.display_name.trim()
            : fallbackDisplayName,
        tax_id: typeof s.tax_id === 'string' && s.tax_id.trim() ? s.tax_id.trim() : null,
        address: previewPartyAddressLine(s.address_json),
        phone: typeof s.phone === 'string' && s.phone.trim() ? s.phone.trim() : null,
        email: typeof s.email === 'string' && s.email.trim() ? s.email.trim() : null,
      },
      fallbackDisplayName,
    );
  }
  if (row.income_customer_id) {
    const { data, error } = await supabaseAdmin
      .from('income_customers')
      .select('id, display_name, tax_id, phone, email, address_json')
      .eq('organization_id', scope.org_id)
      .eq('issuer_business_id', scope.issuer_business_id)
      .eq('id', row.income_customer_id)
      .maybeSingle();
    throwIfSupabaseError(error, 'loadRecipientPreviewBlock');
    const saved = data as
      | {
          display_name?: string | null;
          tax_id?: string | null;
          phone?: string | null;
          email?: string | null;
          address_json?: unknown;
        }
      | null;
    return toPublicPreviewParty(
      {
        display_name:
          saved?.display_name?.trim() ? String(saved.display_name).trim() : fallbackDisplayName,
        tax_id: saved?.tax_id?.trim() ? String(saved.tax_id).trim() : null,
        address: previewPartyAddressLine(saved?.address_json),
        phone: saved?.phone?.trim() ? String(saved.phone).trim() : null,
        email: saved?.email?.trim() ? String(saved.email).trim() : null,
      },
      fallbackDisplayName,
    );
  }
  return toPublicPreviewParty(
    {
      display_name: fallbackDisplayName,
      tax_id: null,
      address: null,
      phone: null,
      email: null,
    },
    fallbackDisplayName,
  );
}

function formatPreviewDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

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
  min_value?: string | null;
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
  exchange_rate_official: string | null;
  exchange_rate_effective: string | null;
  exchange_rate_override: { value: string; editable: boolean } | null;
  exchange_rate_date: string | null;
  exchange_rate_source_label: string | null;
  exchange_rate_editable: boolean;
  /** @deprecated use exchange_rate_official */
  exchange_rate_default?: string | null;
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

export type IncomeDocumentDetailsDiscount = {
  enabled: boolean;
  editable: boolean;
  type: 'percent' | 'fixed_amount';
  value: string;
  currency: string;
  amount_display: string | null;
  percent_display: string | null;
  calculated_discount_amount_display: string | null;
  affects_vat: true;
  field_errors: Record<string, string>;
  allowed_actions: string[];
};

export type IncomeDocumentDetailsTotalsRow = {
  key: string;
  label: string;
  amount_display: string;
  tone: 'neutral' | 'good' | 'warning' | 'danger';
  emphasized: boolean;
};

export type IncomeDocumentDetailsTotalsBlock = {
  rows: IncomeDocumentDetailsTotalsRow[];
  grand_total_display: string;
  currency: string;
};

export type IncomeDocumentDetailsStep = {
  draft_id: string;
  document_type_key?: IncomeDocumentType | null;
  document_discount: IncomeDocumentDetailsDiscount;
  totals_block: IncomeDocumentDetailsTotalsBlock;
  document_preview?: IncomeDocumentPreviewModel | null;
  draft_state_display?: {
    status: 'draft';
    label: string;
    tone: 'neutral' | 'good' | 'warning' | 'danger';
    last_saved_at: string | null;
    saved_by_label: string | null;
    allowed_actions: string[];
  };
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
  document_branding_profile: IncomeDocumentBrandingProfileAggregate | null;
};

export type IncomeDocumentPreviewValidationMessage = {
  severity: 'info' | 'warning' | 'danger';
  label: string;
  field: string | null;
  blocking: boolean;
};

export type IncomeDocumentPreviewPartyBlock = {
  display_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export type IncomeDocumentPreviewToolbarAction = {
  action: string;
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type IncomeDocumentPreviewModel = {
  visible: boolean;
  preview_status: 'ready' | 'not_generated';
  generated_at: string | null;
  document_type_label: string;
  document_number_preview: string | null;
  issuer: IncomeDocumentPreviewPartyBlock;
  recipient: IncomeDocumentPreviewPartyBlock;
  dates: { document_date: string | null; due_date: string | null };
  currency: string;
  preview_html: string;
  validation_messages: IncomeDocumentPreviewValidationMessage[];
  allowed_actions: string[];
  toolbar_actions: IncomeDocumentPreviewToolbarAction[];
};

function buildPreviewToolbarActions(): IncomeDocumentPreviewToolbarAction[] {
  return [
    { action: 'preview_export_pdf', label: 'PDF', enabled: false, reason: 'זמין לאחר הפקה' },
    { action: 'preview_print', label: 'הדפסה', enabled: false, reason: 'זמין לאחר הפקה' },
    { action: 'preview_download', label: 'הורדה', enabled: false, reason: 'זמין לאחר הפקה' },
  ];
}

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
  updated_at?: string | null;
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
  preview_generated_at: string | null;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { document_number_preview: null, recipient_display_name: null, preview_generated_at: null };
  }
  const o = raw as Record<string, unknown>;
  return {
    document_number_preview:
      typeof o.document_number_preview === 'string' ? o.document_number_preview : null,
    recipient_display_name:
      typeof o.recipient_display_name === 'string' ? o.recipient_display_name : null,
    preview_generated_at:
      typeof o.preview_generated_at === 'string' ? o.preview_generated_at : null,
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

type TaxInvoicePaymentContext = {
  paymentTermsKey: IncomeCustomerPaymentTermsKey;
  paymentTermsLabel: string;
  effectiveDueDate: string;
};

export { buildDocumentDetailsHeaderTitle } from './income-document-details-header.pure.js';

function buildSettingsSchema(
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
  vatResolution: IncomeDraftVatResolution,
  taxInvoicePayment: TaxInvoicePaymentContext | null = null,
  retainerTemplateDocumentDateMin: string | null = null,
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
      min_value: retainerTemplateDocumentDateMin,
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

  if (docType?.key === 'tax_invoice' && taxInvoicePayment) {
    fields.push({
      key: 'payment_terms',
      label: 'תנאי תשלום',
      input_type: 'select',
      value: taxInvoicePayment.paymentTermsKey,
      required: false,
      options: INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS.filter(
        (o) => o.value === taxInvoicePayment.paymentTermsKey,
      ),
      visible: true,
      disabled: true,
      disabled_reason: 'תנאי תשלום מוגדרים בפרופיל הלקוח',
    });
    fields.push({
      key: 'due_date',
      label: 'תאריך לתשלום',
      input_type: 'date',
      value: taxInvoicePayment.effectiveDueDate,
      required: false,
      visible: true,
      disabled: !canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת עריכה',
    });
  } else if (docType?.requires_due_date) {
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

async function buildLineRows(
  lines: IncomeDraftLineRecord[],
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate: string,
  canEdit: boolean,
): Promise<IncomeDocumentDetailsLineRow[]> {
  const currencyOptions = allowedCurrencyOptions();
  const allowedVatRates = lineAllowedVatRates(settings, vatResolution);
  const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);

  return lines.map((line, index) => {
    const fx = resolveLineFx(line, documentDate, officialByCurrency);
    const field_errors: { code: string; message: string }[] = [];
    let amounts = {
      line_total_ils: null as number | null,
      exchange_rate_effective: 1,
    };

    if (!fx && line.currency !== 'ILS') {
      field_errors.push({
        code: 'exchange_rate_unavailable',
        message: 'לא ניתן לטעון שער יציג מבנק ישראל לתאריך המסמך',
      });
    } else if (fx) {
      const computed = computeDraftLineAmounts(line, settings, vatResolution, fx);
      amounts = {
        line_total_ils: computed.line_total_ils,
        exchange_rate_effective: computed.exchange_rate_effective,
      };
    }

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
      exchange_rate_official: showFx ? (fx?.rate_official_display ?? null) : null,
      exchange_rate_effective: showFx ? fx?.rate_display ?? null : '1.0000',
      exchange_rate_default: showFx ? (fx?.rate_official_display ?? null) : null,
      exchange_rate_override: showFx
        ? {
            value:
              line.exchange_rate_to_ils_override != null
                ? String(line.exchange_rate_to_ils_override)
                : '',
            editable: canEdit,
          }
        : null,
      exchange_rate_date: showFx ? (fx?.exchange_rate_date ?? documentDate) : null,
      exchange_rate_source_label: showFx ? (fx?.source_label ?? null) : null,
      exchange_rate_editable: showFx && canEdit,
      line_total_display: lineTotalDisplay,
      line_total: { display: lineTotalDisplay },
      field_errors,
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
  /** Retainer / tab reads: skip embedded branding + preview HTML payloads. */
  lean?: boolean;
  /** Retainer template tab: document_date cannot be before this ISO date (today). */
  retainer_template_document_date_min?: string;
};

function buildDocumentDiscountModel(
  settings: IncomeDocumentSettings,
  totals: DraftTotalsPreview,
  canEdit: boolean,
): IncomeDocumentDetailsDiscount {
  const d: IncomeDocumentDiscount = settings.discount;
  const subtotalBefore = totals.subtotal_before_discount_reference ?? 0;
  const fieldErrors = validateDocumentDiscount(d, subtotalBefore);
  return {
    enabled: d.enabled,
    editable: canEdit,
    type: d.type,
    value: d.enabled ? String(d.value) : '',
    currency: totals.currency,
    amount_display:
      d.type === 'fixed_amount' && d.enabled
        ? formatDiscountAmountDisplay(d.value, totals.currency)
        : null,
    percent_display:
      d.type === 'percent' && d.enabled ? formatDiscountPercentDisplay(d.value) : null,
    calculated_discount_amount_display: totals.discount_amount_display,
    affects_vat: true,
    field_errors: fieldErrors,
    allowed_actions: canEdit ? ['update_income_document_discount'] : [],
  };
}

function buildTotalsBlock(
  totals: DraftTotalsPreview,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): IncomeDocumentDetailsTotalsBlock {
  const rows: IncomeDocumentDetailsTotalsRow[] = [
    {
      key: 'subtotal_before_discount',
      label: 'סכום ביניים',
      amount_display: totals.subtotal_before_discount_display,
      tone: 'neutral',
      emphasized: false,
    },
  ];
  if (totals.discount_enabled && totals.discount_amount_display) {
    rows.push({
      key: 'discount',
      label: 'הנחה לפני מע״מ',
      amount_display: `−${totals.discount_amount_display.replace(/^−/, '')}`,
      tone: 'neutral',
      emphasized: false,
    });
    rows.push({
      key: 'subtotal_after_discount',
      label: 'סכום לאחר הנחה',
      amount_display: totals.subtotal_after_discount_display,
      tone: 'neutral',
      emphasized: false,
    });
  }
  if (totals.vat_display != null) {
    rows.push({
      key: 'vat',
      label:
        settings.vat_mode === 'standard'
          ? `מע״מ (${vatResolution.standard_rate_percent_label})`
          : 'מע״מ',
      amount_display: totals.vat_display,
      tone: 'neutral',
      emphasized: false,
    });
  }
  rows.push({
    key: 'grand_total',
    label: 'סה״כ לתשלום',
    amount_display: totals.grand_total_display,
    tone: 'good',
    emphasized: true,
  });
  return {
    rows,
    grand_total_display: totals.grand_total_display,
    currency: totals.currency,
  };
}

export async function buildIncomeDocumentDetailsStep(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType | null,
  canEdit: boolean,
  options: BuildIncomeDocumentDetailsStepOptions = {},
): Promise<IncomeDocumentDetailsStep> {
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const documentDate = row.document_date ?? new Date().toISOString().slice(0, 10);
  let taxInvoicePayment: TaxInvoicePaymentContext | null = null;
  let displayDueDate = row.due_date;
  if (row.document_type === 'tax_invoice' && row.income_customer_id) {
    const paymentTerms = await loadIncomeCustomerDefaultPaymentTerms(scope, row.income_customer_id);
    if (paymentTerms) {
      const effectiveDueDate = resolveTaxInvoiceDueDate({
        documentDateIso: documentDate,
        paymentTerms,
        storedDueDate: row.due_date,
        dueDateManualOverride: settings.due_date_manual_override === true,
      });
      taxInvoicePayment = {
        paymentTermsKey: paymentTerms,
        paymentTermsLabel: incomeCustomerPaymentTermsLabel(paymentTerms),
        effectiveDueDate,
      };
      displayDueDate = effectiveDueDate;
    }
  }
  const vatResolution =
    options.vatResolution ??
    readVatResolutionFromDraftPreview(row.draft_totals_preview_json, documentDate) ??
    (await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate));
  const lines = await recomputeDraftLineAmounts(
    normalizeDraftLines(row.draft_lines_json),
    settings,
    vatResolution,
    documentDate,
  );
  const totals =
    options.totalsPreview ??
    (await computeDraftTotalsPreview(lines, 'ILS', settings, vatResolution, documentDate));

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
  recipientName = toPublicPreviewParty(
    {
      display_name: recipientName,
      tax_id: null,
      address: null,
      phone: null,
      email: null,
    },
    '—',
  ).display_name;
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

  const previewMessages: IncomeDocumentPreviewValidationMessage[] = warnings.map((w) => ({
    severity: 'warning',
    label: w.message,
    field: null,
    blocking: false,
  }));

  const previewGeneratedAt = uiCache.preview_generated_at;
  const lean = options.lean === true;
  const issuerBlock =
    !lean && previewGeneratedAt != null
      ? await loadIssuerPreviewBlock(scope)
      : {
          display_name: scope.issuer_label,
          tax_id: null,
          address: null,
          phone: null,
          email: null,
        };
  const recipientBlock =
    !lean && previewGeneratedAt != null
      ? await loadRecipientPreviewBlock(scope, row, recipientName ?? '—')
      : {
          display_name: recipientName ?? '—',
          tax_id: null,
          address: null,
          phone: null,
          email: null,
        };
  const previewLineRows =
    !lean && previewGeneratedAt != null
      ? (await buildLineRows(lines, settings, vatResolution, documentDate, false)).map((r) => ({
          row_number: r.row_number,
          description: r.description.value,
          quantity: r.quantity.value,
          unit_price: r.unit_price.value,
          currency: r.currency.value,
          vat_rate_label: r.vat_rate_label,
          total: r.line_total_display,
        }))
      : [];
  const previewVatLabel =
    totals.vat_display != null
      ? settings.vat_mode === 'standard'
        ? `מע״מ (${vatResolution.standard_rate_percent_label})`
        : 'מע״מ'
      : null;
  const brandingProfileAggregate = lean
    ? null
    : await buildDocumentBrandingProfileAggregate(scope, canEdit);
  const resolvedBranding =
    !lean && previewGeneratedAt != null && row.document_type
      ? await loadResolvedBrandingProfileForDocumentType(scope, row.document_type)
      : null;
  const previewHtml =
    !lean && previewGeneratedAt != null && resolvedBranding
      ? renderIncomeBrandedPreviewHtml({
          branding: resolvedBranding,
          docTypeLabel,
          numberPreview,
          issuer: issuerBlock,
          recipient: recipientBlock,
          document_date: row.document_date ?? null,
          due_date: displayDueDate ?? null,
          currency: row.currency,
          lineRows: previewLineRows,
          totals: {
            subtotal_before_discount: totals.subtotal_before_discount_display,
            discount:
              totals.discount_enabled && totals.discount_amount_display
                ? `−${totals.discount_amount_display.replace(/^−/, '')}`
                : null,
            subtotal_after_discount: totals.subtotal_after_discount_display,
            vat_label: previewVatLabel,
            vat: totals.vat_display ?? null,
            grand_total: totals.grand_total_display,
          },
          notes: row.notes ?? null,
          company_subtitle: resolvedBranding.company_subtitle,
        })
      : '';

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

  const documentDiscount = buildDocumentDiscountModel(settings, totals, canEdit);
  const totalsBlock = buildTotalsBlock(totals, settings, vatResolution);

  return {
    draft_id: row.id,
    document_type_key: row.document_type ?? null,
    document_discount: documentDiscount,
    totals_block: totalsBlock,
    document_branding_profile: brandingProfileAggregate,
    document_preview: {
      visible: previewGeneratedAt != null,
      preview_status: previewGeneratedAt != null ? 'ready' : 'not_generated',
      generated_at: previewGeneratedAt,
      document_type_label: docTypeLabel,
      document_number_preview: numberPreview,
      issuer: issuerBlock,
      recipient: recipientBlock,
      dates: { document_date: row.document_date ?? null, due_date: displayDueDate ?? null },
      currency: row.currency,
      preview_html: previewHtml,
      validation_messages: previewMessages,
      allowed_actions: canEdit ? ['generate_income_document_preview'] : [],
      toolbar_actions: buildPreviewToolbarActions(),
    },
    draft_state_display: {
      status: 'draft',
      label: 'טיוטה',
      tone: 'neutral',
      last_saved_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      saved_by_label: null,
      allowed_actions: canEdit ? ['save_income_document_draft'] : [],
    },
    header: {
      title: headerTitle,
      subtitle: docType?.legal_hint ?? null,
      document_number_preview: numberPreview,
    },
    settings_schema: buildSettingsSchema(
      row,
      docType,
      canEdit,
      vatResolution,
      taxInvoicePayment,
      options.retainer_template_document_date_min ?? null,
    ),
    line_items: {
      columns: [
        { key: 'drag', label: '' },
        { key: 'row_number', label: '#' },
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
      rows: await buildLineRows(lines, settings, vatResolution, documentDate, canEdit),
      allowed_actions: lineActions,
      add_row_label: '+ הוסף שורה',
      empty_state: {
        visible: lines.length === 0,
        message: 'הוסף שורה ראשונה למסמך',
      },
      totals: {
        subtotal: { label: 'סכום ביניים', display: totals.subtotal_before_discount_display },
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
