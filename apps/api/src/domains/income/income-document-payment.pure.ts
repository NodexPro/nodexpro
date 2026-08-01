/**
 * INV-5B — pure helpers for Income payment orchestration + automatic receipt.
 */

export const INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT = 'record_income_document_payment' as const;
export const INCOME_DOCUMENT_PAYMENT_CASE_KEY = 'income_document_payment_case' as const;
export const INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE =
  'payment_receipt_for_invoice' as const;

export type IncomeDocumentRecordPaymentFormField = {
  key: string;
  label: string;
  type: 'number' | 'date' | 'text' | 'select' | 'textarea' | 'hidden';
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  default_value?: string | null;
};

export type IncomeDocumentRecordPaymentForm = {
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  command: typeof INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT;
  income_document_id: string;
  title: 'רישום תשלום';
  fields: IncomeDocumentRecordPaymentFormField[];
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'cash', label: 'מזומן' },
  { value: 'check', label: "צ'ק" },
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'other', label: 'אחר' },
];

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

/** Ready-to-render payment form for INV-5C modal (required flags owned by backend). */
export function buildIncomeDocumentRecordPaymentForm(params: {
  incomeDocumentId: string;
  currency: string;
  remainingBalance: number;
  enabled: boolean;
  disabledReason: string | null;
  paymentDateDefault?: string | null;
}): IncomeDocumentRecordPaymentForm {
  const remaining =
    Number.isFinite(params.remainingBalance) && params.remainingBalance > 0
      ? String(Math.round(params.remainingBalance * 100) / 100)
      : '';
  const currency = String(params.currency ?? 'ILS').trim().toUpperCase() || 'ILS';
  const paymentDateDefault =
    params.paymentDateDefault && /^\d{4}-\d{2}-\d{2}$/.test(params.paymentDateDefault)
      ? params.paymentDateDefault
      : new Date().toISOString().slice(0, 10);

  return {
    visible: true,
    enabled: params.enabled,
    disabled_reason: params.disabledReason,
    command: INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
    income_document_id: params.incomeDocumentId,
    title: 'רישום תשלום',
    fields: [
      {
        key: 'amount',
        label: 'סכום',
        type: 'number',
        required: true,
        default_value: remaining || null,
      },
      {
        key: 'payment_date',
        label: 'תאריך תשלום',
        type: 'date',
        required: true,
        default_value: paymentDateDefault,
      },
      {
        key: 'payment_method_key',
        label: 'אמצעי תשלום',
        type: 'select',
        required: true,
        options: PAYMENT_METHOD_OPTIONS,
        default_value: 'bank_transfer',
      },
      {
        key: 'reference_number',
        label: 'אסמכתא',
        type: 'text',
        required: false,
        default_value: null,
      },
      {
        key: 'bank_key',
        label: 'בנק',
        type: 'text',
        required: false,
        default_value: null,
      },
      {
        key: 'bank_branch',
        label: 'סניף',
        type: 'text',
        required: false,
        default_value: null,
      },
      {
        key: 'bank_account',
        label: 'חשבון',
        type: 'text',
        required: false,
        default_value: null,
      },
      {
        key: 'note',
        label: 'הערות',
        type: 'textarea',
        required: false,
        default_value: null,
      },
      {
        key: 'currency',
        label: 'מטבע',
        type: 'hidden',
        required: true,
        default_value: currency,
      },
    ],
  };
}
