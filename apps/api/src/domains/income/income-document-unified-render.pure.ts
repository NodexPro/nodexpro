/**
 * Canonical Income document render model — shared by HTML preview and PDF generation.
 */

import type { IncomeBrandingResolvedProfile } from './income-document-branding.types.js';
import type {
  IncomeBrandingPreviewLineRow,
  IncomeBrandingPreviewParty,
  IncomeBrandingPreviewTotals,
} from './income-document-branding-preview.renderer.js';
import { documentTypeLabel } from './income-pdf-template.resolver.js';
import { formatMoneyReference, normalizeDraftLines } from './income-document-draft-lines.pure.js';
import { toPublicPreviewParty } from './income-document-preview-party.pure.js';
import type { IncomeDocumentType } from './income.types.js';

export type UnifiedIncomeDocumentRenderInput = {
  branding: IncomeBrandingResolvedProfile;
  docTypeLabel: string;
  numberPreview: string | null;
  issuer: IncomeBrandingPreviewParty;
  recipient: IncomeBrandingPreviewParty;
  document_date: string | null;
  due_date: string | null;
  payment_terms_display?: string | null;
  payment_link_url?: string | null;
  payment_qr_data_url?: string | null;
  currency: string;
  lineRows: IncomeBrandingPreviewLineRow[];
  totals: IncomeBrandingPreviewTotals;
  notes: string | null;
  company_subtitle: string | null;
};

export function previewPartyAddressLine(addressJson: unknown): string | null {
  if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson)) return null;
  const o = addressJson as Record<string, unknown>;
  const parts = [o.line1, o.line2, o.city, o.zip]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function partyFromIssuerSnapshot(
  issuer: Record<string, unknown>,
  fallbackDisplayName: string,
  website?: string | null,
): IncomeBrandingPreviewParty {
  const contactName =
    typeof issuer.contact_name === 'string' && issuer.contact_name.trim()
      ? issuer.contact_name.trim()
      : null;
  return toPublicPreviewParty(
    {
      display_name:
        typeof issuer.display_name === 'string' && issuer.display_name.trim()
          ? issuer.display_name.trim()
          : typeof issuer.legal_name === 'string' && issuer.legal_name.trim()
            ? issuer.legal_name.trim()
            : fallbackDisplayName,
      tax_id: issuer.tax_id != null ? String(issuer.tax_id).trim() || null : null,
      address: previewPartyAddressLine(issuer.address_json),
      phone: issuer.phone != null ? String(issuer.phone).trim() || null : null,
      email: issuer.email != null ? String(issuer.email).trim() || null : null,
      website: website?.trim() ? website.trim() : null,
      contact_name: contactName,
    },
    fallbackDisplayName,
  );
}

export function partyFromCustomerSnapshot(
  customer: Record<string, unknown>,
  fallbackDisplayName = '—',
): IncomeBrandingPreviewParty {
  const contactName =
    typeof customer.contact_name === 'string' && customer.contact_name.trim()
      ? customer.contact_name.trim()
      : null;
  return toPublicPreviewParty(
    {
      display_name:
        typeof customer.display_name === 'string' && customer.display_name.trim()
          ? customer.display_name.trim()
          : fallbackDisplayName,
      tax_id: customer.tax_id != null ? String(customer.tax_id).trim() || null : null,
      address: previewPartyAddressLine(customer.address_json),
      phone: customer.phone != null ? String(customer.phone).trim() || null : null,
      email: customer.email != null ? String(customer.email).trim() || null : null,
      contact_name: contactName,
    },
    fallbackDisplayName,
  );
}

function lineVatLabelFromCode(
  vatRateCode: unknown,
  fallbackLabel: string | null,
): string {
  if (vatRateCode === 'exempt') return 'פטור';
  return fallbackLabel?.trim() ? fallbackLabel.trim() : 'מע״מ';
}

function readOptionalString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

