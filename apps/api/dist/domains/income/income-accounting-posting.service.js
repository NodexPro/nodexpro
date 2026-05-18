/**
 * INC-5 — Apply Accounting Base posting to issued income_documents row.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { postIncomeDocumentToAccountingBase } from '../accounting-base/income-document-posting.service.js';
import { resolveIncomeAccountingPostingPlan, } from './income-accounting-posting.mapping.js';
export { accountingDisplayStatusLabel, resolveAccountingDisplayStatus } from './income-accounting-posting.mapping.js';
export async function applyAccountingPostingForIssuedDocument(ctx, doc) {
    const plan = resolveIncomeAccountingPostingPlan(doc.document_type);
    if (!plan.requires_posting) {
        await writeAudit({
            organizationId: doc.organization_id,
            actorUserId: ctx.user.id,
            moduleCode: 'income',
            entityType: 'income_document',
            entityId: doc.id,
            action: AUDIT_ACTIONS.INCOME_ACCOUNTING_POSTING_NOT_REQUIRED,
            payload: { document_type: doc.document_type, display_status: plan.display_status_when_skipped },
        });
        await supabaseAdmin
            .from('income_documents')
            .update({
            accounting_posting_status: 'not_required',
            accounting_posting_error: null,
            accounting_posting_signature: null,
        })
            .eq('id', doc.id)
            .eq('organization_id', doc.organization_id);
        return {
            accounting_posting_status: 'not_required',
            accounting_entry_id: null,
            accounting_entry_link_id: null,
            accounting_posting_signature: null,
            accounting_display_status: plan.display_status_when_skipped,
        };
    }
    await writeAudit({
        organizationId: doc.organization_id,
        actorUserId: ctx.user.id,
        moduleCode: 'income',
        entityType: 'income_document',
        entityId: doc.id,
        action: AUDIT_ACTIONS.INCOME_ACCOUNTING_POSTING_STARTED,
        payload: { document_type: doc.document_type, document_number: doc.document_number },
    });
    try {
        const result = await postIncomeDocumentToAccountingBase(ctx, {
            income_document_id: doc.id,
            organization_id: doc.organization_id,
            document_type: doc.document_type,
            document_number: doc.document_number,
            issue_date: doc.issue_date,
            currency: doc.currency,
            client_id: doc.represented_client_id,
            totals_snapshot_json: doc.totals_snapshot_json,
            lines_snapshot_json: doc.lines_snapshot_json,
            description_note: doc.notes ?? null,
        });
        const postedAt = new Date().toISOString();
        const { error: updateErr } = await supabaseAdmin
            .from('income_documents')
            .update({
            accounting_posting_status: 'posted',
            accounting_entry_id: result.accounting_entry_id,
            accounting_entry_link_id: result.accounting_entry_link_id,
            accounting_posted_at: postedAt,
            accounting_posting_error: null,
            accounting_posting_signature: result.accounting_posting_signature,
            totals_snapshot_json: {
                ...doc.totals_snapshot_json,
                accounting_entry_ids: result.accounting_entry_ids,
                authoritative_financial_truth: 'accounting_base',
            },
        })
            .eq('id', doc.id)
            .eq('organization_id', doc.organization_id);
        if (updateErr)
            throw updateErr;
        await writeAudit({
            organizationId: doc.organization_id,
            actorUserId: ctx.user.id,
            moduleCode: 'income',
            entityType: 'income_document',
            entityId: doc.id,
            action: AUDIT_ACTIONS.INCOME_ACCOUNTING_POSTING_SUCCEEDED,
            payload: {
                accounting_entry_id: result.accounting_entry_id,
                accounting_entry_ids: result.accounting_entry_ids,
            },
        });
        return {
            accounting_posting_status: 'posted',
            accounting_entry_id: result.accounting_entry_id,
            accounting_entry_link_id: result.accounting_entry_link_id,
            accounting_posting_signature: result.accounting_posting_signature,
            accounting_display_status: 'posted',
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Accounting Base posting failed';
        await supabaseAdmin
            .from('income_documents')
            .update({
            accounting_posting_status: 'failed',
            accounting_posting_error: message.slice(0, 2000),
        })
            .eq('id', doc.id)
            .eq('organization_id', doc.organization_id);
        await writeAudit({
            organizationId: doc.organization_id,
            actorUserId: ctx.user.id,
            moduleCode: 'income',
            entityType: 'income_document',
            entityId: doc.id,
            action: AUDIT_ACTIONS.INCOME_ACCOUNTING_POSTING_FAILED,
            payload: { error: message },
        });
        throw err;
    }
}
export async function retryAccountingPostingForIssuedDocument(ctx, orgId, incomeDocumentId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, document_type, document_number, issue_date, currency, represented_client_id, totals_snapshot_json, lines_snapshot_json, accounting_posting_status, accounting_entry_id')
        .eq('id', incomeDocumentId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw new Error('Income document not found');
    const row = data;
    if (row.accounting_posting_status === 'posted' && row.accounting_entry_id) {
        return;
    }
    if (row.accounting_posting_status === 'not_required') {
        return;
    }
    await applyAccountingPostingForIssuedDocument(ctx, row);
}
