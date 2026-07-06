/**
 * INV-1 P4 — email history aggregates (document + represented client scope).
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertRowMatchesIssuerScope, reqUuid } from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { buildIncomeDocumentEmailSendForm, mapDeliveryAttemptToDocumentHistoryRow, resolveIncomeDocumentEmailSendEligibility, deliveryAttemptResultLabel, formatEmailDeliverySentAtDisplay, subjectPreviewFromMessageSnapshot, } from './income-document-email-delivery.read-model.pure.js';
import { listIncomeDocumentEmailAttempts, listRepresentedClientEmailAttempts, loadIncomeDocumentsMetaByIds, } from './income-document-email-delivery.read-model.service.js';
import { INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL, INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY, INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY, } from './income.types.js';
const DOCUMENT_TYPE_LABELS = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס/קבלה',
    receipt: 'קבלה',
    credit_tax_invoice: 'זיכוי',
};
const DOCUMENT_HISTORY_COLUMNS = [
    { key: 'sent_at_display', label: 'נשלח בתאריך' },
    { key: 'recipient_email', label: 'נמען' },
    { key: 'result_label', label: 'סטטוס' },
    { key: 'subject_preview', label: 'נושא' },
];
const CLIENT_HISTORY_COLUMNS = [
    { key: 'sent_at_display', label: 'נשלח בתאריך' },
    { key: 'document_number', label: 'מספר מסמך' },
    { key: 'document_type_label', label: 'סוג מסמך' },
    { key: 'recipient_email', label: 'נמען' },
    { key: 'result_label', label: 'סטטוס' },
];
function assertEmailHistoryViewAccess(ctx) {
    const perms = incomeWorkspacePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
}
function assertClientEmailHistoryAccess(ctx) {
    assertEmailHistoryViewAccess(ctx);
    const perms = incomeWorkspacePermissionsFromContext(ctx);
    if (!perms.issue_on_behalf)
        throw forbidden('income.issue_on_behalf required');
}
async function loadIssuedDocumentForHistory(orgId, incomeDocumentId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, issuer_business_id, represented_client_id, document_number, document_type, document_status, pdf_render_status, pdf_asset_id')
        .eq('id', incomeDocumentId)
        .eq('organization_id', orgId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadIssuedDocumentForEmailHistory');
    if (!data)
        throw notFound('Income document not found');
    return data;
}
async function loadRepresentedClient(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, is_archived')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadEmailHistoryRepresentedClient');
    const row = data;
    if (!row || row.is_archived)
        throw notFound('Office client not found');
    return row;
}
export async function buildIncomeDocumentEmailHistoryAggregate(params) {
    assertEmailHistoryViewAccess(params.ctx);
    const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
    const scope = await loadActiveIncomeIssuerScope(params.ctx);
    const doc = await loadIssuedDocumentForHistory(scope.org_id, incomeDocumentId);
    assertRowMatchesIssuerScope(scope, doc);
    const attempts = await listIncomeDocumentEmailAttempts(scope.org_id, incomeDocumentId);
    const sendEligibility = resolveIncomeDocumentEmailSendEligibility({
        permissions: scope.permissions,
        representedClientId: scope.represented_client_id,
        documentStatus: doc.document_status,
        pdfRenderStatus: doc.pdf_render_status,
        pdfAssetId: doc.pdf_asset_id,
    });
    const rows = attempts.map((attempt) => mapDeliveryAttemptToDocumentHistoryRow(attempt));
    const allowedActions = ['view_income_document_email_history'];
    if (sendEligibility.enabled) {
        allowedActions.push(INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL);
    }
    return {
        aggregate_key: INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY,
        income_document_id: incomeDocumentId,
        document_number: doc.document_number,
        document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type],
        represented_client_id: doc.represented_client_id,
        table_columns: DOCUMENT_HISTORY_COLUMNS,
        rows,
        send_form: buildIncomeDocumentEmailSendForm({
            incomeDocumentId,
            sendEligibility,
        }),
        allowed_actions: allowedActions,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין היסטוריית שליחה במייל',
            description: 'מסמך זה טרם נשלח במייל.',
        },
    };
}
export async function buildIncomeRepresentedClientEmailHistoryAggregate(params) {
    assertClientEmailHistoryAccess(params.ctx);
    const representedClientId = reqUuid(params.representedClientId, 'represented_client_id');
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    const client = await loadRepresentedClient(orgId, representedClientId);
    const attempts = await listRepresentedClientEmailAttempts(orgId, representedClientId);
    const documentIds = [...new Set(attempts.map((a) => a.sourceEntityId))];
    const docMeta = await loadIncomeDocumentsMetaByIds(orgId, documentIds);
    const rows = attempts.map((attempt) => {
        const meta = docMeta.get(attempt.sourceEntityId);
        return {
            attempt_id: attempt.id,
            income_document_id: attempt.sourceEntityId,
            document_number: meta?.document_number ?? null,
            document_type_label: meta?.document_type_label ?? null,
            sent_at_display: formatEmailDeliverySentAtDisplay(attempt.sentAt),
            recipient_email: attempt.recipientEmail,
            result: attempt.result,
            result_label: deliveryAttemptResultLabel(attempt.result),
            failure_reason: attempt.failureReason,
            subject_preview: subjectPreviewFromMessageSnapshot(attempt.messageSnapshotJson),
        };
    });
    return {
        aggregate_key: INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
        represented_client_id: representedClientId,
        client_display_name: client.display_name,
        table_columns: CLIENT_HISTORY_COLUMNS,
        rows,
        allowed_actions: ['view_income_represented_client_email_history'],
        empty_state: {
            visible: rows.length === 0,
            title: 'אין היסטוריית שליחה במייל',
            description: 'טרם נשלחו מסמכי הכנסה במייל עבור לקוח זה.',
        },
    };
}
