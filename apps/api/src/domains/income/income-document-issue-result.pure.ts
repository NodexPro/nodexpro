/**
 * Backend-prepared issue command result truth for Income / retainer issue.
 * UI renders only — no frontend duplicate-detection.
 */

export type IncomeIssueResultKey = 'issued' | 'already_issued';

export type IncomeIssueViewAction = {
  action_key: 'view_document';
  label: string;
  enabled: boolean;
  document_id: string;
};

export type IncomeIssueResult = {
  result_key: IncomeIssueResultKey;
  message: string;
  document_id: string;
  document_number: string;
  document_type_key: string;
  document_type_label: string;
  issued_date: string;
  view_action: IncomeIssueViewAction;
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  tax_invoice: 'חשבונית מס',
  deal_invoice: 'חשבון עסקה',
  quote: 'הצעת מחיר',
  receipt: 'קבלה',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  credit_note: 'חשבונית זיכוי',
};

export function incomeDocumentTypeLabelHe(documentTypeKey: string): string {
  return DOCUMENT_TYPE_LABELS[documentTypeKey] ?? 'מסמך';
}

export function formatIssuedDateDisplayHe(issuedDateIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDateIso)) return issuedDateIso;
  const [y, m, d] = issuedDateIso.split('-');
  return `${d}/${m}/${y}`;
}

export function buildAlreadyIssuedIssueResult(params: {
  document_id: string;
  document_number: string;
  document_type_key: string;
  issued_date: string;
}): IncomeIssueResult {
  const typeLabel = incomeDocumentTypeLabelHe(params.document_type_key);
  const issuedDisplay = formatIssuedDateDisplayHe(params.issued_date);
  const message = [
    `החשבונית כבר הופקה בתאריך ${issuedDisplay}.`,
    `מספר החשבונית: ${params.document_number}.`,
    'ניתן לצפות בה ברשימת החשבוניות.',
  ].join('\n');

  return {
    result_key: 'already_issued',
    message,
    document_id: params.document_id,
    document_number: params.document_number,
    document_type_key: params.document_type_key,
    document_type_label: typeLabel,
    issued_date: params.issued_date,
    view_action: {
      action_key: 'view_document',
      label: 'צפייה בחשבונית',
      enabled: true,
      document_id: params.document_id,
    },
  };
}

export function buildFreshIssuedIssueResult(params: {
  document_id: string;
  document_number: string;
  document_type_key: string;
  issued_date: string;
}): IncomeIssueResult {
  const typeLabel = incomeDocumentTypeLabelHe(params.document_type_key);
  const issuedDisplay = formatIssuedDateDisplayHe(params.issued_date);
  return {
    result_key: 'issued',
    message: `${typeLabel} מספר ${params.document_number} הופקה בתאריך ${issuedDisplay}.`,
    document_id: params.document_id,
    document_number: params.document_number,
    document_type_key: params.document_type_key,
    document_type_label: typeLabel,
    issued_date: params.issued_date,
    view_action: {
      action_key: 'view_document',
      label: 'צפייה בחשבונית',
      enabled: true,
      document_id: params.document_id,
    },
  };
}
