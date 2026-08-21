/**
 * Assemble unified Income document render model for issued documents (PDF / delivery).
 */
import { supabaseAdmin } from '../../db/client.js';
import { loadClientOperationsCoreClient } from '../client-operations/client-operations-client-core.read.js';
import { loadResolvedBrandingProfileForDocumentType } from './income-document-branding.service.js';
import { buildUnifiedIncomeDocumentRenderInput, lineRowsFromLinesSnapshotForRender, mergePreviewPartyPreferringSnapshot, partyFromCustomerSnapshot, previewPartyAddressLine, } from './income-document-unified-render.pure.js';
import { incomeCustomerPaymentTermsLabel, paymentTermsKeyFromUnknown, resolveIncomeDueDateFromDocument, } from './income-customer-payment-terms.pure.js';
import { loadIncomeCustomerDefaultPaymentTerms } from './income-recipient.service.js';
import { parseDocumentSettingsJson } from './income-document-draft-totals.pure.js';
import { readVatResolutionFromDraftPreview } from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { isAllocationNumberApplicable, } from './income-document-allocation-number.pure.js';
import { resolveIncomeTaxAllocationNumberPolicyForOrg } from './income-document-allocation-number-resolver.js';
import { buildIncomeIssuerSnapshotForScope } from './income-issuer-snapshot.service.js';
import { toPublicPreviewParty } from './income-document-preview-party.pure.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { adaptOwnerLayoutDefinitionForCanonicalRenderer, resolveIssuedDocumentLayoutSource, } from '../owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';
import { resolveIncomeDocumentSemanticDates } from './income-document-semantic-dates.pure.js';
import { loadCreditSourceReferenceForDocument } from './income-document-tax-invoice-credit.read.js';
import { mergeCreditSourceReferenceIntoNotes } from './income-document-tax-invoice-credit.pure.js';
function applyOwnerLayoutAdapterToIssuedBranding(branding, definition) {
    const adapted = adaptOwnerLayoutDefinitionForCanonicalRenderer(definition);
    return {
        ...branding,
        document_style_key: adapted.document_style_key,
        display_options: {
            ...branding.display_options,
            show_logo: adapted.field_visibility.logo !== false && branding.display_options.show_logo,
            show_signature: adapted.field_visibility.signature_block !== false && branding.display_options.show_signature,
            show_footer: adapted.field_visibility.platform_footer !== false && branding.display_options.show_footer,
            show_notes: adapted.field_visibility.notes !== false && branding.display_options.show_notes,
            show_vat_row: adapted.field_visibility.vat_total !== false && branding.display_options.show_vat_row,
            show_due_date: adapted.field_visibility.due_date !== false && branding.display_options.show_due_date,
            show_payment_terms: adapted.field_visibility.payment_terms !== false &&
                branding.display_options.show_payment_terms,
            show_item_index: adapted.table_column_visibility.index !== false && branding.display_options.show_item_index,
            show_currency: adapted.table_column_visibility.line_currency !== false &&
                branding.display_options.show_currency,
        },
    };
}
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
async function loadSourceDraftRenderContext(orgId, sourceDraftId) {
    if (!sourceDraftId)
        return null;
    const { data, error } = await supabaseAdmin
        .from('income_document_drafts')
        .select('document_settings_json, document_date, due_date, payment_terms_json, income_customer_id')
        .eq('organization_id', orgId)
        .eq('id', sourceDraftId)
        .maybeSingle();
    if (error || !data)
        return null;
    return data;
}
export async function buildUnifiedIncomeDocumentRenderModelForIssuedDocument(scope, doc) {
    const branding = await loadResolvedBrandingProfileForDocumentType(scope, doc.document_type);
    const [issuerWebsite, draftContext, allocationPolicy] = await Promise.all([
        loadIssuerWebsiteForRender(scope),
        loadSourceDraftRenderContext(scope.org_id, doc.source_draft_id),
        resolveIncomeTaxAllocationNumberPolicyForOrg(scope.org_id, 'IL', doc.issue_date),
    ]);
    const documentDate = draftContext?.document_date ?? doc.issue_date;
    const settings = parseDocumentSettingsJson(draftContext?.document_settings_json);
    const vatResolution = readVatResolutionFromDraftPreview(doc.totals_snapshot_json, documentDate) ??
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
    // INV-13A: legacy issued docs (no freeze) → exact existing sectioned force path.
    // Layout-aware only when snapshot present on the issued row (no Owner DB lookup).
    const layoutSource = resolveIssuedDocumentLayoutSource({
        owner_layout_version_id: doc.owner_layout_version_id,
        owner_layout_snapshot_json: doc.owner_layout_snapshot_json,
    });
    let issuedBranding = branding.document_style_key === 'sectioned'
        ? branding
        : { ...branding, document_style_key: 'sectioned' };
    if (layoutSource.mode === 'owner_layout') {
        issuedBranding = applyOwnerLayoutAdapterToIssuedBranding(issuedBranding, layoutSource.definition);
    }
    const draftPaymentTerms = paymentTermsKeyFromUnknown(draftContext?.payment_terms_json);
    let paymentTerms = draftPaymentTerms;
    if (!doc.due_date &&
        !draftContext?.due_date &&
        !paymentTerms &&
        doc.document_type === 'tax_invoice') {
        const customerId = draftContext?.income_customer_id ?? doc.income_customer_id ?? null;
        if (customerId) {
            paymentTerms = await loadIncomeCustomerDefaultPaymentTerms(scope, customerId);
        }
    }
    const dueDateFromDocument = resolveIncomeDueDateFromDocument({
        storedDueDate: doc.due_date ?? draftContext?.due_date ?? null,
        documentDateIso: documentDate,
        paymentTerms,
    });
    const paymentTermsDisplay = draftPaymentTerms
        ? incomeCustomerPaymentTermsLabel(draftPaymentTerms)
        : null;
    const semanticDates = resolveIncomeDocumentSemanticDates({
        issue_date: doc.issue_date,
        due_date: dueDateFromDocument,
    });
    const creditReference = doc.document_type === 'credit_tax_invoice'
        ? await loadCreditSourceReferenceForDocument(scope.org_id, doc.id)
        : null;
    const renderInput = buildUnifiedIncomeDocumentRenderInput({
        branding: issuedBranding,
        document_type: doc.document_type,
        language: doc.language,
        document_number: doc.document_number,
        document_date: semanticDates.document_date ?? doc.issue_date,
        due_date: semanticDates.due_date,
        currency: doc.currency,
        notes: mergeCreditSourceReferenceIntoNotes(doc.notes, creditReference),
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
async function loadLiveIssuerPartyForIssuedRender(scope, issuerWebsite) {
    try {
        const snap = await buildIncomeIssuerSnapshotForScope(scope);
        return toPublicPreviewParty({
            display_name: snap.display_name?.trim() ? snap.display_name.trim() : scope.issuer_label,
            tax_id: snap.tax_id?.trim() ? snap.tax_id.trim() : null,
            address: previewPartyAddressLine(snap.address_json),
            phone: snap.phone?.trim() ? snap.phone.trim() : null,
            email: snap.email?.trim() ? snap.email.trim() : null,
            website: issuerWebsite,
        }, scope.issuer_label);
    }
    catch {
        return null;
    }
}
async function loadLiveRecipientPartyForIssuedRender(scope, customerSnapshot) {
    const customerIdRaw = customerSnapshot.income_customer_id;
    const customerId = typeof customerIdRaw === 'string' && customerIdRaw.trim() ? customerIdRaw.trim() : null;
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
    if (!data)
        return partyFromCustomerSnapshot(customerSnapshot);
    const saved = data;
    return toPublicPreviewParty({
        display_name: saved.display_name?.trim() ? String(saved.display_name).trim() : '—',
        tax_id: saved.tax_id?.trim() ? String(saved.tax_id).trim() : null,
        address: previewPartyAddressLine(saved.address_json),
        phone: saved.phone?.trim() ? String(saved.phone).trim() : null,
        email: saved.email?.trim() ? String(saved.email).trim() : null,
    }, '—');
}
