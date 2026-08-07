/**
 * INV-2C — lifecycle health / anomaly warnings (pure over INV-2A dimensions).
 * Presentation/consistency only — does not repair or store.
 */

import type {
  InvoiceLifecycleAggregate,
  InvoiceLifecycleHealth,
  InvoiceLifecycleWarning,
  InvoiceLifecycleWarningSeverity,
} from './invoice-lifecycle.types.js';

type HealthInput = Pick<
  InvoiceLifecycleAggregate,
  'payment' | 'delivery' | 'due' | 'collection' | 'income_document_id'
>;

function warning(params: {
  code: InvoiceLifecycleWarning['code'];
  severity: InvoiceLifecycleWarningSeverity;
  label: string;
  label_he: string;
  message: string;
  repair_owner: InvoiceLifecycleWarning['repair_owner'];
  action_required: boolean;
  related_entity_id?: string | null;
}): InvoiceLifecycleWarning {
  return {
    code: params.code,
    severity: params.severity,
    label: params.label,
    label_he: params.label_he,
    message: params.message,
    repair_owner: params.repair_owner,
    action_required: params.action_required,
    related_entity_id: params.related_entity_id ?? null,
    repair_action: null,
  };
}

function resolveHealthStateKey(
  warnings: InvoiceLifecycleWarning[],
): InvoiceLifecycleHealth['state_key'] {
  if (warnings.length === 0) return 'ok';
  if (warnings.some((w) => w.action_required || w.severity === 'action_required')) {
    return 'attention_required';
  }
  return 'warning';
}

/**
 * Detect cross-module inconsistencies from already-loaded lifecycle dimensions.
 *
 * NOT implemented (INV-4 / future): overdue_without_collection_item —
 * overdue scan is scheduler-batched (limit 200), does not guarantee immediate
 * work-item intake, and does not filter unpaid/collectible types. A lag is
 * legitimate; do not treat missing collection as anomaly in INV-2C.
 */
export function composeInvoiceLifecycleHealth(input: HealthInput): InvoiceLifecycleHealth {
  const warnings: InvoiceLifecycleWarning[] = [];

  // A — Paid + active collection (actionable inconsistency)
  if (input.payment.state_key === 'paid' && input.collection.active) {
    warnings.push(
      warning({
        code: 'collection_stale_after_paid',
        severity: 'action_required',
        label: 'Collection still active after payment',
        label_he: 'גבייה פעילה לאחר תשלום מלא',
        message:
          'Accounting Base reports remaining_balance = 0 (paid), but an active invoice_collection_followup work item still exists.',
        repair_owner: 'work_engine',
        action_required: true,
        related_entity_id: input.collection.work_item_id,
      }),
    );
  }

  // C — Sent succeeded historically; a later attempt failed (informational)
  const lastSuccess = input.delivery.last_success_at;
  const lastFailure = input.delivery.last_failure_at;
  if (
    input.delivery.state_key === 'sent' &&
    lastSuccess &&
    lastFailure &&
    lastFailure > lastSuccess
  ) {
    warnings.push(
      warning({
        code: 'delivery_later_attempt_failed',
        severity: 'info',
        label: 'Later delivery attempt failed',
        label_he: 'ניסיון שליחה מאוחר יותר נכשל',
        message:
          'At least one successful send exists; a later delivery attempt failed. Delivery state remains sent.',
        repair_owner: 'delivery',
        action_required: false,
        related_entity_id: input.income_document_id,
      }),
    );
  }

  // Delivery-only failures (state_key=failed) are NORMAL lifecycle — not anomalies.

  return {
    state_key: resolveHealthStateKey(warnings),
    warning_count: warnings.length,
    warnings,
  };
}
