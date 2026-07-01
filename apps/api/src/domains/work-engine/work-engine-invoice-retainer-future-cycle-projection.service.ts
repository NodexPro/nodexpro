/**
 * Retainer — future cycle projection (read-model only; not a draft / not issued).
 */

import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import type { ActiveIncomeIssuerScope } from '../income/income.guards.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type IncomeDocumentSettings,
} from '../income/income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import type { IncomeDraftVatResolution } from '../income/income-draft-vat-fallback.pure.js';
import { computeDraftLineAmounts, resolveLineFx, resolveFxMapForDraftLines } from '../income/income-draft-line-compute.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import {
  computeDueDateFromPaymentTerms,
  isIncomeCustomerPaymentTermsKey,
} from '../income/income-customer-payment-terms.pure.js';
import { loadResolvedBrandingProfileForDocumentType } from '../income/income-document-branding.service.js';
import { renderIncomeBrandedPreviewHtml } from '../income/income-document-branding-preview.renderer.js';
import { buildIncomeIssuerSnapshotForScope } from '../income/income-issuer-snapshot.service.js';
import { loadIncomeRecipientById } from '../income/income-recipient.service.js';
import { toPublicPreviewParty } from '../income/income-document-preview-party.pure.js';
import type { IncomeDocumentPreviewPartyBlock } from '../income/income-document-details-step.builders.js';
import {
  computeNextUnitPriceBeforeVat,
  formatHebrewDateDisplay,
  type RecurringPriceIncreaseType,
} from './work-engine-invoice-retainer.pure.js';
import type { RecurringDocumentTemplateSnapshot } from './work-engine-invoice-retainer-draft.service.js';
import {
  mergeOverridePayloadIntoTemplateSnapshot,
  type RecurringCycleOverridePayload,
  ensureProjectionEditableLineItems,
} from './work-engine-invoice-retainer-cycle-override.pure.js';

function previewPartyAddressLine(addressJson: unknown): string | null {
  if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson)) return null;
  const o = addressJson as Record<string, unknown>;
  const parts = [o.line1, o.line2, o.city, o.zip]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const RETAINER_DOC_TYPE_LABELS: Record<'quote' | 'deal_invoice' | 'tax_invoice', string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
};

type RawProfile = {
  id: string;
  end_customer_id: string;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | null;
  price_increase_value: number | null;
  document_template_snapshot: RecurringDocumentTemplateSnapshot | null;
};

function cloneStep(step: IncomeDocumentDetailsStep): IncomeDocumentDetailsStep {
  return structuredClone(step);
}

