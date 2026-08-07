/**
 * INV-2A — pure composition helpers for invoice lifecycle dimensions.
 * Reuses Accounting Base payment state + Income collectible-type catalog.
 * Does not store overdue / delivery / payment status on income_documents.
 */

import {
  isSupportedIncomePaymentDocumentType,
  resolveIncomeInvoicePaymentState,
  type IncomeInvoicePaymentStateKey,
} from '../accounting-base/accounting-base-income-payment.pure.js';
import { isInvoiceCollectionDocumentType } from './income-work-engine-bridge.pure.js';
import type {
  InvoiceLifecycleChannelSummary,
  InvoiceLifecycleDeliveryStateKey,
  InvoiceLifecycleDueStateKey,
} from './invoice-lifecycle.types.js';

export type LifecycleDeliveryAttemptSlice = {
  channel: 'email' | 'docflow' | string;
  result: 'pending' | 'sent' | 'failed' | string;
  sentAt: string | null;
  createdAt: string;
};

function attemptAt(row: LifecycleDeliveryAttemptSlice): string {
  return row.sentAt && String(row.sentAt).trim() ? String(row.sentAt) : row.createdAt;
}

function emptyChannel(): InvoiceLifecycleChannelSummary {
  return {
    attempt_count: 0,
    last_attempt_at: null,
    last_success_at: null,
    last_failure_at: null,
  };
}

function summarizeChannel(
  rows: LifecycleDeliveryAttemptSlice[],
): InvoiceLifecycleChannelSummary {
  if (rows.length === 0) return emptyChannel();
  let lastAttemptAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastFailureAt: string | null = null;
  for (const row of rows) {
    const at = attemptAt(row);
    if (!lastAttemptAt || at > lastAttemptAt) lastAttemptAt = at;
    if (row.result === 'sent') {
      if (!lastSuccessAt || at > lastSuccessAt) lastSuccessAt = at;
    }
    if (row.result === 'failed') {
      if (!lastFailureAt || at > lastFailureAt) lastFailureAt = at;
    }
  }
  return {
    attempt_count: rows.length,
    last_attempt_at: lastAttemptAt,
    last_success_at: lastSuccessAt,
    last_failure_at: lastFailureAt,
  };
}

/**
 * V1 delivery state:
 * - any sent → sent (later failure does not erase sent)
 * - no sent + latest terminal failed → failed
 * - else not_sent
 */
export function composeInvoiceLifecycleDeliveryDimension(
  attempts: LifecycleDeliveryAttemptSlice[],
): {
  state_key: InvoiceLifecycleDeliveryStateKey;
  attempt_count: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  channels: { email: InvoiceLifecycleChannelSummary; docflow: InvoiceLifecycleChannelSummary };
} {
  const email = summarizeChannel(attempts.filter((a) => a.channel === 'email'));
  const docflow = summarizeChannel(attempts.filter((a) => a.channel === 'docflow'));
  const all = summarizeChannel(attempts);

  const anySent = attempts.some((a) => a.result === 'sent');
  if (anySent) {
    return { state_key: 'sent', ...all, channels: { email, docflow } };
  }

  const terminal = attempts
    .filter((a) => a.result === 'sent' || a.result === 'failed')
    .sort((a, b) => attemptAt(b).localeCompare(attemptAt(a)));
  if (terminal.length > 0 && terminal[0]!.result === 'failed') {
    return { state_key: 'failed', ...all, channels: { email, docflow } };
  }

  return { state_key: 'not_sent', ...all, channels: { email, docflow } };
}

function parseIsoDateOnly(value: string | null | undefined): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
}

/** Calendar day difference (due → today); null if either date invalid. */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number | null {
  const from = parseIsoDateOnly(fromIso);
  const to = parseIsoDateOnly(toIso);
  if (!from || !to) return null;
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.floor((b - a) / 86_400_000);
}

export function composeInvoiceLifecycleDueDimension(params: {
  documentStatus: string;
  documentType: string;
  dueDate: string | null;
  remainingBalance: number;
  paymentStateKey: IncomeInvoicePaymentStateKey;
  todayIso: string;
}): {
  state_key: InvoiceLifecycleDueStateKey;
  overdue: boolean;
  overdue_since: string | null;
  days_overdue: number | null;
} {
  const dueDate = parseIsoDateOnly(params.dueDate);
  const today = parseIsoDateOnly(params.todayIso) ?? params.todayIso.slice(0, 10);

  if (params.documentStatus !== 'issued') {
    return { state_key: 'not_applicable', overdue: false, overdue_since: null, days_overdue: null };
  }
  if (!isInvoiceCollectionDocumentType(params.documentType)) {
    return { state_key: 'not_applicable', overdue: false, overdue_since: null, days_overdue: null };
  }
  if (!dueDate) {
    return { state_key: 'not_applicable', overdue: false, overdue_since: null, days_overdue: null };
  }
  if (params.paymentStateKey === 'paid' || params.remainingBalance <= 0) {
    return { state_key: 'not_due', overdue: false, overdue_since: null, days_overdue: null };
  }

  const overdue = dueDate < today;
  if (!overdue) {
    return { state_key: 'not_due', overdue: false, overdue_since: null, days_overdue: null };
  }

  const days = daysBetweenIsoDates(dueDate, today);
  return {
    state_key: 'overdue',
    overdue: true,
    overdue_since: dueDate,
    days_overdue: days != null && days > 0 ? days : days === 0 ? 0 : null,
  };
}

/** Re-export AB payment state for composer/tests — single formula. */
export function composeInvoiceLifecyclePaymentState(
  originalAmount: number,
  paidAmount: number,
): ReturnType<typeof resolveIncomeInvoicePaymentState> {
  return resolveIncomeInvoicePaymentState(originalAmount, paidAmount);
}

/**
 * INV-4A — overdue collection intake eligibility.
 * AB-supported payment types only + INV-2 overdue (due past AND remaining > 0).
 */
export function resolveIncomeOverdueCollectionIntake(params: {
  documentStatus: string;
  documentType: string;
  dueDate: string | null;
  originalAmount: number;
  paidAmount: number;
  todayIso: string;
}): {
  eligible: boolean;
  payment_state_key: IncomeInvoicePaymentStateKey;
  remaining_balance: number;
  overdue_since: string | null;
  days_overdue: number | null;
} {
  const payment = resolveIncomeInvoicePaymentState(params.originalAmount, params.paidAmount);
  if (!isSupportedIncomePaymentDocumentType(params.documentType)) {
    return {
      eligible: false,
      payment_state_key: payment.payment_state_key,
      remaining_balance: payment.remaining_balance,
      overdue_since: null,
      days_overdue: null,
    };
  }
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: params.documentStatus,
    documentType: params.documentType,
    dueDate: params.dueDate,
    remainingBalance: payment.remaining_balance,
    paymentStateKey: payment.payment_state_key,
    todayIso: params.todayIso,
  });
  return {
    eligible: due.overdue === true,
    payment_state_key: payment.payment_state_key,
    remaining_balance: payment.remaining_balance,
    overdue_since: due.overdue_since,
    days_overdue: due.days_overdue,
  };
}

/** Matches Income overdue scan / invoices-tab calendar day (UTC ISO date). */
export function backendTodayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
