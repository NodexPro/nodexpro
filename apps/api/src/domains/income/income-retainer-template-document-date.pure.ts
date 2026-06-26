/**
 * Retainer template draft — document date must not be before today.
 */

import { badRequest } from '../../shared/errors.js';

export const RETAINER_TEMPLATE_DOCUMENT_DATE_BEFORE_TODAY_ERROR =
  'לא ניתן לבחור תאריך מסמך מוקדם מהיום.';

export function todayIsoDate(reference: Date = new Date()): string {
  return reference.toISOString().slice(0, 10);
}

export function isDocumentDateBeforeToday(
  documentDate: string,
  today: string = todayIsoDate(),
): boolean {
  return documentDate < today;
}

export function coerceRetainerTemplateDocumentDate(
  documentDate: string | null | undefined,
  today: string = todayIsoDate(),
): string {
  const raw = typeof documentDate === 'string' ? documentDate.trim() : '';
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw >= today) return raw;
  return today;
}

export function assertRetainerTemplateDocumentDateNotBeforeToday(
  documentDate: string,
  today: string = todayIsoDate(),
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) {
    throw badRequest('document_date must be YYYY-MM-DD');
  }
  if (isDocumentDateBeforeToday(documentDate, today)) {
    throw badRequest(
      RETAINER_TEMPLATE_DOCUMENT_DATE_BEFORE_TODAY_ERROR,
      'retainer_template_document_date_before_today',
    );
  }
}
