import type {
  IncomeDocumentDocflowDeliveryAction,
  IncomeDocumentDocflowDeliveryBlock,
  IncomeDocumentDocflowHistoryAttemptRow,
  IncomeDocumentDocflowSendForm,
  IncomeWorkspacePermissions,
} from './income.types.js';
import {
  INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW,
  INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY,
} from './income.types.js';
import {
  bodyPreviewFromDocflowMessageSnapshot,
  incomeDocflowDeliveryAttemptCountLabel,
  resolveIncomeDocumentDocflowSendEligibility,
  type IncomeDocumentDocflowSendEligibilityInput,
} from './income-document-docflow-delivery.pure.js';
import {
  deliveryAttemptResultLabel,
  formatEmailDeliverySentAtDisplay,
} from './income-document-email-delivery.read-model.pure.js';

export type { IncomeDocumentDocflowSendEligibilityInput };

export function buildIncomeDocumentDocflowDeliveryAction(params: {
  incomeDocumentId: string;
  canOpenSend: boolean;
  sendDisabledReason: string | null;
}): IncomeDocumentDocflowDeliveryAction {
  return {
    key: 'open_docflow_send',
    icon_key: 'docflow',
    label: 'דוקפלו',
    enabled: params.canOpenSend,
    disabled_reason: params.sendDisabledReason,
    send_aggregate_key: INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY,
    send_aggregate_params: { income_document_id: params.incomeDocumentId },
  };
}

export function buildIncomeDocumentDocflowDeliveryBlock(params: {
  incomeDocumentId: string;
  attemptCount: number;
  permissions: IncomeWorkspacePermissions;
  representedClientId: string | null;
  documentStatus: string;
  pdfRenderStatus: string;
  pdfAssetId: string | null;
  docflowEntitled: boolean;
  portalActive: boolean;
}): IncomeDocumentDocflowDeliveryBlock {
  const sendEligibility = resolveIncomeDocumentDocflowSendEligibility({
    permissions: params.permissions,
    representedClientId: params.representedClientId,
    documentStatus: params.documentStatus,
    pdfRenderStatus: params.pdfRenderStatus,
    pdfAssetId: params.pdfAssetId,
    docflowEntitled: params.docflowEntitled,
    portalActive: params.portalActive,
  });
  const canOpenSend = params.permissions.view;
  return {
    attempt_count: params.attemptCount,
    status_label: incomeDocflowDeliveryAttemptCountLabel(params.attemptCount),
    send_enabled: sendEligibility.enabled,
    send_disabled_reason: sendEligibility.disabled_reason,
    action: buildIncomeDocumentDocflowDeliveryAction({
      incomeDocumentId: params.incomeDocumentId,
      canOpenSend,
      sendDisabledReason: canOpenSend ? sendEligibility.disabled_reason : 'אין הרשאת צפייה',
    }),
  };
}

export function buildIncomeDocumentDocflowSendForm(params: {
  incomeDocumentId: string;
  sendEligibility: { enabled: boolean; disabled_reason: string | null };
}): IncomeDocumentDocflowSendForm {
  return {
    visible: true,
    command: INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW,
    income_document_id: params.incomeDocumentId,
    confirm_label: 'שליחה ללקוח בדוקפלו',
    fields: [],
    enabled: params.sendEligibility.enabled,
    disabled_reason: params.sendEligibility.disabled_reason,
  };
}

export function mapDeliveryAttemptToDocflowHistoryRow(attempt: {
  id: string;
  result: string;
  failureReason: string | null;
  docflowThreadId: string | null;
  docflowMessageId: string | null;
  sentAt: string | null;
  messageSnapshotJson: Record<string, unknown>;
}): IncomeDocumentDocflowHistoryAttemptRow {
  return {
    attempt_id: attempt.id,
    sent_at_display: formatEmailDeliverySentAtDisplay(attempt.sentAt),
    result: attempt.result as IncomeDocumentDocflowHistoryAttemptRow['result'],
    result_label: deliveryAttemptResultLabel(attempt.result),
    failure_reason: attempt.failureReason,
    docflow_thread_id: attempt.docflowThreadId,
    docflow_message_id: attempt.docflowMessageId,
    body_preview: bodyPreviewFromDocflowMessageSnapshot(attempt.messageSnapshotJson),
  };
}
