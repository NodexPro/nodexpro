/**
 * Assemble unified Income document render model for issued documents (PDF / delivery).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import { loadClientOperationsCoreClient } from '../client-operations/client-operations-client-core.read.js';
import { loadResolvedBrandingProfileForDocumentType } from './income-document-branding.service.js';
import {
  buildUnifiedIncomeDocumentRenderInput,
  lineRowsFromLinesSnapshotForRender,
  mergePreviewPartyPreferringSnapshot,
  partyFromCustomerSnapshot,
  previewPartyAddressLine,
  type UnifiedIncomeDocumentRenderInput,
} from './income-document-unified-render.pure.js';
import { incomeCustomerPaymentTermsLabel, isIncomeCustomerPaymentTermsKey } from './income-customer-payment-terms.pure.js';
import type { IncomeDocumentType } from './income.types.js';
import { parseDocumentSettingsJson } from './income-document-draft-totals.pure.js';
import { readVatResolutionFromDraftPreview } from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import {
  isAllocationNumberApplicable,
} from './income-document-allocation-number.pure.js';
import { resolveIncomeTaxAllocationNumberPolicyForOrg } from './income-document-allocation-number-resolver.js';
import { buildIncomeIssuerSnapshotForScope } from './income-issuer-snapshot.service.js';
import { toPublicPreviewParty } from './income-document-preview-party.pure.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

export type IssuedIncomeDocumentForRender = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_type: IncomeDocumentType;
  document_number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  language: string | null;
  notes: string | null;
  issuer_snapshot_json: Record<string, unknown>;
  customer_snapshot_json: Record<string, unknown>;
  lines_snapshot_json: unknown[];
  totals_snapshot_json: Record<string, unknown> | null;
  source_draft_id: string | null;
  tax_allocation_number: string | null;
};

async function loadIssuerWebsiteForRender(
  scope: ActiveIncomeIssuerScope,
): Promise<string | null> {
  if (scope.acting_mode === 'office_representative' && scope.represented_client_id) {
    const core = await loadClientOperationsCoreClient(scope.org_id, scope.represented_client_id);
    return core?.website?.trim() ? core.website.trim() : null;
  }
  const { data: settingsRow } = await supabaseAdmin
    .from('organization_settings')
    .select('website, display_website_on_documents')
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  const settings = settingsRow as {
    website?: string | null;
    display_website_on_documents?: boolean;
  } | null;
  if (settings?.display_website_on_documents === false) return null;
  return settings?.website?.trim() ? settings.website.trim() : null;
}

async function loadPaymentTermsDisplayFromSourceDraft(
  orgId: string,
  sourceDraftId: string | null,
): Promise<string | null> {
  if (!sourceDraftId) return null;
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('payment_terms_json')
    .eq('organization_id', orgId)
    .eq('id', sourceDraftId)
    .maybeSingle();
  if (error || !data) return null;
  const paymentTerms = (data as { payment_terms_json?: Record<string, unknown> | null })
    .payment_terms_json;
  if (!paymentTerms || typeof paymentTerms !== 'object' || Array.isArray(paymentTerms)) return null;
  const key = paymentTerms.key ?? paymentTerms.payment_terms_key;
  if (typeof key !== 'string' || !key.trim()) return null;
  const normalized = key.trim();
  if (!isIncomeCustomerPaymentTermsKey(normalized)) return null;
  return incomeCustomerPaymentTermsLabel(normalized);
}

async function loadDraftRenderContextFromSource(
  orgId: string,
  sourceDraftId: string | null,
): Promise<{
  document_settings_json: unknown;
  document_date: string | null;
} | null> {
  if (!sourceDraftId) return null;
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('document_settings_json, document_date')
    .eq('organization_id', orgId)
    .eq('id', sourceDraftId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { document_settings_json: unknown; document_date: string | null };
}

export async function buildUnifiedIncomeDocumentRenderModelForIssuedDocument(
  scope: ActiveIncomeIssuerScope,
  doc: IssuedIncomeDocumentForRender,
): Promise<UnifiedIncomeDocumentRenderInput> {
  const branding = await loadResolvedBrandingProfileForDocumentType(scope, doc.document_type);
  const [issuerWebsite, paymentTermsDisplay, draftContext, allocationPolicy] = await Promise.all([
    loadIssuerWebsiteForRender(scope),
    loadPaymentTermsDisplayFromSourceDraft(scope.org_id, doc.source_draft_id),
    loadDraftRenderContextFromSource(scope.org_id, doc.source_draft_id),
    resolveIncomeTaxAllocationNumberPolicyForOrg(scope.org_id, 'IL', doc.issue_date),
  ]);

  const documentDate = draftContext?.document_date ?? doc.issue_date;
  const settings = parseDocumentSettingsJson(draftContext?.document_settings_json);
  const vatResolution =
    readVatResolutionFromDraftPreview(doc.totals_snapshot_json, documentDate) ??
    (await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate));
  const lineRows = await lineRowsFromLinesSnapshotForRender({
    linesSnapshot: Array.isArray(doc.lines_snapshot_json) ? doc.lines_snapshot_json : [],
    currency: doc.currency,
    totalsSnapshot: doc.totals_snapshot_json,
    documentDate,
    settings,
    vatResolution,
  });
  const allocationApplicable = isAllocationNumberApplicable(allocationPolicy, doc.document_type);

  // Issued view/PDF only — do not mutate branding defaults used by retainer/wizard.
  const issuedBranding =
    branding.document_style_key === 'sectioned'
      ? branding
      : { ...branding, document_style_key: 'sectioned' as const };

  const renderInput = buildUnifiedIncomeDocumentRenderInput({
    branding: issuedBranding,
    document_type: doc.document_type,
    language: doc.language,
    document_number: doc.document_number,
    document_date: doc.issue_date,
    due_date: doc.due_date,
    currency: doc.currency,
    notes: doc.notes,
    payment_terms_display: paymentTermsDisplay,
    payment_link_url: null,
    payment_qr_data_url: null,
    allocation_number: doc.tax_allocation_number,
    allocation_number_visible: allocationApplicable,
    issuer_snapshot_json: doc.issuer_snapshot_json ?? {},
    customer_snapshot_json: doc.customer_snapshot_json ?? {},
    lines_snapshot_json: Array.isArray(doc.lines_snapshot_json) ? doc.lines_snapshot_json : [],
    totals_snapshot_json: doc.totals_snapshot_json,
    issuer_website: issuerWebsite,
    issuer_fallback_label: scope.issuer_label,
    lineRows,
  });

  // Issued view only: fill missing party fields from live Core/customer.
  const [liveIssuer, liveRecipient] = await Promise.all([
    loadLiveIssuerPartyForIssuedRender(scope, issuerWebsite),
    loadLiveRecipientPartyForIssuedRender(scope, doc.customer_snapshot_json ?? {}),
  ]);
  return {
    ...renderInput,
    issuer: mergePreviewPartyPreferringSnapshot(renderInput.issuer, liveIssuer),
    recipient: mergePreviewPartyPreferringSnapshot(renderInput.recipient, liveRecipient),
  };
}

async function loadLiveIssuerPartyForIssuedRender(
  scope: ActiveIncomeIssuerScope,
  issuerWebsite: string | null,
) {
  try {
    const snap = await buildIncomeIssuerSnapshotForScope(scope);
    return toPublicPreviewParty(
      {
        display_name: snap.display_name?.trim() ? snap.display_name.trim() : scope.issuer_label,
        tax_id: snap.tax_id?.trim() ? snap.tax_id.trim() : null,
        address: previewPartyAddressLine(snap.address_json),
        phone: snap.phone?.trim() ? snap.phone.trim() : null,
        email: snap.email?.trim() ? snap.email.trim() : null,
        website: issuerWebsite,
      },
      scope.issuer_label,
    );
  } catch {
    return null;
  }
}

async function loadLiveRecipientPartyForIssuedRender(
  scope: ActiveIncomeIssuerScope,
  customerSnapshot: Record<string, unknown>,
) {
  const customerIdRaw = customerSnapshot.income_customer_id;
  const customerId =
    typeof customerIdRaw === 'string' && customerIdRaw.trim() ? customerIdRaw.trim() : null;
  if (!customerId) {
    return partyFromCustomerSnapshot(customerSnapshot);
  }
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('display_name, tax_id, phone, email, address_json')
    .eq('organization_id', scope.org_id)
    .eq('issuer_business_id', scope.issuer_business_id)
    .eq('id', customerId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadLiveRecipientPartyForIssuedRender');
  if (!data) return partyFromCustomerSnapshot(customerSnapshot);
  const saved = data as {
    display_name?: string | null;
    tax_id?: string | null;
    phone?: string | null;
    email?: string | null;
    address_json?: unknown;
  };
  return toPublicPreviewParty(
    {
      display_name: saved.display_name?.trim() ? String(saved.display_name).trim() : '—',
      tax_id: saved.tax_id?.trim() ? String(saved.tax_id).trim() : null,
      address: previewPartyAddressLine(saved.address_json),
      phone: saved.phone?.trim() ? String(saved.phone).trim() : null,
      email: saved.email?.trim() ? String(saved.email).trim() : null,
    },
    '—',
  );
}
