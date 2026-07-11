/**
 * Retainer cycle draft review — issue month selector (read-model + command validation).
 */

import {
  buildTaxInvoiceIssueAndSendConfirmationMessage,
  buildTaxInvoiceIssueConfirmationMessage,
  formatHebrewDocumentMonthLabel,
} from './work-engine-invoice-retainer-cycle-draft-review-actions.pure.js';
import { IL_ISSUE_MONTH_WINDOW_FALLBACK } from '../income/income-issue-month-window-fallback.pure.js';

/**
 * Fallback window only. The resolved window comes from Country Pack legal values
 * (see income-issue-month-window-resolver.ts) and must be passed in by callers.
 */
export const ISSUE_MONTH_SELECTOR_MONTHS_BACK = IL_ISSUE_MONTH_WINDOW_FALLBACK.months_back;
export const ISSUE_MONTH_SELECTOR_MONTHS_AHEAD = IL_ISSUE_MONTH_WINDOW_FALLBACK.months_ahead;

export type WorkEngineRecurringCycleDraftReviewIssueMonthOption = {
  month_key: string;
  label: string;
  confirmation_message: string;
};

export type WorkEngineRecurringCycleDraftReviewIssueMonthSelector = {
  visible: boolean;
  current_month: string;
  default_month: string;
  selected_month: string;
  allowed_months: WorkEngineRecurringCycleDraftReviewIssueMonthOption[];
};

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function isValidIssueMonthKey(value: string): boolean {
  return MONTH_KEY_RE.test(value);
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = date.getUTCMonth() + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function currentMonthKeyFromTodayIso(todayIso: string): string {
  return todayIso.slice(0, 7);
}

export function buildAllowedIssueMonthKeys(params: {
  todayIso: string;
  monthsBack?: number;
  monthsAhead?: number;
}): string[] {
  const monthsBack = params.monthsBack ?? ISSUE_MONTH_SELECTOR_MONTHS_BACK;
  const monthsAhead = params.monthsAhead ?? ISSUE_MONTH_SELECTOR_MONTHS_AHEAD;
  const currentMonth = currentMonthKeyFromTodayIso(params.todayIso);
  const keys: string[] = [];
  for (let offset = -monthsBack; offset <= monthsAhead; offset += 1) {
    keys.push(shiftMonthKey(currentMonth, offset));
  }
  return keys;
}

export function formatHebrewMonthLabelFromKey(monthKey: string): string {
  if (!isValidIssueMonthKey(monthKey)) return monthKey;
  return formatHebrewDocumentMonthLabel(`${monthKey}-01`);
}

export function resolveDefaultIssueMonth(params: {
  todayIso: string;
  documentDate: string | null;
  allowedMonthKeys: string[];
}): string {
  const currentMonth = currentMonthKeyFromTodayIso(params.todayIso);
  const documentMonth =
    params.documentDate && /^\d{4}-\d{2}-\d{2}$/.test(params.documentDate)
      ? params.documentDate.slice(0, 7)
      : null;
  if (documentMonth && params.allowedMonthKeys.includes(documentMonth)) {
    return documentMonth;
  }
  return params.allowedMonthKeys.includes(currentMonth)
    ? currentMonth
    : (params.allowedMonthKeys[0] ?? currentMonth);
}

export function buildIssueMonthSelector(params: {
  todayIso: string;
  documentDate: string | null;
  recipientEmail?: string | null;
  mode: 'issue' | 'issue_and_send';
  monthsBack?: number;
  monthsAhead?: number;
}): WorkEngineRecurringCycleDraftReviewIssueMonthSelector {
  const allowedMonthKeys = buildAllowedIssueMonthKeys({
    todayIso: params.todayIso,
    monthsBack: params.monthsBack,
    monthsAhead: params.monthsAhead,
  });
  const currentMonth = currentMonthKeyFromTodayIso(params.todayIso);
  const defaultMonth = resolveDefaultIssueMonth({
    todayIso: params.todayIso,
    documentDate: params.documentDate,
    allowedMonthKeys,
  });
  const allowed_months = allowedMonthKeys.map((month_key) => {
    const label = formatHebrewMonthLabelFromKey(month_key);
    const confirmation_message =
      params.mode === 'issue_and_send'
        ? buildTaxInvoiceIssueAndSendConfirmationMessage(
            label,
            params.recipientEmail?.trim() || '—',
          )
        : buildTaxInvoiceIssueConfirmationMessage(label);
    return { month_key, label, confirmation_message };
  });
  return {
    visible: true,
    current_month: currentMonth,
    default_month: defaultMonth,
    selected_month: defaultMonth,
    allowed_months,
  };
}

export function parseIssueMonthFromCommandBody(body: Record<string, unknown>): string | null {
  const raw = body.issue_month;
  if (raw == null || raw === '') return null;
  const value = String(raw).trim();
  return isValidIssueMonthKey(value) ? value : null;
}

export function assertIssueMonthAllowed(params: {
  todayIso: string;
  issueMonth: string;
  monthsBack?: number;
  monthsAhead?: number;
}): void {
  if (!isValidIssueMonthKey(params.issueMonth)) {
    throw new Error('issue_month must be YYYY-MM');
  }
  const allowed = buildAllowedIssueMonthKeys({
    todayIso: params.todayIso,
    monthsBack: params.monthsBack,
    monthsAhead: params.monthsAhead,
  });
  if (!allowed.includes(params.issueMonth)) {
    throw new Error('issue_month is outside the allowed accounting month window');
  }
}

export function resolveIssueDateForIssueMonth(
  issueMonth: string,
  draftDocumentDate: string | null | undefined,
): string {
  if (!isValidIssueMonthKey(issueMonth)) {
    throw new Error('issue_month must be YYYY-MM');
  }
  const [year, month] = issueMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayRaw = draftDocumentDate?.slice(8, 10) ?? '01';
  const day = Number(dayRaw);
  const clampedDay = Number.isFinite(day)
    ? Math.min(Math.max(1, day), lastDay)
    : 1;
  return `${issueMonth}-${String(clampedDay).padStart(2, '0')}`;
}
