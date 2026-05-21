/**
 * INC-8 — pure helpers for Income → Work Engine event envelopes.
 */

export const INCOME_WORK_ENGINE_SOURCE_MODULE = 'income' as const;
export const INCOME_WORK_ENGINE_ENTITY_TYPE = 'income_document' as const;
export const INCOME_WORK_ENGINE_SCHEMA_VERSION = 1;

export const INCOME_WORK_EVENT_DOCUMENT_ISSUED = 'income.document_issued' as const;
export const INCOME_WORK_EVENT_DUE_DATE_SET = 'income.invoice_due_date_set' as const;
export const INCOME_WORK_EVENT_OVERDUE = 'income.invoice_overdue' as const;
export const INCOME_WORK_EVENT_CREDIT_ISSUED = 'income.credit_document_issued' as const;

/** Not emitted in INC-8 — payment/status pipeline pending. */
export const INCOME_WORK_EVENTS_DEFERRED = [
  'income.invoice_paid',
  'income.invoice_partially_paid',
  'income.payment_failed',
] as const;

export function incomeDocumentPeriodKey(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(isoDate).trim());
  if (!m) return isoDate.slice(0, 7);
  return `${m[1]}-${m[2]}`;
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