function parseUnitPrice(value: string): number {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

function formatUnitPrice(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

function applyPriceIncreaseToLinesForCycleIndex(
  step: IncomeDocumentDetailsStep,
  profile: RawProfile,
  cycleIndex: number,
): IncomeDocumentDetailsStep {
  if (!profile.price_increase_enabled || cycleIndex <= 0) return step;
  let current = step;
  for (let i = 0; i < cycleIndex; i += 1) {
    const rows = current.line_items.rows.map((row, index) => {
      const currentPrice = parseUnitPrice(row.unit_price.value);
      const next =
        profile.price_increase_type === 'amount' && index > 0
          ? currentPrice
          : computeNextUnitPriceBeforeVat({
              current_unit_price_before_vat_reference: currentPrice,
              price_increase_enabled: profile.price_increase_enabled,
              price_increase_type: profile.price_increase_type,
              price_increase_value: profile.price_increase_value,
            });
      return {
        ...row,
        unit_price: { ...row.unit_price, value: formatUnitPrice(next) },
      };
    });
    current = {
      ...current,
      line_items: { ...current.line_items, rows },
    };
  }
  return current;
}

function resolveProjectionSettings(
  step: IncomeDocumentDetailsStep,
  snapshot: RecurringDocumentTemplateSnapshot | null,
): IncomeDocumentSettings {
  const fromSnapshot = snapshot?.document_settings_json ?? null;
  if (fromSnapshot) return parseDocumentSettingsJson(fromSnapshot);
  const vatMode = step.line_items.document_fields?.vat_mode?.value ?? 'standard';
  return parseDocumentSettingsJson({ vat_mode: vatMode, discount: { enabled: false, type: 'percent', value: 0 } });
}

function buildTotalsBlock(
  totals: Awaited<ReturnType<typeof computeDraftTotalsPreview>>,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): IncomeDocumentDetailsStep['totals_block'] {
  const rows: IncomeDocumentDetailsStep['totals_block']['rows'] = [
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

async function rebuildProjectedLineTotals(
  step: IncomeDocumentDetailsStep,
  orgId: string,
  documentDate: string,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): Promise<IncomeDocumentDetailsStep> {
  const lines = normalizeDraftLines(
    step.line_items.rows.map((row) => ({
      line_id: row.line_id,
      sort_index: row.row_number,
      description: row.description.value,
      quantity: Number(row.quantity.value) || 1,
      unit_price_reference: parseUnitPrice(row.unit_price.value) || null,
      currency: row.currency.value,
      exchange_rate_to_ils_override: row.exchange_rate_override?.value
        ? Number(row.exchange_rate_override.value)
        : null,
      price_includes_vat: row.price_includes_vat,
      vat_rate_code: row.vat_rate_code,
    })),
  );
  const currency = step.line_items.document_fields?.currency?.value ?? step.totals_block.currency ?? 'ILS';
  const totalsPreview = await computeDraftTotalsPreview(
    lines,
    currency,
    settings,
    vatResolution,
    documentDate,
  );
  const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);
  const rows = step.line_items.rows.map((row) => {
    const line = lines.find((item) => item.line_id === row.line_id);
    if (!line) return row;
    const fx = resolveLineFx(line, documentDate, officialByCurrency);
    if (!fx) return row;
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, fx);
    const display =
      amounts.line_net_ils != null
        ? formatMoneyReference(amounts.line_net_ils, totalsPreview.currency)
        : row.line_total_display;
    return {
      ...row,
      line_total_display: display,
      line_total: { display },
    };
  });
  const totalsBlock = buildTotalsBlock(totalsPreview, settings, vatResolution);
  return {
    ...step,
    totals_block: totalsBlock,
    line_items: {
      ...step.line_items,
      rows,
      totals: {
        subtotal: { label: 'סכום ביניים', display: totalsPreview.subtotal_before_discount_display },
        vat: totalsPreview.vat_display
          ? { label: 'מע״מ', display: totalsPreview.vat_display }
          : null,
        grand_total: { label: 'סה״כ לתשלום', display: totalsPreview.grand_total_display },
        currency: totalsPreview.currency,
        not_financial_truth: true,
      },
    },
    document_discount: {
      ...step.document_discount,
      calculated_discount_amount_display: totalsPreview.discount_amount_display,
    },
  };
}

function stripProjectionDocumentNumbers(step: IncomeDocumentDetailsStep): IncomeDocumentDetailsStep {
  return {
    ...step,
    header: {
      ...step.header,
      document_number_preview: null,
      subtitle: null,
    },
    document_preview: null,
  };
}

function applyCycleDocumentDate(step: IncomeDocumentDetailsStep, cycleDate: string): IncomeDocumentDetailsStep {
  const paymentTermsRaw = step.settings_schema.find((field) => field.key === 'payment_terms')?.value;
  const paymentTermsKey =
    paymentTermsRaw && isIncomeCustomerPaymentTermsKey(paymentTermsRaw) ? paymentTermsRaw : null;
  const computedDueDate =
    paymentTermsKey && step.document_type_key === 'tax_invoice'
      ? computeDueDateFromPaymentTerms(cycleDate, paymentTermsKey)
      : null;
  const settingsSchema = step.settings_schema.map((field) => {
    if (field.key === 'document_date') {
      return { ...field, value: cycleDate, disabled: true };
    }
    if (field.key === 'due_date' && computedDueDate) {
      return { ...field, value: computedDueDate };
    }
    return field;
  });
  return {
    ...step,
    settings_schema: settingsSchema,
    header: {
      ...step.header,
      title: 'עריכת מסמך עתידי',
      subtitle: formatHebrewDateDisplay(cycleDate),
      document_number_preview: null,
    },
    draft_state_display: undefined,
    document_preview: null,
  };
}

function applyOverridePayloadToStep(
  step: IncomeDocumentDetailsStep,
  override: RecurringCycleOverridePayload | null | undefined,
): IncomeDocumentDetailsStep {
  if (!override) return step;
  const settings = parseDocumentSettingsJson(override.document_settings_json);
  const settingsSchema = step.settings_schema.map((field) => {
    const value = (override.document_settings_json as Record<string, unknown>)[field.key];
    if (value == null) return field;
    return { ...field, value: String(value) };
  });
  const lines = normalizeDraftLines(override.draft_lines_json);
  const rows = step.line_items.rows.map((row, index) => {
    const line = lines[index];
    if (!line) return row;
    return {
      ...row,
      description: { ...row.description, value: line.description ?? '' },
      quantity: { ...row.quantity, value: String(line.quantity ?? 1) },
      unit_price: {
        ...row.unit_price,
        value: line.unit_price_reference != null ? String(line.unit_price_reference) : '',
      },
      currency: { ...row.currency, value: line.currency ?? row.currency.value },
      price_includes_vat: line.price_includes_vat ?? row.price_includes_vat,
      vat_rate_code: line.vat_rate_code ?? row.vat_rate_code,
    };
  });
  return {
    ...step,
    document_type_key: override.document_type,
    settings_schema: settingsSchema,
    notes: step.notes ? { ...step.notes, value: override.notes ?? '' } : step.notes,
    line_items: {
      ...step.line_items,
      rows,
      document_fields: {
        ...step.line_items.document_fields,
        vat_mode: step.line_items.document_fields?.vat_mode
          ? { ...step.line_items.document_fields.vat_mode, value: settings.vat_mode }
          : step.line_items.document_fields?.vat_mode,
      },
    },
  };
}

export async function buildFutureCycleProjectionStep(params: {
  orgId: string;
  profile: RawProfile;
  baseStep: IncomeDocumentDetailsStep;
  cycleDate: string;
  cycleIndex: number;
  overridePayload?: RecurringCycleOverridePayload | null;
}): Promise<IncomeDocumentDetailsStep> {
  const snapshot = params.profile.document_template_snapshot;
  const effectiveSnapshot =
    snapshot && params.overridePayload
      ? mergeOverridePayloadIntoTemplateSnapshot(snapshot, params.overridePayload)
      : snapshot;
  const projectedDocumentType =
    params.baseStep.document_type_key === 'quote' ||
    params.baseStep.document_type_key === 'deal_invoice' ||
    params.baseStep.document_type_key === 'tax_invoice'
      ? params.baseStep.document_type_key
      : (effectiveSnapshot?.document_type ?? 'deal_invoice');

  let step = stripProjectionDocumentNumbers(cloneStep(params.baseStep));
  step.draft_id = `projection:${params.profile.id}:${params.cycleDate}:${projectedDocumentType}`;
  step = applyCycleDocumentDate(step, params.cycleDate);
  if (params.overridePayload) {
    step = applyOverridePayloadToStep(step, params.overridePayload);
  }
  step = applyPriceIncreaseToLinesForCycleIndex(step, params.profile, params.cycleIndex);
  step = stripProjectionDocumentNumbers(step);

  const settings = resolveProjectionSettings(step, effectiveSnapshot);
  const vatResolution = await resolveIncomeDraftVatForOrg(params.orgId, 'IL', params.cycleDate);
  step = await rebuildProjectedLineTotals(step, params.orgId, params.cycleDate, settings, vatResolution);
  return ensureProjectionEditableLineItems(step);
}

export async function refreshFutureCycleProjectionStepTotals(params: {
  orgId: string;
  step: IncomeDocumentDetailsStep;
  snapshot: RecurringDocumentTemplateSnapshot | null;
}): Promise<IncomeDocumentDetailsStep> {
  const documentDate =
    params.step.settings_schema.find((field) => field.key === 'document_date')?.value ?? null;
  if (!documentDate) return params.step;
  const settings = resolveProjectionSettings(params.step, params.snapshot);
  const vatResolution = await resolveIncomeDraftVatForOrg(params.orgId, 'IL', documentDate);
  const refreshed = await rebuildProjectedLineTotals(
    params.step,
    params.orgId,
    documentDate,
    settings,
    vatResolution,
  );
  return ensureProjectionEditableLineItems(refreshed);
}

export async function renderFutureCycleProjectionPreview(params: {
  scope: ActiveIncomeIssuerScope;
  profile: RawProfile;
  step: IncomeDocumentDetailsStep;
}): Promise<{
  previewHtml: string;
  issuer: IncomeDocumentPreviewPartyBlock;
  recipient: IncomeDocumentPreviewPartyBlock;
  documentTypeLabel: string;
}> {
  const documentType = params.step.document_type_key;
  if (
    documentType !== 'quote' &&
    documentType !== 'deal_invoice' &&
    documentType !== 'tax_invoice'
  ) {
    return {
      previewHtml: '',
      issuer: { display_name: '—', tax_id: null, address: null, phone: null, email: null },
      recipient: { display_name: '—', tax_id: null, address: null, phone: null, email: null },
      documentTypeLabel: '',
    };
  }
  const branding = await loadResolvedBrandingProfileForDocumentType(params.scope, documentType);
  if (!branding) {
    return {
      previewHtml: '',
      issuer: { display_name: '—', tax_id: null, address: null, phone: null, email: null },
      recipient: { display_name: '—', tax_id: null, address: null, phone: null, email: null },
      documentTypeLabel: RETAINER_DOC_TYPE_LABELS[documentType],
    };
  }

  const issuerSnapshot = await buildIncomeIssuerSnapshotForScope(params.scope);
  const recipientRow = await loadIncomeRecipientById(params.scope, params.profile.end_customer_id);
  const issuer = toPublicPreviewParty({
    display_name: issuerSnapshot.display_name,
    tax_id: issuerSnapshot.tax_id,
    address: previewPartyAddressLine(issuerSnapshot.address_json),
    phone: issuerSnapshot.phone,
    email: issuerSnapshot.email,
  });
  const recipient = toPublicPreviewParty({
    display_name: recipientRow?.display_name ?? '—',
    tax_id: recipientRow?.tax_id ?? null,
    address: recipientRow?.address_line ?? null,
    phone: recipientRow?.phone ?? null,
    email: recipientRow?.email ?? null,
  });

  const documentDate =
    params.step.settings_schema.find((field) => field.key === 'document_date')?.value ?? null;
  const dueDate = params.step.settings_schema.find((field) => field.key === 'due_date')?.value ?? null;

  const lineRows = params.step.line_items.rows.map((row) => ({
    row_number: row.row_number,
    description: row.description.value,
    quantity: row.quantity.value,
    unit_price: row.unit_price.value,
    currency: row.currency.value,
    vat_rate_label: row.vat_rate_label,
    total: row.line_total_display,
  }));

  const totals = params.step.totals_block;
  const vatRow = totals.rows.find((row) => row.key === 'vat');
  const discountRow = totals.rows.find((row) => row.key === 'discount');
  const subtotalBefore = totals.rows.find((row) => row.key === 'subtotal_before_discount');
  const subtotalAfter = totals.rows.find((row) => row.key === 'subtotal_after_discount');

  const previewHtml = renderIncomeBrandedPreviewHtml({
    branding,
    docTypeLabel: RETAINER_DOC_TYPE_LABELS[documentType],
    numberPreview: null,
    issuer,
    recipient,
    document_date: documentDate,
    due_date: dueDate,
    currency: totals.currency,
    lineRows,
    totals: {
      subtotal_before_discount: subtotalBefore?.amount_display ?? '',
      discount: discountRow?.amount_display ?? null,
      subtotal_after_discount: subtotalAfter?.amount_display ?? subtotalBefore?.amount_display ?? '',
      vat_label: vatRow?.label ?? null,
      vat: vatRow?.amount_display ?? null,
      grand_total: totals.grand_total_display,
    },
    notes: params.step.notes?.value ?? null,
    company_subtitle: branding.company_subtitle,
  });

  return {
    previewHtml,
    issuer,
    recipient,
    documentTypeLabel: RETAINER_DOC_TYPE_LABELS[documentType],
  };
}

export async function attachFutureCycleProjectionPreview(
  step: IncomeDocumentDetailsStep,
  preview: {
    previewHtml: string;
    issuer: IncomeDocumentPreviewPartyBlock;
    recipient: IncomeDocumentPreviewPartyBlock;
    documentTypeLabel: string;
  },
): Promise<IncomeDocumentDetailsStep> {
  const generatedAt = new Date().toISOString();
  const documentDate = step.settings_schema.find((field) => field.key === 'document_date')?.value ?? null;
  const dueDate = step.settings_schema.find((field) => field.key === 'due_date')?.value ?? null;
  return {
    ...step,
    document_preview: {
      visible: true,
      preview_status: 'ready',
      generated_at: generatedAt,
      document_type_label: preview.documentTypeLabel,
      document_number_preview: null,
      issuer: preview.issuer,
      recipient: preview.recipient,
      dates: {
        document_date: documentDate,
        due_date: dueDate,
      },
      currency: step.totals_block.currency,
      preview_html: preview.previewHtml,
      validation_messages: [],
      allowed_actions: ['preview_recurring_cycle_override'],
      toolbar_actions: [],
    },
  };
}
