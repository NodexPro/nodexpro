/**
 * INV-1 P9 — Income document sent facts consumed by Work Engine (pure helpers).
 */

import {
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
} from '../income/income-work-engine-bridge.pure.js';
import { RECURRING_SEND_FOLLOWUP_WORK_TYPE } from './work-engine-invoice-retainer.pure.js';

export const INCOME_DOCUMENT_SENT_FACT_EVENT_TYPES = new Set<string>([
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
]);

export function isIncomeDocumentSentFactEventType(eventType: string): boolean {
  return INCOME_DOCUMENT_SENT_FACT_EVENT_TYPES.has(eventType);
}

export type RecurringSendFollowupWorkItemMatch = {
  module_key: string;
  work_type: string;
  source_entity_id: string;
  period_key: string;
  work_state: string;
};

export function matchesRecurringSendFollowupWorkItem(
  item: RecurringSendFollowupWorkItemMatch,
  params: { recurringProfileId: string; periodKey: string },
): boolean {
  return (
    item.module_key === 'income' &&
    item.work_type === RECURRING_SEND_FOLLOWUP_WORK_TYPE &&
    item.source_entity_id === params.recurringProfileId &&
    item.period_key === params.periodKey &&
    item.work_state !== 'done' &&
    item.work_state !== 'archived'
  );
}
