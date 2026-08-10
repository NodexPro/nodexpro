/**
 * INV-4 — invoice_collection_control_aggregate (future ICC backend contract).
 * Composes Income + AB + Delivery + Work Engine collection/reminder truth.
 * No UI. Promise tracking is an intentional future extension point only.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { listAttempts } from '../delivery/index.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import { backendTodayIsoDate, resolveIncomeOverdueCollectionIntake, } from '../income/invoice-lifecycle.pure.js';
import { isUuid } from './work-engine.guards.js';
import { COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE, COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE, COLLECTION_REMINDER_SEND_COMMAND, INVOICE_COLLECTION_CONTROL_AGGREGATE_KEY, INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE, resolveInvoiceCollectionControlStatus, } from './work-engine-collection-reminder.pure.js';
const STATUS_LABEL_HE = {
    waiting_review: 'ממתין לבדיקה',
    approved: 'מאושר',
    sending: 'בשליחה',
    sent: 'נשלח',
    delivery_failed: 'שליחה נכשלה',
    waiting_payment: 'ממתין לתשלום',
    paid: 'שולם',
    collection_closed: 'גבייה נסגרה',
    reopened: 'נפתח מחדש',
    no_active_collection: 'אין גבייה פעילה',
};
export async function buildInvoiceCollectionControlAggregate(params) {
    if (!isUuid(params.incomeDocumentId)) {
        throw badRequest('income_document_id must be a uuid');
    }
    const todayIso = params.todayIso ?? backendTodayIsoDate();
    const { data: doc, error: dErr } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_number, document_type, document_status, issue_date, due_date, currency, totals_snapshot_json, represented_client_id')
        .eq('organization_id', params.orgId)
        .eq('id', params.incomeDocumentId)
        .maybeSingle();
    if (dErr)
        throw dErr;
    if (!doc)
        throw notFound('Income document not found');
    const paidMap = await sumPostedAllocationsForIncomeDocuments(params.orgId, [
        params.incomeDocumentId,
    ]);
    const paidAmount = paidMap.get(params.incomeDocumentId) ?? 0;
    const originalAmount = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
    const intake = resolveIncomeOverdueCollectionIntake({
        documentStatus: String(doc.document_status),
        documentType: String(doc.document_type),
        dueDate: doc.due_date,
        originalAmount,
        paidAmount,
        todayIso,
    });
    const { data: workItem } = await supabaseAdmin
        .from('work_items')
        .select('id, work_state, period_key, created_at')
        .eq('org_id', params.orgId)
        .eq('module_key', 'income')
        .eq('work_type', INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
        .eq('source_entity_id', params.incomeDocumentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    const collectionActive = !!workItem &&
        workItem.work_state !== 'done' &&
        workItem.work_state !== 'archived';
    let latestCandidate = null;
    if (workItem?.id) {
        const { data: cand } = await supabaseAdmin
            .from('work_reminder_candidates')
            .select('id, status, step_key, created_at')
            .eq('org_id', params.orgId)
            .eq('work_item_id', workItem.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (cand) {
            latestCandidate = {
                id: String(cand.id),
                status: String(cand.status),
                step_key: String(cand.step_key),
                created_at: String(cand.created_at),
            };
        }
    }
    const attempts = latestCandidate
        ? await listAttempts({
            organizationId: params.orgId,
            sourceModule: COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
            sourceEntityType: COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
            sourceEntityId: latestCandidate.id,
            limit: 20,
        })
        : [];
    const last = attempts[0] ?? null;
    const wasReopened = !!workItem &&
        collectionActive &&
        intake.eligible &&
        String(workItem.work_state) === 'waiting_client' &&
        !!latestCandidate === false &&
        attempts.length === 0;
    const status_key = resolveInvoiceCollectionControlStatus({
        collectionActive,
        collectionWorkState: workItem ? String(workItem.work_state) : null,
        paymentStateKey: intake.payment_state_key,
        remainingBalance: intake.remaining_balance,
        latestCandidateStatus: latestCandidate?.status ?? null,
        wasReopened,
    });
    const allowed_actions = [];
    if (latestCandidate?.status === 'pending_review' || latestCandidate?.status === 'edited') {
        allowed_actions.push({
            action_key: 'open_collection_reminder_review',
            label: 'בדיקת תזכורת',
            enabled: true,
            disabled_reason: null,
            command: null,
        });
    }
    if (latestCandidate?.status === 'approved' || latestCandidate?.status === 'delivery_failed') {
        allowed_actions.push({
            action_key: COLLECTION_REMINDER_SEND_COMMAND,
            label: latestCandidate.status === 'delivery_failed' ? 'נסה שוב' : 'שליחה',
            enabled: intake.eligible && intake.remaining_balance > 0,
            disabled_reason: intake.eligible && intake.remaining_balance > 0
                ? null
                : 'אין יתרה פתוחה לשליחת תזכורת',
            command: COLLECTION_REMINDER_SEND_COMMAND,
        });
    }
    return {
        aggregate_key: INVOICE_COLLECTION_CONTROL_AGGREGATE_KEY,
        status_key,
        status_label_he: STATUS_LABEL_HE[status_key],
        invoice: {
            income_document_id: String(doc.id),
            document_number: String(doc.document_number ?? ''),
            document_type: String(doc.document_type),
            issue_date: doc.issue_date ?? null,
            due_date: doc.due_date ?? null,
            days_overdue: intake.days_overdue,
        },
        payment: {
            currency: String(doc.currency ?? 'ILS'),
            original_amount: originalAmount,
            paid_amount: paidAmount,
            remaining_balance: intake.remaining_balance,
            payment_state_key: intake.payment_state_key,
            financial_source: 'accounting_base',
        },
        collection: {
            active: collectionActive,
            work_item_id: workItem ? String(workItem.id) : null,
            work_state: workItem ? String(workItem.work_state) : null,
            period_key: workItem?.period_key ? String(workItem.period_key) : null,
        },
        candidate: {
            id: latestCandidate?.id ?? null,
            status: latestCandidate?.status ?? null,
            step_key: latestCandidate?.step_key ?? null,
            created_at: latestCandidate?.created_at ?? null,
        },
        delivery: {
            attempt_count: attempts.length,
            last_attempt_at: last?.sentAt ?? last?.createdAt ?? null,
            last_result: last?.result ?? null,
            last_channel: last?.channel ?? null,
        },
        history: {
            source: attempts.length > 0 ? 'delivery_attempts' : 'none',
            notes: [
                'Delivery history from delivery_attempts; candidate audit for review transitions.',
                'Promise tracking intentionally deferred.',
            ],
        },
        promise_tracking: {
            supported: false,
            extension_point: 'future_collection_promise_tracking',
        },
        allowed_actions,
    };
}
