import { badRequest } from '../../shared/errors.js';

export const INCOME_CUSTOMER_PAYMENT_TERMS_KEYS = [
  'immediate',
  'eom_plus_30',
  'eom_plus_60',
  'eom_plus_90',
] as const;

export type IncomeCustomerPaymentTermsKey = (typeof INCOME_CUSTOMER_PAYMENT_TERMS_KEYS)[number];

export const DEFAULT_INCOME_CUSTOMER_PAYMENT_TERMS: IncomeCustomerPaymentTermsKey = 'eom_plus_30';

export const INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS: {
  value: IncomeCustomerPaymentTermsKey;
  label: string;
}[] = [
  { value: 'immediate', label: 'מיידי' },
  { value: 'eom_plus_30', label: 'שוטף + 30' },
  { value: 'eom_plus_60', label: 'שוטף + 60' },
  { value: 'eom_plus_90', label: 'שוטף + 90' },
];

const PAYMENT_TERMS_LABEL_BY_KEY = new Map(
  INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS.map((o) => [o.value, o.label]),
);

export function isIncomeCustomerPaymentTermsKey(
  value: string,
): value is IncomeCustomerPaymentTermsKey {
  return (INCOME_CUSTOMER_PAYMENT_TERMS_KEYS as readonly string[]).includes(value);
}

export function parseIncomeCustomerPaymentTermsKey(
  raw: unknown,
  field = 'default_payment_terms',
): IncomeCustomerPaymentTermsKey {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!isIncomeCustomerPaymentTermsKey(value)) {
    throw badRequest(`${field} must be one of: ${INCOME_CUSTOMER_PAYMENT_TERMS_KEYS.join(', ')}`);
  }
  return value;
}

export function incomeCustomerPaymentTermsLabel(
  key: IncomeCustomerPaymentTermsKey,
): string {
  return PAYMENT_TERMS_LABEL_BY_KEY.get(key) ?? key;
}

function parseIsoDateParts(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw badRequest('document_date must be YYYY-MM-DD');
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function endOfMonthIso(documentDateIso: string): string {
  const { year, month } = parseIsoDateParts(documentDateIso);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function addDaysIso(iso: string, days: number): string {
  const { year, month, day } = parseIsoDateParts(iso);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

/** Israeli payment terms: מיידי or שוטף (end of invoice month) + N days. */
export function computeDueDateFromPaymentTerms(
  documentDateIso: string,
  terms: IncomeCustomerPaymentTermsKey,
): string {
  if (terms === 'immediate') return documentDateIso;
  const endOfMonth = endOfMonthIso(documentDateIso);
  const extraDays = terms === 'eom_plus_30' ? 30 : terms === 'eom_plus_60' ? 60 : 90;
  return addDaysIso(endOfMonth, extraDays);
}

export function resolveTaxInvoiceDueDate(params: {
  documentDateIso: string;
  paymentTerms: IncomeCustomerPaymentTermsKey;
  storedDueDate: string | null;
  dueDateManualOverride: boolean;
}): string {
  if (params.dueDateManualOverride && params.storedDueDate) {
    return params.storedDueDate;
  }
  return computeDueDateFromPaymentTerms(params.documentDateIso, params.paymentTerms);
}
