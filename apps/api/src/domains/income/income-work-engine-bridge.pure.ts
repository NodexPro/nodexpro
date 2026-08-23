/**
 * INC-8 / INV-4A — pure helpers for Income → Work Engine event envelopes.
 */

export const INCOME_WORK_ENGINE_SOURCE_MODULE = 'income' as const;
export const INCOME_WORK_ENGINE_ENTITY_TYPE = 'income_document' as const;
export const INCOME_WORK_ENGINE_SCHEMA_VERSION = 1;

export const INCOME_WORK_EVENT_DOCUMENT_ISSUED = 'income.document_issued' as const;
export const INCOME_WORK_EVENT_DUE_DATE_SET = 'income.invoice_due_date_set' as const;
export const INCOME_WORK_EVENT_OVERDUE = 'income.invoice_overdue' as const;
export const INCOME_WORK_EVENT_CREDIT_ISSUED = 'income.credit_document_issued' as const;
export const INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL = 'income.document_sent_by_email' as const;
export const INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW = 'income.document_sent_by_docflow' as const;
export const INCOME_WORK_EVENT_PRELIMINARY_DOCUMENT_CLOSED =
  'income.preliminary_document_closed' as const;
export const INCOME_WORK_EVENT_PRELIMINARY_DOCUMENT_REOPENED =
  'income.preliminary_document_reopened' as const;

/**
 * Paid/partial events are emitted by Accounting Base INV-5A after allocation.
 * `income.payment_failed` remains reserved (not emitted).
 * Catalog maps these without work_item creation for now.
 */
export const INCOME_WORK_EVENTS_DEFERRED = [
  'income.invoice_paid',
  'income.invoice_partially_paid',
  'income.payment_failed',
] as const;

/** Calendar month period — Work Engine PERIOD_KEY_REGEX (`month:YYYY-MM`). */
export function incomeDocumentPeriodKey(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(isoDate).trim());
  if (!m) {
    const fallback = String(isoDate).trim().slice(0, 7);
    return `month:${fallback}`;
  }
  return `month:${m[1]}-${m[2]}`;
}

/**
 * INV-4A — per-invoice collection period key.
 * Makes work_item dedup tuple (org, client, module, work_type, period_key)
 * unique per invoice without changing the global Work Engine unique index.
 */
export function incomeInvoiceCollectionPeriodKey(incomeDocumentId: string): string {
  const id = String(incomeDocumentId ?? '').trim().toLowerCase();
  return `invoice:${id}`;
}

export function resolveIncomeWorkEngineClientId(representedClientId: string | null): string | null {
  return representedClientId && String(representedClientId).trim() ? representedClientId : null;
}

export function amountReferenceFromTotalsSnapshot(
  totals: Record<string, unknown> | null | undefined,
): number | null {
  if (!totals || typeof totals !== 'object') return null;
  const raw =
    totals.amount_reference ??
    totals.subtotal_reference ??
    totals.total_reference ??
    null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function customerDisplayFromSnapshot(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const name = snapshot.display_name;
  return name != null && String(name).trim() ? String(name).trim() : null;
}

export function isCreditIncomeDocumentType(documentType: string): boolean {
  return documentType === 'credit_tax_invoice';
}

/** Broad collectible catalog (INV-2 due dimension). Not all have AB payment truth. */
export function isInvoiceCollectionDocumentType(documentType: string): boolean {
  return (
    documentType === 'tax_invoice' ||
    documentType === 'tax_invoice_receipt' ||
    documentType === 'deal_invoice'
  );
}

export function isOverdueByDueDate(dueDate: string, todayIso: string): boolean {
  return dueDate < todayIso;
}

/** Scan page size / max pages — catch-up via ordered pagination (not a hard 200 forever). */
export const INCOME_OVERDUE_SCAN_PAGE_SIZE = 200;
export const INCOME_OVERDUE_SCAN_MAX_PAGES = 25;
