import { buildIssueMonthSelector } from './work-engine-invoice-retainer-issue-month-selector.pure.js';

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
  issue_month_selector: import('./work-engine-invoice-retainer-issue-month-selector.pure.js').WorkEngineRecurringCycleDraftReviewIssueMonthSelector | null;
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
  issue_month_selector: import('./work-engine-invoice-retainer-issue-month-selector.pure.js').WorkEngineRecurringCycleDraftReviewIssueMonthSelector | null;
  command_name: 'issue_and_send_income_document';
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

export type CycleDraftReviewIssueMonthWindow = {
  months_back: number;
  months_ahead: number;
};

export function buildCycleDraftReviewIssueAction(params: {
  document_type: string | null;
  can_issue: boolean;
  issue_blocked_reason: string | null;
  document_date: string | null;
  already_issued: boolean;
  issued_document_number_display: string | null;
  today_iso?: string;
  issue_month_window?: CycleDraftReviewIssueMonthWindow;
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
      issue_month_selector: null,
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
      issue_month_selector: null,
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
      issue_month_selector: null,
      command_name: 'issue_income_document',
    };
  }

  const confirmationRequired = docType === 'tax_invoice';
  const todayIso = params.today_iso ?? new Date().toISOString().slice(0, 10);
  const issueMonthSelector = confirmationRequired
    ? buildIssueMonthSelector({
        todayIso,
        documentDate: params.document_date,
        mode: 'issue',
        monthsBack: params.issue_month_window?.months_back,
        monthsAhead: params.issue_month_window?.months_ahead,
      })
    : null;
  const documentMonthLabel =
    issueMonthSelector?.allowed_months.find(
      (month) => month.month_key === issueMonthSelector.default_month,
    )?.label ??
    (params.document_date != null ? formatHebrewDocumentMonthLabel(params.document_date) : '—');
  const confirmationMessage = confirmationRequired
    ? (issueMonthSelector?.allowed_months.find(
        (month) => month.month_key === issueMonthSelector.default_month,
      )?.confirmation_message ?? buildTaxInvoiceIssueConfirmationMessage(documentMonthLabel))
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
    issue_month_selector: issueMonthSelector,
    command_name: 'issue_income_document',
  };
}

export function buildTaxInvoiceIssueAndSendConfirmationMessage(
  documentMonthLabel: string,
  recipientEmail: string,
): string {
  return `חשבונית מס זו תופק ותירשם כהכנסה לחודש ${documentMonthLabel} ותישלח ל-${recipientEmail}. להמשיך?`;
}

export function buildCycleDraftReviewIssueAndSendAction(params: {
  document_type: string | null;
  issue_action_visible: boolean;
  can_issue_and_send: boolean;
  issue_and_send_blocked_reason: string | null;
  document_date: string | null;
  already_issued: boolean;
  issued_document_number_display: string | null;
  recipient_email: string | null;
  today_iso?: string;
  issue_month_window?: CycleDraftReviewIssueMonthWindow;
}): WorkEngineRecurringCycleDraftReviewIssueAndSendActionDescriptor {
  const docType = params.document_type;
  const typeAllowed = isRetainerPreviewIssueDocumentType(docType);
  const typeLabel = typeAllowed ? DOCUMENT_TYPE_LABELS[docType] : 'מסמך';

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
      issue_month_selector: null,
      command_name: 'issue_and_send_income_document',
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
      icon: 'send',
      tooltip: `המסמך כבר הופק${numberSuffix}`,
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      issue_month_selector: null,
      command_name: 'issue_and_send_income_document',
    };
  }

  if (!params.can_issue_and_send) {
    const reason = params.issue_and_send_blocked_reason ?? ISSUE_AND_SEND_DISABLED_REASON_HE;
    return {
      visible: true,
      enabled: false,
      disabled_reason: reason,
      icon: 'send',
      tooltip: reason,
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      issue_month_selector: null,
      command_name: 'issue_and_send_income_document',
    };
  }

  const recipientEmail = params.recipient_email?.trim() || '—';
  const confirmationRequired = docType === 'tax_invoice';
  const todayIso = params.today_iso ?? new Date().toISOString().slice(0, 10);
  const issueMonthSelector = confirmationRequired
    ? buildIssueMonthSelector({
        todayIso,
        documentDate: params.document_date,
        recipientEmail,
        mode: 'issue_and_send',
        monthsBack: params.issue_month_window?.months_back,
        monthsAhead: params.issue_month_window?.months_ahead,
      })
    : null;
  const confirmationMessage = confirmationRequired
    ? (issueMonthSelector?.allowed_months.find(
        (month) => month.month_key === issueMonthSelector.default_month,
      )?.confirmation_message ??
      buildTaxInvoiceIssueAndSendConfirmationMessage(
        params.document_date != null ? formatHebrewDocumentMonthLabel(params.document_date) : '—',
        recipientEmail,
      ))
    : `להפיק ולשלוח ${typeLabel} ל-${recipientEmail}?`;

  return {
    visible: true,
    enabled: true,
    disabled_reason: null,
    icon: 'send',
    tooltip: `הפקה ושליחה של ${typeLabel}`,
    confirmation_required: true,
    confirmation_title: confirmationRequired ? 'אישור הפקה ושליחה' : 'אישור הפקה ושליחה',
    confirmation_message: confirmationMessage,
    issue_month_selector: issueMonthSelector,
    command_name: 'issue_and_send_income_document',
  };
}
