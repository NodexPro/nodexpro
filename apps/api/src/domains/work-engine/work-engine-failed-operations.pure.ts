/**
 * Work Engine queue — failed operational items summary (read-model only).
 */

import type { QueueAttentionCard, QueueAttentionCardTone } from './work-engine-queue-invoice-attention.pure.js';

export const FAILED_OPERATIONS_SOURCE_KEYS = [
  'delivery_attempts_failed',
  'income_pdf_render_failed',
  'work_event_intake_failed',
  'retainer_generation_failed',
  'accounting_posting_failed',
] as const;

export type FailedOperationsSourceKey = (typeof FAILED_OPERATIONS_SOURCE_KEYS)[number];

export type FailedOperationsSourceCount = {
  source_key: FailedOperationsSourceKey;
  label: string;
  count: number;
};

export type FailedOperationActionKind = 'disabled' | 'navigate';

export type FailedOperationActionDescriptor = {
  action_key: string;
  label: string;
  enabled: boolean;
  reason: string | null;
  kind: FailedOperationActionKind;
};

export type FailedOperationRow = {
  id: string;
  client_id: string | null;
  client_label: string;
  module_key: string;
  module_label: string;
  source_key: FailedOperationsSourceKey;
  source_label: string;
  error_key: string;
  error_label: string;
  how_to_fix: string;
  occurred_at: string;
  occurred_at_label: string;
  severity: 'critical' | 'warning' | 'info';
  severity_label: string;
  status: string;
  status_label: string;
  reference_label: string;
  available_actions: FailedOperationActionDescriptor[];
};

export type FailedOperationsSummary = {
  total_count: number;
  sources: FailedOperationsSourceCount[];
  last_seen_at: string | null;
  severity_label: string;
  card: QueueAttentionCard;
  rows: FailedOperationRow[];
  notes: string[];
};

const SOURCE_LABELS: Record<FailedOperationsSourceKey, string> = {
  delivery_attempts_failed: 'Delivery failed',
  income_pdf_render_failed: 'PDF render failed',
  work_event_intake_failed: 'Event intake failed',
  retainer_generation_failed: 'Retainer generation failed',
  accounting_posting_failed: 'Accounting posting failed',
};

