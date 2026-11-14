/**
 * Client Operations filing evidence and manual confirmation.
 * Missing material is a warning. It does not block recording an actual filing.
 * The file is not proof that a filing or payment happened.
 */

export const FILING_EVIDENCE_KINDS = ['filing', 'payment'] as const;
export type FilingEvidenceKind = (typeof FILING_EVIDENCE_KINDS)[number];

export const FILING_EVIDENCE_OBLIGATION_KINDS = ['vat', 'income_tax_advance', 'national_insurance_deductions'] as const;
export type FilingEvidenceObligationKind = (typeof FILING_EVIDENCE_OBLIGATION_KINDS)[number];

/** System folders inside the existing client documents workspace. */
export const FILING_EVIDENCE_FOLDER_SYSTEM_KEY: Record<FilingEvidenceObligationKind, string> = {
  vat: 'vat_filings',
  income_tax_advance: 'income_tax_advance_filings',
  national_insurance_deductions: 'ni_deductions_filings',
};

const MANUAL_CONFIRM_STATUSES = new Set([
  'ready_to_report',
  'ready_to_process',
  'missing_data',
  'waiting_for_material',
  'waiting_for_income_data',
  'not_reported',
]);

const MATERIAL_WARNING_STATUSES = new Set([
  'missing_data',
  'waiting_for_material',
  'waiting_for_income_data',
]);

export function isFilingEvidenceKind(value: string): value is FilingEvidenceKind {
  return (FILING_EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function isFilingEvidenceObligationKind(value: string): value is FilingEvidenceObligationKind {
  return (FILING_EVIDENCE_OBLIGATION_KINDS as readonly string[]).includes(value);
}

export function filingEvidenceFolderSystemKey(kind: FilingEvidenceObligationKind): string {
  return FILING_EVIDENCE_FOLDER_SYSTEM_KEY[kind];
}

/** Payroll NI evidence identity for the selected operational month. Not self-employed NI. */
export function niDeductionsEvidenceCanonicalId(operationalPeriodKey: string): string {
  return `national_insurance_deductions::${operationalPeriodKey}`;
}

/**
 * Provider acceptance is not recipient confirmation.
 * `sent` means the mail provider accepted the message.
 */
export function clientDocumentDeliveryPresentation(result: 'pending' | 'sent' | 'failed' | null): {
  provider_confirmed: false;
  status_key: string | null;
} {
  if (result === 'sent') {
    return {
      provider_confirmed: false,
      status_key: 'clientOperations.documents.deliveryHandedToProvider',
    };
  }
  if (result === 'failed') {
    return {
      provider_confirmed: false,
      status_key: 'clientOperations.documents.deliveryFailed',
    };
  }
  if (result === 'pending') {
    return {
      provider_confirmed: false,
      status_key: 'clientOperations.documents.deliveryPending',
    };
  }
  return { provider_confirmed: false, status_key: null };
}

/** Accountant may record a filing that already happened, even without client material. */
export function canManuallyConfirmFiling(status: string | null | undefined): boolean {
  return MANUAL_CONFIRM_STATUSES.has(String(status ?? '').trim());
}

export function filingMaterialWarning(status: string | null | undefined): boolean {
  return MATERIAL_WARNING_STATUSES.has(String(status ?? '').trim());
}

export function paymentAlreadyConfirmedInFull(existing: string | null | undefined, next: string): boolean {
  return String(existing ?? '').trim() === 'paid_in_full' && next === 'paid_in_full';
}

export type FilingEvidenceRow = {
  document_id: string;
  file_asset_id: string | null;
  file_name: string | null;
  evidence_kind: FilingEvidenceKind;
  obligation_canonical_id: string;
  reporting_period_key: string;
  reporting_period_display: string;
  uploaded_at: string | null;
};

export function evidenceForCanonical(
  rows: readonly FilingEvidenceRow[],
  canonicalId: string | null | undefined,
): FilingEvidenceRow[] {
  const id = String(canonicalId ?? '').trim();
  if (!id) return [];
  return rows.filter((row) => row.obligation_canonical_id === id);
}
