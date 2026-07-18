/**
 * Retainer — future cycle projection (read-model only; not a draft / not issued).
 */

import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import type { IncomeDocumentType } from '../income/income.types.js';
import {
  buildIncomeDocumentAllocationNumberField,
  defaultIncomeTaxAllocationNumberPolicy,
} from '../income/income-document-allocation-number.pure.js';
import type { ActiveIncomeIssuerScope } from '../income/income.guards.js';
import { findAvailableDocumentType } from '../income/income-document-types.fallback.js';
import { resolveAvailableDocumentTypes } from '../income/income-document-types.resolver.js';
import {
  buildIncomeDocumentDetailsStep,
  type IncomeWizardDraftRow,
} from '../income/income-document-details-step.builders.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  type IncomeDocumentSettings,
} from '../income/income-document-draft-totals.pure.js';
import {
  incomeDraftVatFallbackResolution,
  type IncomeDraftVatResolution,
} from '../income/income-draft-vat-fallback.pure.js';
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

/** Projection totals use IL fallback VAT — not financial truth; avoids Country Pack round-trip per keystroke. */
function resolveProjectionDraftVat(): IncomeDraftVatResolution {
  return incomeDraftVatFallbackResolution();
}

/** Drop heavy preview payloads from client refresh commands. */
export function sanitizeProjectionStepForRefresh(
  step: IncomeDocumentDetailsStep,
): IncomeDocumentDetailsStep {
  return {
    ...step,
    document_preview: null,
    header: {
      ...step.header,
      document_number_preview: null,
    },
  };
}

function retainerTemplateDocumentType(
  documentType: RecurringDocumentTemplateSnapshot['document_type'],
): 'quote' | 'deal_invoice' | 'tax_invoice' {
  if (documentType === 'quote' || documentType === 'deal_invoice' || documentType === 'tax_invoice') {
    return documentType;
  }
  return 'deal_invoice';
}

/**
 * Build editor base step from profile template snapshot only — no template draft workspace load.
 */
export async function buildProjectionBaseStepFromTemplateSnapshot(params: {
  ctx: RequestContext;
  representedClientId: string;
  endCustomerId: string;
  snapshot: RecurringDocumentTemplateSnapshot;
}): Promise<IncomeDocumentDetailsStep> {
  const scope = await loadActiveIncomeIssuerScope(params.ctx);
  if (scope.represented_client_id !== params.representedClientId) {
    throw forbidden('Office client issuer context required');
  }
  const documentType = retainerTemplateDocumentType(params.snapshot.document_type);
  const row: IncomeWizardDraftRow = {
    id: `projection-template:${params.endCustomerId}`,
    document_type: documentType,
    document_date: params.snapshot.document_date,
    due_date: params.snapshot.due_date,
    notes: params.snapshot.notes,
    currency: params.snapshot.currency,
    language: params.snapshot.language,
    draft_lines_json: params.snapshot.draft_lines_json,
    payment_received_json: null,
    delivery_contact_json: params.snapshot.delivery_contact_json,
    document_settings_json: params.snapshot.document_settings_json,
    validation_warnings_json: [],
    draft_totals_preview_json: {
      discount_percent_reference: params.snapshot.discount_percent_reference,
      discount_amount_reference: params.snapshot.discount_amount_reference,
    },
    income_customer_id: params.endCustomerId,
    one_time_customer_snapshot_json: null,
  };
  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  const docType = findAvailableDocumentType(available_document_types, documentType) ?? null;
  return buildIncomeDocumentDetailsStep(scope, row, docType, true, { lean: true });
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
  const fromStep = parseDocumentSettingsJson({
    ...(snapshot?.document_settings_json ?? {}),
    vat_mode:
      step.line_items.document_fields?.vat_mode?.value ??
      (snapshot?.document_settings_json as Record<string, unknown> | undefined)?.vat_mode ??
      'standard',
    discount: step.document_discount.enabled
      ? {
          enabled: true,
          type: step.document_discount.type,
          value: Number(step.document_discount.value) || 0,
        }
      : { enabled: false, type: 'percent', value: 0 },
  });
  return fromStep;
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
    step.line_items.rows.map((row) => {
      const unitPrice = parseUnitPrice(row.unit_price.value);
      return {
        line_id: String(row.line_id || row.id || '').trim() || `projection-row-${row.row_number}`,
        sort_index: row.row_number,
        description: row.description.value,
        quantity: Number(row.quantity.value) || 1,
        unit_price_reference: Number.isFinite(unitPrice) ? unitPrice : null,
        currency: row.currency.value,
        exchange_rate_to_ils_override: row.exchange_rate_override?.value
          ? Number(row.exchange_rate_override.value)
          : null,
        price_includes_vat: row.price_includes_vat,
        vat_rate_code: row.vat_rate_code,
      };
    }),
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
  const rows = step.line_items.rows.map((row, index) => {
    const lineKey = String(row.line_id || row.id || '').trim();
    const line =
      (lineKey ? lines.find((item) => item.line_id === lineKey) : null) ?? lines[index] ?? null;
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
  const vatResolution = resolveProjectionDraftVat();
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
  const vatResolution = resolveProjectionDraftVat();
  const sanitized = sanitizeProjectionStepForRefresh(params.step);
  const refreshed = await rebuildProjectedLineTotals(
    sanitized,
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
    vat_display: '—',
    vat_rate_label: row.vat_rate_label,
    total: row.line_total_display,
  }));

  const totals = params.step.totals_block;
  const vatRow = totals.rows.find((row) => row.key === 'vat');
  const discountRow = totals.rows.find((row) => row.key === 'discount');
  const subtotalBefore = totals.rows.find((row) => row.key === 'subtotal_before_discount');
  const subtotalAfter = totals.rows.find((row) => row.key === 'subtotal_after_discount');
  const allocationField = params.step.document_preview?.allocation_number_field;

  const previewHtml = renderIncomeBrandedPreviewHtml({
    branding,
    docTypeLabel: RETAINER_DOC_TYPE_LABELS[documentType],
    document_type: documentType,
    numberPreview: null,
    issuer,
    recipient,
    document_date: documentDate,
    due_date: dueDate,
    allocation_number_visible: allocationField?.visible ?? false,
    allocation_number_display: allocationField?.display_value ?? null,
    allocation_number_value_empty: !allocationField?.value?.trim(),
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
      allocation_number_field:
        step.document_preview?.allocation_number_field ??
        buildIncomeDocumentAllocationNumberField({
          policy: defaultIncomeTaxAllocationNumberPolicy(),
          documentType: (step.document_type_key as IncomeDocumentType | null) ?? null,
          value: null,
          canEdit: false,
          isIssued: false,
        }),
    },
  };
}
