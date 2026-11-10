/**
 * Accounting Base — tax-obligation payment attestation facts.
 *
 * User-attested classification only. Not bank-verified. Not a ledger posting.
 * Amounts stay null unless a later AB reconciliation supplies them.
 */

export const ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT =
  'attest_tax_obligation_payment' as const;

export const ACCOUNTING_TAX_OBLIGATION_PAYMENT_FACT_AGGREGATE_KEY =
  'accounting_tax_obligation_payment_fact' as const;

export const ACCOUNTING_BASE_TAX_PAYMENT_ATTESTATION_WRITE_PERMISSION =
  'accounting_base.tax_payment_attestation.write' as const;

export const TAX_OBLIGATION_PAYMENT_CLASSIFICATIONS = [
  'paid_in_full',
  'outstanding',
  'partially_paid',
  'not_required',
] as const;

export type TaxObligationPaymentClassification =
  (typeof TAX_OBLIGATION_PAYMENT_CLASSIFICATIONS)[number];

export const TAX_OBLIGATION_PAYMENT_PROVENANCE_USER_ATTESTED = 'user_attested' as const;

export type TaxObligationPaymentProvenance = typeof TAX_OBLIGATION_PAYMENT_PROVENANCE_USER_ATTESTED;

export type AccountingTaxObligationPaymentFact = {
  id: string;
  organization_id: string;
  client_id: string;
  obligation_canonical_id: string;
  obligation_kind: string;
  operational_period_key: string;
  obligation_period_key: string | null;
  source_obligation_id: string | null;
  payment_classification: TaxObligationPaymentClassification;
  provenance: TaxObligationPaymentProvenance;
  bank_verified: false;
  amount_paid: number | null;
  amount_remaining: number | null;
  payment_due_date: string | null;
  attested_by: string;
  attested_at: string;
};

export function isTaxObligationPaymentClassification(
  value: string | null | undefined,
): value is TaxObligationPaymentClassification {
  return (TAX_OBLIGATION_PAYMENT_CLASSIFICATIONS as readonly string[]).includes(String(value ?? ''));
}

export function paymentClassificationIsOutstanding(
  value: TaxObligationPaymentClassification | null | undefined,
): boolean {
  return value === 'outstanding' || value === 'partially_paid';
}

export function paymentClassificationIsSettled(
  value: TaxObligationPaymentClassification | null | undefined,
): boolean {
  return value === 'paid_in_full' || value === 'not_required';
}

export function factPaymentDueDateOrUnknown(due: string | null | undefined): string | null {
  const raw = String(due ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
