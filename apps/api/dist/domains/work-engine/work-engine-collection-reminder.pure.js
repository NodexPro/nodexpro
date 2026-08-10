/**
 * INV-4B — collection SLA / reminder candidate pure helpers.
 * Reuses Country Pack waiting_client cadence + Work Engine SLA obligations.
 * Financial eligibility is composed from Accounting Base + INV-2/INV-3 overdue rule
 * (via resolveIncomeOverdueCollectionIntake) — not stored as new debt truth.
 */
export const INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE = 'invoice_collection_followup';
export const COLLECTION_REMINDER_SCAN_PAGE_SIZE = 200;
export const COLLECTION_REMINDER_SCAN_MAX_PAGES = 25;
/** Work Engine owns V1 collection follow-up SLA duration (work_type policy default 7d). */
export const COLLECTION_WAITING_CLIENT_TIMEOUT_DEFAULT_MINUTES = 10080;
/**
 * Gate before creating a collection reminder candidate.
 * Paid / remaining=0 → false (do not create). Partial overdue → true.
 */
export function shouldCreateCollectionReminderCandidate(params) {
    if (params.workType !== INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
        return false;
    if (params.workState === 'done' || params.workState === 'archived')
        return false;
    return params.stillOpenOverdue === true;
}
export function composeCollectionReminderInvoiceTruth(params) {
    return {
        income_document_id: params.incomeDocumentId,
        document_number: params.documentNumber,
        document_date: params.documentDate,
        due_date: params.dueDate,
        days_overdue: params.daysOverdue,
        currency: params.currency,
        original_amount: params.originalAmount,
        paid_amount: params.paidAmount,
        remaining_balance: params.remainingBalance,
        payment_state_key: params.paymentStateKey,
        client_id: params.clientId,
    };
}
export const COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY = 'collection_reminder_review_aggregate';
/** INV-4C — approve stops at approved; send is INV-4D. */
export const COLLECTION_REMINDER_APPROVE_COMMAND = 'approve_reminder_candidate';
const APPROVABLE_COLLECTION_STATUSES = new Set(['pending_review', 'edited', 'delivery_failed']);
/**
 * Backend gate for collection reminder approve (INV-4C).
 * Paid / remaining=0 / not overdue → approve disabled. Does not close work item.
 */
export function resolveCollectionReminderApproveGate(params) {
    if (params.workType !== INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE) {
        return {
            allowed: false,
            reason_key: 'not_collection_work_item',
            disabled_reason: 'Candidate is not linked to an invoice collection work item',
        };
    }
    if (params.candidateStatus === 'approved') {
        return { allowed: true, reason_key: null, disabled_reason: null };
    }
    if (params.candidateStatus === 'cancelled' ||
        params.candidateStatus === 'sent' ||
        params.candidateStatus === 'sending') {
        return {
            allowed: false,
            reason_key: 'candidate_terminal',
            disabled_reason: `Cannot approve candidate in status ${params.candidateStatus}`,
        };
    }
    if (!APPROVABLE_COLLECTION_STATUSES.has(params.candidateStatus)) {
        return {
            allowed: false,
            reason_key: 'candidate_not_approvable_status',
            disabled_reason: `Cannot approve candidate in status ${params.candidateStatus}`,
        };
    }
    if (!params.canWrite) {
        return {
            allowed: false,
            reason_key: 'missing_permission',
            disabled_reason: 'Missing work_engine.write permission',
        };
    }
    if (params.paymentStateKey === 'paid' || params.remainingBalance <= 0) {
        return {
            allowed: false,
            reason_key: params.paymentStateKey === 'paid' ? 'invoice_paid' : 'no_remaining_balance',
            disabled_reason: 'Invoice is paid — no remaining balance to collect',
        };
    }
    if (!params.stillOpenOverdue) {
        return {
            allowed: false,
            reason_key: 'not_overdue',
            disabled_reason: 'Invoice is no longer overdue for collection',
        };
    }
    if (!params.messageBody.trim()) {
        return {
            allowed: false,
            reason_key: 'missing_message_body',
            disabled_reason: 'Reminder message body is empty',
        };
    }
    if (!params.hasDeliveryChannel) {
        return {
            allowed: false,
            reason_key: 'missing_delivery_channel',
            disabled_reason: 'No delivery channel available for future send',
        };
    }
    return { allowed: true, reason_key: null, disabled_reason: null };
}
export function isCollectionReminderMutatableStatus(status) {
    return (status === 'pending_review' ||
        status === 'edited' ||
        status === 'delivery_failed' ||
        status === 'snoozed');
}
/** INV-4D — send approved collection reminder (Delivery / DocFlow). */
export const COLLECTION_REMINDER_SEND_COMMAND = 'send_collection_reminder';
export const COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE = 'work_engine';
export const COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE = 'work_reminder_candidate';
const SENDABLE_COLLECTION_STATUSES = new Set(['approved', 'delivery_failed']);
export function resolveCollectionReminderSendGate(params) {
    if (params.candidateStatus === 'sent') {
        return {
            allowed: false,
            reason_key: 'already_sent',
            disabled_reason: 'Reminder already sent',
        };
    }
    if (!SENDABLE_COLLECTION_STATUSES.has(params.candidateStatus)) {
        return {
            allowed: false,
            reason_key: 'candidate_not_sendable_status',
            disabled_reason: `Cannot send candidate in status ${params.candidateStatus}`,
        };
    }
    const approveGate = resolveCollectionReminderApproveGate({
        workType: params.workType,
        // Treat sendable statuses as approvable for shared AB/overdue checks.
        candidateStatus: params.candidateStatus === 'approved' || params.candidateStatus === 'delivery_failed'
            ? 'pending_review'
            : params.candidateStatus,
        stillOpenOverdue: params.stillOpenOverdue,
        paymentStateKey: params.paymentStateKey,
        remainingBalance: params.remainingBalance,
        messageBody: params.messageBody,
        canWrite: params.canWrite,
        hasDeliveryChannel: params.hasDeliveryChannel,
    });
    if (!approveGate.allowed) {
        return {
            allowed: false,
            reason_key: approveGate.reason_key,
            disabled_reason: approveGate.disabled_reason,
        };
    }
    if (!params.hasRecipient) {
        return {
            allowed: false,
            reason_key: 'missing_recipient',
            disabled_reason: 'No eligible delivery recipient for selected channel',
        };
    }
    return { allowed: true, reason_key: null, disabled_reason: null };
}
/**
 * Ensure sent message carries CURRENT AB remaining (not stale approve-time debt).
 * Preserves accountant edits; replaces trailing canonical truth block when present.
 */
export function composeCollectionReminderSendMessage(params) {
    const subject = (params.subject ?? '').trim() || `תזכורת גבייה — ${params.documentNumber}`;
    const truthBlock = [
        '',
        '---',
        `מסמך: ${params.documentNumber}`,
        `יתרה לתשלום: ${params.remainingBalance} ${params.currency}`,
        `מצב תשלום: ${params.paymentStateKey}`,
        params.daysOverdue != null ? `ימי פיגור: ${params.daysOverdue}` : null,
    ]
        .filter((line) => line != null)
        .join('\n');
    const bodyBase = params.body.replace(/\n---\nמסמך:[\s\S]*$/u, '').trimEnd();
    return { subject, body: `${bodyBase}${truthBlock}` };
}
export function buildCollectionReminderSendIdempotencyKey(params) {
    return `collection_reminder_send:${params.candidateId}:${params.attemptOrdinal}`;
}
/** INV-4E — auto-close only when fully paid. */
export function shouldAutoCloseCollectionFollowup(params) {
    return params.paymentStateKey === 'paid' && params.remainingBalance <= 0;
}
export function resolveInvoiceCollectionControlStatus(params) {
    if (params.paymentStateKey === 'paid' && params.remainingBalance <= 0) {
        if (!params.collectionActive || params.collectionWorkState === 'done') {
            return 'collection_closed';
        }
        return 'paid';
    }
    if (params.wasReopened)
        return 'reopened';
    if (!params.collectionActive)
        return 'no_active_collection';
    const cs = params.latestCandidateStatus;
    if (cs === 'pending_review' || cs === 'edited' || cs === 'snoozed')
        return 'waiting_review';
    if (cs === 'approved')
        return 'approved';
    if (cs === 'sending')
        return 'sending';
    if (cs === 'sent')
        return 'waiting_payment';
    if (cs === 'delivery_failed')
        return 'delivery_failed';
    return 'waiting_payment';
}
export const INVOICE_COLLECTION_CONTROL_AGGREGATE_KEY = 'invoice_collection_control_aggregate';
export const INCOME_WORK_EVENT_INVOICE_PAID = 'income.invoice_paid';
export const INCOME_WORK_EVENT_INVOICE_PARTIALLY_PAID = 'income.invoice_partially_paid';
export function isIncomeInvoicePaidFactEventType(eventType) {
    return (eventType === INCOME_WORK_EVENT_INVOICE_PAID ||
        eventType === INCOME_WORK_EVENT_INVOICE_PARTIALLY_PAID);
}