const MODULE_LABELS: Record<string, string> = {
  income: 'Income',
  work_engine: 'Work Engine',
  'work-engine': 'Work Engine',
  'client-operations': 'Client Operations',
  docflow: 'DocFlow',
  delivery: 'Delivery',
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const FAILED_OPERATIONS_NOT_INCLUDED_NOTES = [
  'Payment match failures: not included yet — no persisted org-scoped failure status found.',
] as const;

export function failedOperationsSourceLabel(sourceKey: FailedOperationsSourceKey): string {
  return SOURCE_LABELS[sourceKey];
}

export function resolveModuleLabel(moduleKey: string): string {
  const key = (moduleKey ?? '').trim();
  if (!key) return '—';
  return MODULE_LABELS[key] ?? key;
}

export function formatFailedOperationOccurredLabel(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = SHORT_MONTHS[date.getUTCMonth()] ?? '';
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

export function resolveClientLabel(clientId: string | null, clientNameById: Map<string, string>): string {
  if (!clientId) return '—';
  return clientNameById.get(clientId) ?? '—';
}

export function buildDeliveryHowToFix(channel: string | null, failureReason: string | null): string {
  const reason = (failureReason ?? '').trim().toLowerCase();
  if (reason.includes('recipient') || reason.includes('email')) {
    return 'Check recipient email and sender configuration, then retry send.';
  }
  if ((channel ?? '').trim() === 'docflow') {
    return 'Open the DocFlow thread and retry send.';
  }
  if ((channel ?? '').trim() === 'email') {
    return 'Check recipient email and sender configuration, then retry send.';
  }
  return 'Review the delivery failure reason and retry.';
}

export function buildDefaultFailedOperationActions(): FailedOperationActionDescriptor[] {
  return [
    {
      action_key: 'open_source',
      label: 'Open',
      enabled: false,
      reason: 'Source navigation is not available yet.',
      kind: 'disabled',
    },
  ];
}

export function buildDeliveryFailedRow(params: {
  id: string;
  client_id: string | null;
  client_label: string;
  source_module: string;
  channel: string;
  failure_reason: string | null;
  source_entity_type: string;
  source_entity_id: string;
  occurred_at: string;
}): FailedOperationRow {
  const reference =
    params.failure_reason?.trim() ||
    `${params.source_entity_type} ${String(params.source_entity_id).slice(0, 8)}`;
  return {
    id: `delivery:${params.id}`,
    client_id: params.client_id,
    client_label: params.client_label,
    module_key: params.source_module,
    module_label: resolveModuleLabel(params.source_module),
    source_key: 'delivery_attempts_failed',
    source_label: SOURCE_LABELS.delivery_attempts_failed,
    error_key: 'delivery_failed',
    error_label: params.failure_reason?.trim() || 'Delivery failed',
    how_to_fix: buildDeliveryHowToFix(params.channel, params.failure_reason),
    occurred_at: params.occurred_at,
    occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
    severity: 'critical',
    severity_label: 'Critical',
    status: 'failed',
    status_label: 'Failed',
    reference_label: reference,
    available_actions: buildDefaultFailedOperationActions(),
  };
}

export function buildIncomePdfFailedRow(params: {
  id: string;
  client_id: string | null;
  client_label: string;
  document_type: string;
  document_number: string | null;
  occurred_at: string;
}): FailedOperationRow {
  const reference = params.document_number
    ? `${params.document_type} #${params.document_number}`
    : params.document_type;
  return {
    id: `income_pdf:${params.id}`,
    client_id: params.client_id,
    client_label: params.client_label,
    module_key: 'income',
    module_label: resolveModuleLabel('income'),
    source_key: 'income_pdf_render_failed',
    source_label: SOURCE_LABELS.income_pdf_render_failed,
    error_key: 'pdf_render_failed',
    error_label: 'PDF render failed',
    how_to_fix: 'Open the document and retry PDF render.',
    occurred_at: params.occurred_at,
    occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
    severity: 'critical',
    severity_label: 'Critical',
    status: 'failed',
    status_label: 'Failed',
    reference_label: reference,
    available_actions: buildDefaultFailedOperationActions(),
  };
}

export function buildWorkEventFailedRow(params: {
  id: string;
  client_id: string | null;
  client_label: string;
  source_module: string;
  event_type: string;
  processing_error: string | null;
  occurred_at: string;
}): FailedOperationRow {
  return {
    id: `work_event:${params.id}`,
    client_id: params.client_id,
    client_label: params.client_label,
    module_key: params.source_module,
    module_label: resolveModuleLabel(params.source_module),
    source_key: 'work_event_intake_failed',
    source_label: SOURCE_LABELS.work_event_intake_failed,
    error_key: 'event_intake_failed',
    error_label: params.processing_error?.trim() || 'Event intake failed',
    how_to_fix: 'Review event payload and source module.',
    occurred_at: params.occurred_at,
    occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
    severity: 'critical',
    severity_label: 'Critical',
    status: 'failed',
    status_label: 'Failed',
    reference_label: params.processing_error?.trim() || params.event_type,
    available_actions: buildDefaultFailedOperationActions(),
  };
}

export function buildRetainerGenerationFailedRow(params: {
  id: string;
  client_id: string | null;
  client_label: string;
  cycle_number: number;
  failure_reason: string | null;
  occurred_at: string;
}): FailedOperationRow {
  return {
    id: `retainer:${params.id}`,
    client_id: params.client_id,
    client_label: params.client_label,
    module_key: 'income',
    module_label: resolveModuleLabel('income'),
    source_key: 'retainer_generation_failed',
    source_label: SOURCE_LABELS.retainer_generation_failed,
    error_key: 'retainer_generation_failed',
    error_label: params.failure_reason?.trim() || 'Retainer generation failed',
    how_to_fix: 'Review the retainer schedule and retry generation.',
    occurred_at: params.occurred_at,
    occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
    severity: 'critical',
    severity_label: 'Critical',
    status: 'failed',
    status_label: 'Failed',
    reference_label: `Cycle #${params.cycle_number}`,
    available_actions: buildDefaultFailedOperationActions(),
  };
}

export function buildAccountingPostingFailedRow(params: {
  id: string;
  client_id: string | null;
  client_label: string;
  document_type: string;
  document_number: string | null;
  occurred_at: string;
}): FailedOperationRow {
  const reference = params.document_number
    ? `${params.document_type} #${params.document_number}`
    : params.document_type;
  return {
    id: `accounting_posting:${params.id}`,
    client_id: params.client_id,
    client_label: params.client_label,
    module_key: 'income',
    module_label: resolveModuleLabel('income'),
    source_key: 'accounting_posting_failed',
    source_label: SOURCE_LABELS.accounting_posting_failed,
    error_key: 'accounting_posting_failed',
    error_label: 'Accounting posting failed',
    how_to_fix: 'Open the document and retry accounting posting.',
    occurred_at: params.occurred_at,
    occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
    severity: 'critical',
    severity_label: 'Critical',
    status: 'failed',
    status_label: 'Failed',
    reference_label: reference,
    available_actions: buildDefaultFailedOperationActions(),
  };
}

export function resolveFailedOperationsCardTone(totalCount: number): QueueAttentionCardTone {
  if (totalCount <= 0) return 'neutral';
  return 'danger';
}

export function resolveFailedOperationsSeverityLabel(totalCount: number): string {
  if (totalCount <= 0) return 'No operational errors';
  return 'Operational errors require attention';
}

export function mergeFailedOperationRows(rows: FailedOperationRow[], limit = 200): FailedOperationRow[] {
  return [...rows]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limit);
}

export function resolveLastSeenAtFromRows(rows: FailedOperationRow[]): string | null {
  if (!rows.length) return null;
  return rows[0]?.occurred_at ?? null;
}

export function buildFailedOperationsSummary(params: {
  deliveryFailedCount: number;
  incomePdfFailedCount: number;
  workEventFailedCount: number;
  retainerFailedCount: number;
  accountingPostingFailedCount: number;
  rows: FailedOperationRow[];
  notes?: string[];
}): FailedOperationsSummary {
  const sources: FailedOperationsSourceCount[] = [
    {
      source_key: 'delivery_attempts_failed',
      label: SOURCE_LABELS.delivery_attempts_failed,
      count: params.deliveryFailedCount,
    },
    {
      source_key: 'income_pdf_render_failed',
      label: SOURCE_LABELS.income_pdf_render_failed,
      count: params.incomePdfFailedCount,
    },
    {
      source_key: 'work_event_intake_failed',
      label: SOURCE_LABELS.work_event_intake_failed,
      count: params.workEventFailedCount,
    },
    {
      source_key: 'retainer_generation_failed',
      label: SOURCE_LABELS.retainer_generation_failed,
      count: params.retainerFailedCount,
    },
    {
      source_key: 'accounting_posting_failed',
      label: SOURCE_LABELS.accounting_posting_failed,
      count: params.accountingPostingFailedCount,
    },
  ];
  const total_count = sources.reduce((sum, row) => sum + row.count, 0);
  const tone = resolveFailedOperationsCardTone(total_count);
  const mergedRows = mergeFailedOperationRows(params.rows);

  return {
    total_count,
    sources,
    last_seen_at: resolveLastSeenAtFromRows(mergedRows),
    severity_label: resolveFailedOperationsSeverityLabel(total_count),
    card: {
      key: 'errors',
      label: 'Errors',
      count: total_count,
      tone,
      description: 'Failed delivery, PDF render, event intake, retainer, and posting operations',
      clickable: total_count > 0,
      modal_key: 'failed_operations',
      filter: {
        queue_bucket: '',
        module_key: null,
        state: null,
        assigned_user_id: null,
        reviewer_user_id: null,
        client_id: null,
        period_key: null,
      },
    },
    rows: mergedRows,
    notes: params.notes ?? [...FAILED_OPERATIONS_NOT_INCLUDED_NOTES],
  };
}