export function lineRowsFromLinesSnapshot(
  linesSnapshot: unknown[],
  currency: string,
  totalsSnapshot: Record<string, unknown> | null,
): IncomeBrandingPreviewLineRow[] {
  const rawArr = Array.isArray(linesSnapshot) ? linesSnapshot : [];
  const lines = normalizeDraftLines(rawArr);
  const vatFallback = readOptionalString(totalsSnapshot?.vat_rate_label);
  return lines.map((line, index) => {
    const rawObj =
      rawArr[index] && typeof rawArr[index] === 'object' && !Array.isArray(rawArr[index])
        ? (rawArr[index] as Record<string, unknown>)
        : {};
    const lineCurrency = line.currency || currency;
    const unitLabel = readOptionalString(rawObj.unit_label);
    const lineDiscount = readOptionalString(rawObj.discount_display);
    const amountRef =
      line.amount_reference != null && Number.isFinite(line.amount_reference)
        ? line.amount_reference
        : line.unit_price_reference != null && Number.isFinite(line.unit_price_reference)
          ? line.quantity * line.unit_price_reference
          : null;
    const lineVatAmount =
      readOptionalString(rawObj.vat_display) ??
      readOptionalString(rawObj.line_vat_display) ??
      readOptionalString(rawObj.vat_amount_display);
    return {
      row_number: index + 1,
      description: line.description || '—',
      quantity: String(line.quantity),
      unit: unitLabel,
      unit_price:
        line.unit_price_reference != null
          ? formatMoneyReference(line.unit_price_reference, lineCurrency)
          : '—',
      discount: lineDiscount,
      currency: lineCurrency,
      vat_rate_label: lineVatAmount ?? lineVatLabelFromCode(line.vat_rate_code, vatFallback),
      total: formatMoneyReference(amountRef, 'ILS'),
    };
  });
}

export function totalsFromTotalsSnapshot(
  totalsSnapshot: Record<string, unknown> | null,
): IncomeBrandingPreviewTotals {
  const t = totalsSnapshot ?? {};
  const discountRaw = readOptionalString(t.discount_amount_display);
  const discountEnabled = t.discount_enabled === true;
  return {
    subtotal_before_discount:
      readOptionalString(t.subtotal_before_discount_display) ??
      readOptionalString(t.subtotal_display) ??
      '—',
    discount: discountEnabled && discountRaw ? discountRaw : null,
    subtotal_after_discount: readOptionalString(t.subtotal_after_discount_display) ?? '—',
    vat_label: readOptionalString(t.vat_rate_label) ?? 'מע״מ',
    vat: readOptionalString(t.vat_display),
    grand_total: readOptionalString(t.grand_total_display) ?? '—',
  };
}

export function buildUnifiedIncomeDocumentRenderInput(params: {
  branding: IncomeBrandingResolvedProfile;
  document_type: IncomeDocumentType;
  language: string | null;
  document_number: string;
  document_date: string;
  due_date: string | null;
  currency: string;
  notes: string | null;
  payment_terms_display?: string | null;
  payment_link_url?: string | null;
  payment_qr_data_url?: string | null;
  issuer_snapshot_json: Record<string, unknown>;
  customer_snapshot_json: Record<string, unknown>;
  lines_snapshot_json: unknown[];
  totals_snapshot_json: Record<string, unknown> | null;
  issuer_website?: string | null;
  issuer_fallback_label?: string;
}): UnifiedIncomeDocumentRenderInput {
  const language = params.language === 'en' ? 'en' : 'he';
  const issuerFallback = params.issuer_fallback_label?.trim() || '—';
  return {
    branding: params.branding,
    docTypeLabel: documentTypeLabel(params.document_type, language),
    numberPreview: params.document_number,
    issuer: partyFromIssuerSnapshot(params.issuer_snapshot_json, issuerFallback, params.issuer_website),
    recipient: partyFromCustomerSnapshot(params.customer_snapshot_json),
    document_date: params.document_date,
    due_date: params.due_date,
    payment_terms_display: params.payment_terms_display ?? null,
    payment_link_url: params.payment_link_url ?? null,
    payment_qr_data_url: params.payment_qr_data_url ?? null,
    currency: params.currency,
    lineRows: lineRowsFromLinesSnapshot(
      params.lines_snapshot_json,
      params.currency,
      params.totals_snapshot_json,
    ),
    totals: totalsFromTotalsSnapshot(params.totals_snapshot_json),
    notes: params.notes?.trim() || null,
    company_subtitle: params.branding.company_subtitle,
  };
}

export function buildUnifiedIncomeDocumentRenderAuditSnapshot(
  input: UnifiedIncomeDocumentRenderInput,
): Record<string, unknown> {
  return {
    renderer: 'unified_income_document_v1',
    doc_type_label: input.docTypeLabel,
    number_preview: input.numberPreview,
    document_date: input.document_date,
    due_date: input.due_date,
    payment_terms_display: input.payment_terms_display ?? null,
    line_count: input.lineRows.length,
    has_notes: Boolean(input.notes?.trim()),
    has_payment_link: Boolean(input.payment_link_url?.trim()),
    issuer_display_name: input.issuer.display_name,
    recipient_display_name: input.recipient.display_name,
    totals: input.totals,
    not_financial_truth: true,
  };
}
