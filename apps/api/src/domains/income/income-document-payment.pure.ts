/**
 * INV-5B — pure helpers for Income payment orchestration + automatic receipt.
 */

export const INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT = 'record_income_document_payment' as const;
export const INCOME_DOCUMENT_PAYMENT_CASE_KEY = 'income_document_payment_case' as const;
export const INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE =
  'payment_receipt_for_invoice' as const;

export function buildIncomePaymentReceiptDetailsText(params: {
  invoiceNumber: string;
  isPartial: boolean;
}): string {
  const num = String(params.invoiceNumber ?? '').trim() || '—';
  if (params.isPartial) {
    return `תשלום חלקי עבור חשבונית מס מס׳ ${num}`;
  }
  return `תשלום עבור חשבונית מס מס׳ ${num}`;
}

export function resolvePaymentStateIcon(
  paymentStateKey: 'unpaid' | 'partial' | 'paid',
): 'check' | null {
  return paymentStateKey === 'paid' ? 'check' : null;
}

export function optionalTrimmedString(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}
