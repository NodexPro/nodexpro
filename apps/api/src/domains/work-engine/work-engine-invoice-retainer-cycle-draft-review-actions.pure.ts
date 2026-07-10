/**
 * Retainer cycle draft review — preview header issue actions (read-model only).
 */

export const RETAINER_PREVIEW_ISSUE_DOCUMENT_TYPES = new Set([
  'tax_invoice',
  'deal_invoice',
  'quote',
]);

export const ISSUE_AND_SEND_DISABLED_REASON_HE =
  'הפקה ושליחה יופעלו לאחר השלמת שרשרת המסירה.';

export type RetainerPreviewIssueDocumentType = 'tax_invoice' | 'deal_invoice' | 'quote';

export type WorkEngineRecurringCycleDraftReviewIssueActionDescriptor = {
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  icon: 'issue';
  tooltip: string;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
  command_name: 'issue_income_document';
};

export type WorkEngineRecurringCycleDraftReviewIssueAndSendActionDescriptor = {
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  icon: 'send';
  tooltip: string;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
  command_name: 'send_income_document_by_email';
};

const DOCUMENT_TYPE_LABELS: Record<RetainerPreviewIssueDocumentType, string> = {
  tax_invoice: 'חשבונית מס',
  deal_invoice: 'חשבון עסקה',
  quote: 'הצעת מחיר',
};

function isRetainerPreviewIssueDocumentType(
  value: string | null | undefined,
): value is RetainerPreviewIssueDocumentType {
  return value != null && RETAINER_PREVIEW_ISSUE_DOCUMENT_TYPES.has(value);
}

export function formatHebrewDocumentMonthLabel(documentDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) return documentDate;
  const [year, month] = documentDate.split('-');
  const monthNames = [
    'ינואר',
    'פברואר',
    'מרץ',
    'אפריל',
    'מאי',
    'יוני',
    'יולי',
    'אוגוסט',
    'ספטמבר',
    'אוקטובר',
    'נובמבר',
    'דצמבר',
  ];
  const monthIndex = Number(month) - 1;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return `${month}/${year}`;
  }
  return `${monthNames[monthIndex]!} ${year}`;
}

export function buildTaxInvoiceIssueConfirmationMessage(documentMonthLabel: string): string {
  return `חשבונית מס זו תופק ותירשם כהכנסה לחודש ${documentMonthLabel}. להמשיך?`;
}

export function buildCycleDraftReviewIssueAction(params: {
  document_type: string | null;
  can_issue: boolean;
  issue_blocked_reason: string | null;
  document_date: string | null;
  already_issued: boolean;
  issued_document_number_display: string | null;
}): WorkEngineRecurringCycleDraftReviewIssueActionDescriptor {
  const docType = params.document_type;
  const typeAllowed = isRetainerPreviewIssueDocumentType(docType);
  const typeLabel = typeAllowed ? DOCUMENT_TYPE_LABELS[docType] : 'מסמך';

  if (!typeAllowed) {
    return {
      visible: false,
      enabled: false,
      disabled_reason: null,
      icon: 'issue',
      tooltip: 'הפקה',
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      command_name: 'issue_income_document',
    };
  }

  if (params.already_issued) {
    const numberSuffix = params.issued_document_number_display
      ? ` (${params.issued_document_number_display})`
      : '';
    return {
      visible: true,
      enabled: false,
      disabled_reason: `המסמך כבר הופק${numberSuffix}`,
      icon: 'issue',
      tooltip: `המסמך כבר הופק${numberSuffix}`,
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      command_name: 'issue_income_document',
    };
  }

  if (!params.can_issue) {
    return {
      visible: true,
      enabled: false,
      disabled_reason: params.issue_blocked_reason ?? 'אין הרשאת הפקה',
      icon: 'issue',
      tooltip: params.issue_blocked_reason ?? 'אין הרשאת הפקה',
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      command_name: 'issue_income_document',
    };
  }

  const confirmationRequired = docType === 'tax_invoice';
  const documentMonthLabel =
    params.document_date != null ? formatHebrewDocumentMonthLabel(params.document_date) : '—';
  const confirmationMessage = confirmationRequired
    ? buildTaxInvoiceIssueConfirmationMessage(documentMonthLabel)
    : `להפיק ${typeLabel} זה?`;

  return {
    visible: true,
    enabled: true,
    disabled_reason: null,
    icon: 'issue',
    tooltip: `הפקת ${typeLabel}`,
    confirmation_required: confirmationRequired,
    confirmation_title: confirmationRequired ? 'אישור הפקת חשבונית מס' : 'אישור הפקה',
    confirmation_message: confirmationMessage,
    command_name: 'issue_income_document',
  };
}

export function buildCycleDraftReviewIssueAndSendAction(params: {
  document_type: string | null;
  issue_action_visible: boolean;
}): WorkEngineRecurringCycleDraftReviewIssueAndSendActionDescriptor {
  const typeAllowed = isRetainerPreviewIssueDocumentType(params.document_type);
  const typeLabel =
    typeAllowed && isRetainerPreviewIssueDocumentType(params.document_type)
      ? DOCUMENT_TYPE_LABELS[params.document_type]
      : 'מסמך';

  if (!typeAllowed || !params.issue_action_visible) {
    return {
      visible: false,
      enabled: false,
      disabled_reason: null,
      icon: 'send',
      tooltip: 'הפקה ושליחה',
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      command_name: 'send_income_document_by_email',
    };
  }

  return {
    visible: true,
    enabled: false,
    disabled_reason: ISSUE_AND_SEND_DISABLED_REASON_HE,
    icon: 'send',
    tooltip: ISSUE_AND_SEND_DISABLED_REASON_HE,
    confirmation_required: false,
    confirmation_title: null,
    confirmation_message: null,
    command_name: 'send_income_document_by_email',
  };
}
