/**
 * Overdue unissued recurring schedule — lifecycle + issue-date bounds (read-model / validation).
 *
 * Applies only when planned schedule date is before today and the document was never issued.
 */

export const OVERDUE_UNISSUED_STATUS_KEY = 'not_issued' as const;
export const OVERDUE_UNISSUED_STATUS_LABEL = 'לא הופק' as const;

export const OVERDUE_ISSUE_DATE_TOO_EARLY_HE =
  'לא ניתן להפיק מסמך מחזור באיחור בתאריך מוקדם מהיום. בחרו היום או תאריך עתידי.';

export type OverdueUnissuedIssueDateBounds = {
  issue_default_date: string;
  issue_min_date: string;
  issue_max_date: string | null;
};

export function isRecurringScheduleDateOverdue(
  scheduledDocumentDate: string | null | undefined,
  todayIso: string,
): boolean {
  const scheduled = String(scheduledDocumentDate ?? '').trim();
  const today = String(todayIso ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return false;
  }
  return scheduled < today;
}

export function buildOverdueUnissuedIssueDateBounds(
  todayIso: string,
): OverdueUnissuedIssueDateBounds {
  const today = String(todayIso).trim().slice(0, 10);
  return {
    issue_default_date: today,
    issue_min_date: today,
    issue_max_date: null,
  };
}

/** Ensure resolved issue date is not before min (e.g. today for overdue cycles). */
export function clampIssueDateNotBeforeMin(issueDate: string, minDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(minDate)) {
    return issueDate;
  }
  return issueDate < minDate ? minDate : issueDate;
}

export function assertIssueDateNotBeforeMin(issueDate: string, minDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw new Error('document_date must be YYYY-MM-DD');
  }
  if (issueDate < minDate) {
    throw new Error(OVERDUE_ISSUE_DATE_TOO_EARLY_HE);
  }
}
