/**
 * Assemble unified Income document render model for issued documents (PDF / delivery).
 */
import { supabaseAdmin } from '../../db/client.js';
import { loadClientOperationsCoreClient } from '../client-operations/client-operations-client-core.read.js';
import { loadResolvedBrandingProfileForDocumentType } from './income-document-branding.service.js';
import { buildUnifiedIncomeDocumentRenderInput, } from './income-document-unified-render.pure.js';
import { incomeCustomerPaymentTermsLabel, isIncomeCustomerPaymentTermsKey } from './income-customer-payment-terms.pure.js';
async function loadIssuerWebsiteForRender(scope) {
    if (scope.acting_mode === 'office_representative' && scope.represented_client_id) {
        const core = await loadClientOperationsCoreClient(scope.org_id, scope.represented_client_id);
        return core?.website?.trim() ? core.website.trim() : null;
    }
    const { data: settingsRow } = await supabaseAdmin
        .from('organization_settings')
        .select('website, display_website_on_documents')
        .eq('organization_id', scope.org_id)
        .maybeSingle();
    const settings = settingsRow;
    if (settings?.display_website_on_documents === false)
        return null;
    return settings?.website?.trim() ? settings.website.trim() : null;
}
async function loadPaymentTermsDisplayFromSourceDraft(orgId, sourceDraftId) {
    if (!sourceDraftId)
        return null;
    const { data, error } = await supabaseAdmin
        .from('income_document_drafts')
        .select('payment_terms_json')
        .eq('organization_id', orgId)
        .eq('id', sourceDraftId)
        .maybeSingle();
    if (error || !data)
        return null;
    const paymentTerms = data
        .payment_terms_json;
    if (!paymentTerms || typeof paymentTerms !== 'object' || Array.isArray(paymentTerms))
        return null;
    const key = paymentTerms.key ?? paymentTerms.payment_terms_key;
    if (typeof key !== 'string' || !key.trim())
        return null;
    const normalized = key.trim();
    if (!isIncomeCustomerPaymentTermsKey(normalized))
        return null;
    return incomeCustomerPaymentTermsLabel(normalized);
}
export async function buildUnifiedIncomeDocumentRenderModelForIssuedDocument(scope, doc) {
    const branding = await loadResolvedBrandingProfileForDocumentType(scope, doc.document_type);
    const [issuerWebsite, paymentTermsDisplay] = await Promise.all([
        loadIssuerWebsiteForRender(scope),
        loadPaymentTermsDisplayFromSourceDraft(scope.org_id, doc.source_draft_id),
    ]);
    return buildUnifiedIncomeDocumentRenderInput({
        branding,
        document_type: doc.document_type,
        language: doc.language,
        document_number: doc.document_number,
        document_date: doc.issue_date,
        due_date: doc.due_date,
        currency: doc.currency,
        notes: doc.notes,
        payment_terms_display: paymentTermsDisplay,
        issuer_snapshot_json: doc.issuer_snapshot_json ?? {},
        customer_snapshot_json: doc.customer_snapshot_json ?? {},
        lines_snapshot_json: Array.isArray(doc.lines_snapshot_json) ? doc.lines_snapshot_json : [],
        totals_snapshot_json: doc.totals_snapshot_json,
        issuer_website: issuerWebsite,
        issuer_fallback_label: scope.issuer_label,
    });
}
