/**
 * INV-3E — reverse_income_payment_allocation (Accounting Base).
 *
 * Full reversal of one posted income allocation via SECURITY DEFINER RPC.
 * Original allocation remains auditable (status → reversed).
 * Reversal row points to original via reversal_of_allocation_id.
 * Payment row stays posted (money-received); no fake customer credit.
 * Issued Income receipts are not mutated.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertRowMatchesIssuerScope } from '../income/income.guards.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { buildInvoiceLifecycleAggregate } from '../income/invoice-lifecycle.read-model.service.js';
import { emitIncomeInvoiceOverdueAfterPaymentReversal } from '../income/income-work-engine-bridge.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import { ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION, ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION, isSupportedIncomePaymentDocumentType, resolveIncomeInvoiceOriginalAmount, resolveIncomeInvoicePaymentState, roundMoney2, } from './accounting-base-income-payment.pure.js';
import { buildIncomeInvoicePaymentCaseAggregate, sumPostedAllocationsForIncomeDocument, } from './accounting-base-income-payment-case.read.js';
import { accountsReceivableAgingLabel, accountsReceivableAgingLabelHe, resolveAccountsReceivableAgingBucket, } from './accounting-base-accounts-receivable-aging.pure.js';
import { backendTodayIsoDate, composeInvoiceLifecycleDueDimension, } from '../income/invoice-lifecycle.pure.js';
export const ACCOUNTING_BASE_REVERSE_INCOME_PAYMENT_ALLOCATION_RPC = 'accounting_base_reverse_income_payment_allocation';
function requirePaymentWrite(ctx) {
    if (!(ctx.membership?.permissions ?? []).includes(ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION)) {
        throw forbidden('accounting_base.payment.write required');
    }
}
function reqReason(value) {
    const s = String(value ?? '').trim();
    if (!s)
        throw badRequest('reason required');
    if (s.length > 500)
        throw badRequest('reason must be at most 500 characters');
    return s;
}
function mapReverseRpcError(err) {
    const message = String(err.message ?? 'Payment allocation reversal failed');
    if (/Allocation not found/i.test(message))
        throw notFound('Allocation not found');
    if (/Income document not found/i.test(message))
        throw notFound('Income document not found');
    if (/Cannot reverse a reversal/i.test(message)) {
        throw badRequest('Cannot reverse a reversal allocation');
    }
    if (/Only posted allocations/i.test(message)) {
        throw badRequest('Only posted allocations can be reversed');
    }
    if (/Only income allocations/i.test(message)) {
        throw badRequest('Only income allocations can be reversed');
    }
    if (/reason required/i.test(message))
        throw badRequest('reason required');
    if (/Concurrent reversal|unique|duplicate/i.test(message)) {
        throw conflict('Allocation was already reversed or concurrent reversal conflict');
    }
    if (/reversed but reversal fact is missing/i.test(message)) {
        throw new AppError(502, message, 'ACCOUNTING_BASE_REVERSAL_INVARIANT_BROKEN');
    }
    throw new AppError(502, message, 'ACCOUNTING_BASE_REVERSAL_RPC_FAILED', {
        pg_code: err.code,
    });
}
export async function callReverseIncomePaymentAllocationRpc(input) {
    const { data, error } = await supabaseAdmin.rpc(ACCOUNTING_BASE_REVERSE_INCOME_PAYMENT_ALLOCATION_RPC, {
        p_organization_id: input.organizationId,
        p_allocation_id: input.allocationId,
        p_created_by: input.createdBy,
        p_reason: input.reason,
    });
    if (error)
        mapReverseRpcError(error);
    if (!data || typeof data !== 'object') {
        throw new AppError(502, 'Reversal RPC returned empty result', 'ACCOUNTING_BASE_REVERSAL_RPC_EMPTY');
    }
    const row = data;
    const originalId = String(row.original_allocation_id ?? '');
    const reversalId = String(row.reversal_allocation_id ?? '');
    const paymentId = String(row.payment_id ?? '');
    const incomeDocumentId = String(row.income_document_id ?? '');
    if (!originalId || !reversalId || !paymentId || !incomeDocumentId) {
        throw new AppError(502, 'Reversal RPC missing ids', 'ACCOUNTING_BASE_REVERSAL_RPC_INVALID');
    }
    return {
        replay: Boolean(row.replay),
        original_allocation_id: originalId,
        reversal_allocation_id: reversalId,
        payment_id: paymentId,
        income_document_id: incomeDocumentId,
        allocated_total: roundMoney2(Number(row.allocated_total ?? 0)),
        reversed_amount: roundMoney2(Number(row.reversed_amount ?? 0)),
        currency: String(row.currency ?? 'ILS'),
    };
}
async function buildAccountsReceivableAffectedRefresh(params) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_status, document_type, due_date, currency, totals_snapshot_json')
        .eq('organization_id', params.organizationId)
        .eq('id', params.incomeDocumentId)
        .maybeSingle();
    throwIfSupabaseError(error, 'accountsReceivableAffectedLoadDocument');
    if (!data)
        throw notFound('Income document not found');
    const doc = data;
    const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
    const paid = await sumPostedAllocationsForIncomeDocument(params.organizationId, doc.id);
    const payment = resolveIncomeInvoicePaymentState(original, paid);
    const todayIso = params.todayIso ?? backendTodayIsoDate();
    const due = composeInvoiceLifecycleDueDimension({
        documentStatus: doc.document_status,
        documentType: doc.document_type,
        dueDate: doc.due_date,
        remainingBalance: payment.remaining_balance,
        paymentStateKey: payment.payment_state_key,
        todayIso,
    });
    const aging_bucket_key = resolveAccountsReceivableAgingBucket({
        overdue: due.overdue,
        days_overdue: due.days_overdue,
    });
    const is_open_receivable = doc.document_status === 'issued' &&
        isSupportedIncomePaymentDocumentType(doc.document_type) &&
        payment.remaining_balance > 0;
    return {
        aggregate_key: 'accounts_receivable_affected',
        financial_source: 'accounting_base',
        income_document_id: doc.id,
        is_open_receivable,
        original_amount: original,
        paid_amount: paid,
        remaining_balance: payment.remaining_balance,
        payment_state_key: payment.payment_state_key,
        due_state_key: due.state_key,
        overdue: due.overdue,
        overdue_since: due.overdue_since,
        days_overdue: due.days_overdue,
        aging_bucket_key,
        aging_label: accountsReceivableAgingLabel(aging_bucket_key),
        aging_label_he: accountsReceivableAgingLabelHe(aging_bucket_key),
        notes: [
            'Affected A/R slice after allocation reversal — full A/R / portfolio aggregates refresh on next read.',
            'Issued Income receipts linked to the payment are not cancelled by INV-3E.',
        ],
    };
}
export async function executeReverseIncomePaymentAllocation(ctx, organizationId, payload) {
    assertOrgInContext(ctx, organizationId);
    requirePaymentWrite(ctx);
    const allocationId = String(payload.allocation_id ?? '').trim();
    if (!allocationId)
        throw badRequest('allocation_id required');
    const reason = reqReason(payload.reason);
    // Preload allocation for scope validation before RPC (RPC also org-scopes).
    const { data: allocRaw, error: allocErr } = await supabaseAdmin
        .from('accounting_payment_allocations')
        .select('id, organization_id, payment_id, source_module, source_entity_id, allocated_amount, currency, status, reversal_of_allocation_id')
        .eq('organization_id', organizationId)
        .eq('id', allocationId)
        .maybeSingle();
    throwIfSupabaseError(allocErr, 'reverseAllocationLoad');
    if (!allocRaw)
        throw notFound('Allocation not found');
    const alloc = allocRaw;
    if (alloc.source_module !== 'income') {
        throw badRequest('Only income allocations can be reversed');
    }
    if (alloc.reversal_of_allocation_id != null) {
        throw badRequest('Cannot reverse a reversal allocation');
    }
    const { data: docRaw, error: docErr } = await supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, issuer_business_id, represented_client_id, document_type, document_status, document_number, issue_date, due_date, currency, customer_snapshot_json, totals_snapshot_json')
        .eq('organization_id', organizationId)
        .eq('id', alloc.source_entity_id)
        .maybeSingle();
    throwIfSupabaseError(docErr, 'reverseAllocationLoadDocument');
    if (!docRaw)
        throw notFound('Income document not found');
    const doc = docRaw;
    if (!isSupportedIncomePaymentDocumentType(doc.document_type)) {
        throw badRequest('Only tax_invoice allocations are supported for reversal');
    }
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertRowMatchesIssuerScope(scope, {
        organization_id: doc.organization_id,
        issuer_business_id: doc.issuer_business_id,
        represented_client_id: doc.represented_client_id,
    });
    try {
        const rpc = await callReverseIncomePaymentAllocationRpc({
            organizationId,
            allocationId: alloc.id,
            createdBy: ctx.user.id,
            reason,
        });
        if (!rpc.replay) {
            await writeAudit({
                organizationId,
                actorUserId: ctx.user.id,
                moduleCode: 'accounting_base',
                entityType: 'accounting_payment_allocation',
                entityId: rpc.reversal_allocation_id,
                action: AUDIT_ACTIONS.ACCOUNTING_BASE_PAYMENT_ALLOCATION_REVERSED,
                payload: {
                    original_allocation_id: rpc.original_allocation_id,
                    reversal_allocation_id: rpc.reversal_allocation_id,
                    payment_id: rpc.payment_id,
                    income_document_id: rpc.income_document_id,
                    issuer_business_id: doc.issuer_business_id,
                    represented_client_id: doc.represented_client_id,
                    reversed_amount: rpc.reversed_amount,
                    currency: rpc.currency,
                    allocated_total_after: rpc.allocated_total,
                    reason,
                    payment_remains_posted: true,
                    issued_receipt_not_mutated: true,
                },
            });
        }
        const paymentCase = await buildIncomeInvoicePaymentCaseAggregate(ctx, organizationId, rpc.income_document_id);
        const arAffected = await buildAccountsReceivableAffectedRefresh({
            organizationId,
            incomeDocumentId: rpc.income_document_id,
        });
        // INV-4E — reopen collection via existing overdue intake when debt + overdue return.
        if (!rpc.replay && arAffected.overdue && arAffected.remaining_balance > 0) {
            await emitIncomeInvoiceOverdueAfterPaymentReversal({
                ctx,
                orgId: organizationId,
                incomeDocumentId: doc.id,
                representedClientId: doc.represented_client_id,
                documentType: doc.document_type,
                documentNumber: doc.document_number,
                issueDate: doc.issue_date,
                dueDate: doc.due_date,
                currency: doc.currency || 'ILS',
                customerSnapshotJson: doc.customer_snapshot_json ?? {},
                totalsSnapshotJson: doc.totals_snapshot_json,
            }, arAffected.paid_amount);
        }
        const additional_refreshed = [
            { aggregate_key: 'accounts_receivable_affected', aggregate: arAffected },
        ];
        try {
            const lifecycle = await buildInvoiceLifecycleAggregate({
                ctx,
                incomeDocumentId: rpc.income_document_id,
            });
            additional_refreshed.unshift({
                aggregate_key: 'invoice_lifecycle_aggregate',
                aggregate: lifecycle,
            });
        }
        catch {
            // Lifecycle requires income.view; AB payment.write alone still gets payment_case + A/R affected.
        }
        return {
            ok: true,
            command: ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
            original_allocation_id: rpc.original_allocation_id,
            reversal_allocation_id: rpc.reversal_allocation_id,
            payment_id: rpc.payment_id,
            income_document_id: rpc.income_document_id,
            replay: rpc.replay,
            refreshed: {
                aggregate_key: ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY,
                aggregate: paymentCase,
            },
            additional_refreshed,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
            await writeAudit({
                organizationId,
                actorUserId: ctx.user.id,
                moduleCode: 'accounting_base',
                entityType: 'accounting_payment_allocation',
                entityId: allocationId,
                action: AUDIT_ACTIONS.ACCOUNTING_BASE_PAYMENT_ALLOCATION_REVERSAL_FAILED,
                payload: {
                    allocation_id: allocationId,
                    income_document_id: doc.id,
                    reason,
                    error: message,
                },
            });
        }
        catch {
            // best-effort
        }
        throw err;
    }
}
