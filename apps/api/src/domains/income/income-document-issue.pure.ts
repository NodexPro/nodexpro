/**
 * Pure issue validation / snapshot helpers (no I/O).
 */

import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';

export interface DraftIssueReadinessInput {
  status: string;
  document_type: IncomeDocumentType | null;
  income_customer_id: string | null;
  one_time_customer_snapshot_json: Record<string, unknown> | null;
  draft_lines_json: unknown;
}

export function assertDraftReadyToIssue(draft: DraftIssueReadinessInput): void {
  if (draft.status === 'cancelled') {
    throw new Error('Cannot issue a cancelled draft');
  }
  if (draft.status === 'issued') {
    throw new Error('Draft is already issued');
  }
  if (draft.status !== 'draft') {
    throw new Error('Draft is not in draft status');
  }
  if (!draft.document_type) {
    throw new Error('document_type is required to issue');
  }
  const lines = Array.isArray(draft.draft_lines_json) ? draft.draft_lines_json : [];
  if (lines.length === 0) {
    throw new Error('Draft must have at least one line');
  }
  if (!draft.income_customer_id && !draft.one_time_customer_snapshot_json) {
    throw new Error('Customer or one-time customer snapshot is required');
  }
}

export function formatIncomeDocumentNumber(
  year: number,
  sequenceNumber: number,
  prefix: string | null,
): string {
  if (prefix?.trim()) return `${prefix.trim()}${sequenceNumber}`;
  return `${year}-${String(sequenceNumber).padStart(4, '0')}`;
}

export function buildLegalSnapshotForIssue(params: {
  country_code: string;
  ruleset_id: string | null;
  document_type: IncomeDocumentType;
  docType: IncomeAvailableDocumentType;
  business_type: string;
  business_type_raw: string | null;
  warnings: Array<{ code: string; message: string }>;
}): Record<string, unknown> {
  return {
    country_code: params.country_code,
    ruleset_id: params.ruleset_id,
    document_type: params.document_type,
    document_type_source: params.docType.source,
    business_type: params.business_type,
    business_type_raw: params.business_type_raw,
    legal_hint: params.docType.legal_hint,
    disabled_reason: params.docType.disabled_reason,
    warnings: params.warnings,
    not_legal_truth: true,
    source: 'income_issue_snapshot',
  };
}

export function buildTotalsSnapshotForIssue(
  draftTotalsPreview: Record<string, unknown> | null,
  currency: string,
  lineCount: number,
): Record<string, unknown> {
  return {
    ...(draftTotalsPreview ?? {}),
    preview: true,
    not_financial_truth: true,
    not_accounting_base_truth: true,
    currency,
    line_count: lineCount,
    accounting_base_post_pending: true,
  };
}

/** Future stage: post Accounting Base entry after issue. Income totals remain document snapshot only. */
export const ACCOUNTING_BASE_POST_AFTER_ISSUE_TODO =
  'TEMPORARY_ACCOUNTING_BASE_PENDING: post revenue entry to Accounting Base after income.document_issued';
