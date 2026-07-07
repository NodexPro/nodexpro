/**
 * Work Engine queue — invoice / retainer attention card (read-model only).
 */

import {
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_TYPE,
} from './work-engine-invoice-retainer.pure.js';

export const INVOICE_ATTENTION_QUEUE_BUCKET = 'invoice_attention' as const;

export const INVOICE_ATTENTION_MODULE_KEY = 'income' as const;

/** Existing income invoice/retainer workflow work_types only (no collection follow-up). */
export const INVOICE_ATTENTION_WORK_TYPES = [
  RECURRING_WORK_TYPE,
  RECURRING_FAILURE_WORK_TYPE,
] as const;

export type InvoiceAttentionWorkType = (typeof INVOICE_ATTENTION_WORK_TYPES)[number];

export type QueueAttentionCardTone = 'warning' | 'danger' | 'neutral';

export type QueueAttentionCardFilter = {
  queue_bucket: string;
  module_key: string | null;
  state: string | null;
  assigned_user_id: string | null;
  reviewer_user_id: string | null;
  client_id: string | null;
  period_key: string | null;
};

export type QueueAttentionCard = {
  key: 'invoice_attention' | 'errors';
  label: string;
  count: number;
  tone: QueueAttentionCardTone;
  description: string;
  clickable: boolean;
  filter: QueueAttentionCardFilter;
};

export function isInvoiceAttentionWorkType(workType: string): boolean {
  return (INVOICE_ATTENTION_WORK_TYPES as readonly string[]).includes(workType);
}

export function isInvoiceAttentionQueueBucket(
  bucket: string | null | undefined,
): bucket is typeof INVOICE_ATTENTION_QUEUE_BUCKET {
  return bucket === INVOICE_ATTENTION_QUEUE_BUCKET;
}

export function resolveInvoiceAttentionCardTone(params: {
  totalCount: number;
  failureCount: number;
}): QueueAttentionCardTone {
  if (params.totalCount <= 0) return 'neutral';
  if (params.failureCount > 0) return 'danger';
  return 'warning';
}

export type InvoiceAttentionWorkspaceTabBadgeVariant = 'neutral' | 'warning' | 'urgent';

export function resolveInvoiceAttentionWorkspaceTabBadge(params: {
  totalCount: number;
  failureCount: number;
}): {
  badge_count: number | null;
  badge_variant: InvoiceAttentionWorkspaceTabBadgeVariant | null;
} {
  if (params.totalCount <= 0) {
    return { badge_count: null, badge_variant: null };
  }
  const tone = resolveInvoiceAttentionCardTone(params);
  const badge_variant: InvoiceAttentionWorkspaceTabBadgeVariant =
    tone === 'danger' ? 'urgent' : tone === 'warning' ? 'warning' : 'neutral';
  return { badge_count: params.totalCount, badge_variant };
}

export function buildInvoiceAttentionCard(params: {
  totalCount: number;
  failureCount: number;
}): QueueAttentionCard {
  return {
    key: 'invoice_attention',
    label: 'Recurring',
    count: params.totalCount,
    tone: resolveInvoiceAttentionCardTone(params),
    description: 'משימות פעילות במכונה להפקת חשבוניות, ריטיינרים ובדיקת טיוטות',
    clickable: true,
    filter: {
      queue_bucket: INVOICE_ATTENTION_QUEUE_BUCKET,
      module_key: INVOICE_ATTENTION_MODULE_KEY,
      state: null,
      assigned_user_id: null,
      reviewer_user_id: null,
      client_id: null,
      period_key: null,
    },
  };
}
