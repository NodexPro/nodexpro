/** Filing command persistence gate. Success requires a real updated row. */

import { canManuallyConfirmFiling } from './client-operations-filing-evidence.pure.js';

const SUBMITTED_STATUSES = new Set([
  'reported',
  'reported_late',
  'reported_and_paid',
  'paid_on_time',
  'paid_late',
]);

function isTerminalSubmittedStatus(status: string | null | undefined): boolean {
  return SUBMITTED_STATUSES.has(String(status ?? '').trim());
}

function isNotApplicableStatus(status: string | null | undefined): boolean {
  return String(status ?? '').trim() === 'not_relevant';
}

export function obligationWritePersisted(input: {
  error: unknown;
  rowCount: number;
}): boolean {
  return input.error == null && input.rowCount > 0;
}

export function vatReportedStatusForDueDate(
  dueDate: string | null | undefined,
  reportDate: string,
): 'reported' | 'reported_late' {
  const due = String(dueDate ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && reportDate > due) return 'reported_late';
  return 'reported';
}

/** Closed, paid, submitted, or N/A inactive rows must not be mutated by a new filing. */
export function vatHistoricalObligationMustBePreserved(input: {
  is_active?: boolean | null;
  status?: string | null;
}): boolean {
  if (input.is_active !== false) return false;
  return isTerminalSubmittedStatus(input.status) || isNotApplicableStatus(input.status);
}

export function vatInactiveUnfiledMayBeFiled(input: {
  is_active?: boolean | null;
  status?: string | null;
  submitted?: boolean;
}): boolean {
  if (input.is_active !== false) return false;
  if (input.submitted === true || isTerminalSubmittedStatus(input.status)) return false;
  if (isNotApplicableStatus(input.status)) return false;
  return canManuallyConfirmFiling(input.status);
}

export type VatFilingCompensationPlan =
  | { kind: 'none' }
  | { kind: 'delete_created'; obligation_id: string }
  | {
      kind: 'revert_status';
      obligation_id: string;
      previous_status: string;
      previous_is_active: boolean;
      previous_last_reported_at: string | null;
    };

export function vatFilingCompensationPlan(input: {
  created: boolean;
  filed: boolean;
  obligation_id: string | null | undefined;
  previous_status: string | null;
  previous_is_active: boolean | null;
  previous_last_reported_at?: string | null;
}): VatFilingCompensationPlan {
  const obligationId = String(input.obligation_id ?? '').trim();
  if (!input.filed || !obligationId) return { kind: 'none' };
  if (input.created) return { kind: 'delete_created', obligation_id: obligationId };
  const previousStatus = String(input.previous_status ?? '').trim();
  if (!previousStatus || isTerminalSubmittedStatus(previousStatus) || isNotApplicableStatus(previousStatus)) {
    return { kind: 'none' };
  }
  return {
    kind: 'revert_status',
    obligation_id: obligationId,
    previous_status: previousStatus,
    previous_is_active: input.previous_is_active !== false,
    previous_last_reported_at: input.previous_last_reported_at ?? null,
  };
}

function isMissingNamedPeriodFileRpc(
  error: {
    code?: string | null;
    message?: string | null;
  } | null | undefined,
  functionName: string,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  const fn = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    ((new RegExp(fn, 'i').test(message) || /schema cache/i.test(message)) &&
      /does not exist|could not find|schema cache/i.test(message))
  );
}

export function isMissingVatPeriodFileRpc(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  return isMissingNamedPeriodFileRpc(error, 'file_client_operations_period_vat_obligation');
}

export function isMissingItaPeriodFileRpc(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  return isMissingNamedPeriodFileRpc(
    error,
    'file_client_operations_period_income_tax_advance_obligation',
  );
}

function periodFileRpcBusinessError(
  message: string,
  prefix: 'VAT_FILE' | 'ITA_FILE',
  invalidArgsMessage: string,
): {
  httpMessage: string;
  code: string;
} | null {
  const text = String(message ?? '');
  if (text.includes(`${prefix}_PAYMENT_ALREADY_CONFIRMED`)) {
    return { httpMessage: 'payment already confirmed', code: 'BAD_REQUEST' };
  }
  if (text.includes(`${prefix}_NOT_FOUND`)) {
    return { httpMessage: 'obligation not found', code: 'BAD_REQUEST' };
  }
  if (text.includes(`${prefix}_PERIOD_MISMATCH`)) {
    return { httpMessage: 'obligation does not match the selected reporting period', code: 'BAD_REQUEST' };
  }
  if (text.includes(`${prefix}_NOT_READY`)) {
    return { httpMessage: 'obligation is not ready to report', code: 'BAD_REQUEST' };
  }
  if (text.includes(`${prefix}_PAY_REQUIRES_CLASSIFICATION`)) {
    return { httpMessage: 'payment_classification required', code: 'BAD_REQUEST' };
  }
  if (text.includes(`${prefix}_INVALID_ARGS`)) {
    return { httpMessage: invalidArgsMessage, code: 'BAD_REQUEST' };
  }
  return null;
}

export function vatPeriodFileRpcBusinessError(message: string): {
  httpMessage: string;
  code: string;
} | null {
  return periodFileRpcBusinessError(
    message,
    'VAT_FILE',
    'cannot create VAT obligation for this period',
  );
}

export function itaPeriodFileRpcBusinessError(message: string): {
  httpMessage: string;
  code: string;
} | null {
  return periodFileRpcBusinessError(
    message,
    'ITA_FILE',
    'cannot create income-tax advance obligation for this period',
  );
}
