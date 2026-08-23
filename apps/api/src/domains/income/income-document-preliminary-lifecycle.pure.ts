/**
 * Preliminary Income lifecycle (quote / deal_invoice only): open ↔ closed.
 * Closed only after a downstream conversion target is successfully issued.
 * Reopen keeps the same document id + number; conversion lineage remains.
 */

import type { IncomeDocumentType } from './income.types.js';
import { documentTypeLabelHe, isPreliminaryCancellableType } from './income-document-conversion.pure.js';

export const INCOME_COMMAND_REOPEN_PRELIMINARY_DOCUMENT =
  'reopen_income_preliminary_document' as const;

export type PreliminaryLifecycleState = 'open' | 'closed';

export type PreliminaryLinkedDocumentRef = {
  document_id: string;
  document_number: string;
  document_type: string;
  document_type_label: string;
};

/** Null lifecycle column → open for preliminary types; non-preliminary → null. */
export function resolvePreliminaryLifecycleState(params: {
  documentType: string;
  documentStatus: string;
  storedLifecycle: string | null | undefined;
}): PreliminaryLifecycleState | null {
  if (!isPreliminaryCancellableType(params.documentType)) return null;
  if (params.documentStatus === 'cancelled_future') return null;
  if (params.storedLifecycle === 'closed') return 'closed';
  return 'open';
}

export function preliminaryLifecycleLabel(state: PreliminaryLifecycleState | null): string | null {
  if (state === 'closed') return 'סגור';
  if (state === 'open') return 'פתוח';
  return null;
}

/** Hebrew status detail for an issued downstream child (active closed, or historical after reopen). */
export function buildPreliminaryLifecycleStatusDetail(params: {
  lifecycleState: PreliminaryLifecycleState | null;
  linked: PreliminaryLinkedDocumentRef | null;
}): string | null {
  if (!params.linked?.document_number?.trim()) return null;
  const typeLabel = params.linked.document_type_label || documentTypeLabelHe(params.linked.document_type);
  const number = params.linked.document_number.trim();
  const feminine =
    params.linked.document_type === 'tax_invoice' ||
    params.linked.document_type === 'tax_invoice_receipt';
  if (params.lifecycleState === 'closed') {
    return feminine
      ? `הופקה בגינו ${typeLabel} ${number}`
      : `הופק בגינו ${typeLabel} ${number}`;
  }
  if (params.lifecycleState === 'open') {
    return feminine
      ? `הופקה בעבר ${typeLabel} ${number}`
      : `הופק בעבר ${typeLabel} ${number}`;
  }
  return null;
}

export function buildPreliminaryReopenAction(params: {
  lifecycleState: PreliminaryLifecycleState | null;
  documentStatus: string;
  canEdit: boolean;
}): {
  enabled: boolean;
  label: string;
  command: typeof INCOME_COMMAND_REOPEN_PRELIMINARY_DOCUMENT;
  reason_required: true;
  confirmation_title: string;
  confirmation_body: string;
  disabled_reason: string | null;
} {
  let enabled = true;
  let disabled_reason: string | null = null;
  if (params.documentStatus === 'cancelled_future') {
    enabled = false;
    disabled_reason = 'המסמך מבוטל';
  } else if (params.lifecycleState !== 'closed') {
    enabled = false;
    disabled_reason = 'ניתן לפתוח מחדש רק מסמך סגור';
  } else if (!params.canEdit) {
    enabled = false;
    disabled_reason = 'אין הרשאת עריכה';
  }
  return {
    enabled,
    label: 'פתיחה מחדש',
    command: INCOME_COMMAND_REOPEN_PRELIMINARY_DOCUMENT,
    reason_required: true,
    confirmation_title: 'פתיחת מסמך מחדש',
    confirmation_body: 'המסמך יישאר עם אותו מספר. היסטוריית ההמרות תישמר.',
    disabled_reason,
  };
}

/** Edit/convert/cancel are blocked while closed (backend-owned). */
export function isPreliminaryLifecycleBlockingMutation(
  lifecycleState: PreliminaryLifecycleState | null,
): boolean {
  return lifecycleState === 'closed';
}

export function decideClosePreliminarySourceOnIssuedChild(params: {
  sourceDocumentType: string;
  sourceDocumentStatus: string;
  currentLifecycle: PreliminaryLifecycleState | null;
  downstreamDocumentId: string;
}): { action: 'close' | 'noop' | 'idempotent'; reason: string } {
  if (!isPreliminaryCancellableType(params.sourceDocumentType)) {
    return { action: 'noop', reason: 'not_preliminary_source' };
  }
  if (params.sourceDocumentStatus !== 'issued') {
    return { action: 'noop', reason: 'source_not_issued' };
  }
  if (params.currentLifecycle === 'closed') {
    return { action: 'idempotent', reason: 'already_closed' };
  }
  if (!params.downstreamDocumentId.trim()) {
    return { action: 'noop', reason: 'missing_downstream' };
  }
  return { action: 'close', reason: 'downstream_issued' };
}

export function decideReopenPreliminaryDocument(params: {
  documentType: string;
  documentStatus: string;
  lifecycleState: PreliminaryLifecycleState | null;
  reason: string | null;
}): { action: 'reopen' | 'reject'; code: string; message: string } {
  if (!isPreliminaryCancellableType(params.documentType)) {
    return {
      action: 'reject',
      code: 'PRELIMINARY_REOPEN_TYPE_FORBIDDEN',
      message: 'Only quote or deal_invoice can be reopened',
    };
  }
  if (params.documentStatus === 'cancelled_future') {
    return {
      action: 'reject',
      code: 'PRELIMINARY_REOPEN_CANCELLED',
      message: 'Cancelled documents cannot be reopened',
    };
  }
  if (params.documentStatus !== 'issued') {
    return {
      action: 'reject',
      code: 'PRELIMINARY_REOPEN_NOT_ISSUED',
      message: 'Only issued preliminary documents can be reopened',
    };
  }
  if (params.lifecycleState !== 'closed') {
    return {
      action: 'reject',
      code: 'PRELIMINARY_REOPEN_NOT_CLOSED',
      message: 'Document is not closed',
    };
  }
  if (!params.reason?.trim()) {
    return {
      action: 'reject',
      code: 'PRELIMINARY_REOPEN_REASON_REQUIRED',
      message: 'סיבת פתיחה מחדש נדרשת',
    };
  }
  return { action: 'reopen', code: 'ok', message: 'ok' };
}

export function linkedDocumentRefFromIssuedTarget(params: {
  documentId: string;
  documentNumber: string | null;
  documentType: IncomeDocumentType | string;
}): PreliminaryLinkedDocumentRef | null {
  const number = params.documentNumber?.trim() || null;
  if (!params.documentId || !number) return null;
  return {
    document_id: params.documentId,
    document_number: number,
    document_type: String(params.documentType),
    document_type_label: documentTypeLabelHe(params.documentType),
  };
}
