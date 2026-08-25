import { useCallback, useEffect, useState } from 'react';
import type {
  IncomeWorkspaceAggregate,
  WorkEngineInvoicesClientDocumentsByTypeAggregate,
  WorkEngineInvoicesClientDocumentsByTypeRow,
} from '../../income/income-workspace-types';
import type { IncomeClientDocumentTypeCounterKey } from '../../income/income-workspace-types';
import {
  downloadIncomeDocumentPdf,
  executeIncomeCommand,
  incomeApiPathFromBackend,
} from '../../api/income';
import { fetchWorkEngineInvoicesClientDocumentsByTypeAggregate } from '../../api/work-engine';
import { IncomeDocumentEmailHistoryModal } from '../income/IncomeDocumentEmailHistoryModal';
import { WorkEngineDocumentsRowDeliveryIcons, workEngineDocumentsRowDeliveryVisible } from './WorkEngineDocumentsRowDeliveryIcons';
import type { WorkEngineTaxInvoiceCreditRequest } from './WorkEngineTaxInvoiceCreditConfirmModal';

type OpenParams = {
  representedClientId: string;
  clientDisplayName: string;
  documentTypeKey: IncomeClientDocumentTypeCounterKey;
  documentTypeLabel: string;
  /** Backend scope from counter action_params — null = Office→client (empty until modeled). */
  incomeCustomerId: string | null;
};

type Props = {
  open: boolean;
  params: OpenParams | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
  onEditDraft?: (draftId: string) => void | Promise<void>;
  onInvoicesTabRefresh?: (aggregate: Record<string, unknown>) => void;
  onOpenConvertedDraft?: (payload: {
    draftId: string;
    workspaceAggregate: IncomeWorkspaceAggregate;
  }) => void | Promise<void>;
  onRequestTaxInvoiceCredit?: (request: WorkEngineTaxInvoiceCreditRequest) => void;
};

type PreliminaryDocumentEditAction = {
  enabled: boolean;
  label: string;
  command: 'begin_edit_income_preliminary_document';
  disabled_reason: string | null;
};

function preliminaryEditActionOf(
  row: WorkEngineInvoicesClientDocumentsByTypeRow,
): PreliminaryDocumentEditAction | null {
  const action = (row as { edit_action?: PreliminaryDocumentEditAction | null }).edit_action;
  if (!action || action.command !== 'begin_edit_income_preliminary_document') return null;
  return action;
}


type DocumentConvertTargetOption = {
  document_type: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
};

type DocumentConvertAction = {
  enabled: boolean;
  label: string;
  command: 'convert_income_document_to_draft';
  targets: DocumentConvertTargetOption[];
};

type DocumentCancelAction = {
  enabled: boolean;
  label: string;
  command: 'cancel_income_preliminary_document';
  disabled_reason: string | null;
  confirmation_title: string;
  confirmation_body: string;
  reason_required: boolean;
};

type DocumentReopenAction = {
  enabled: boolean;
  label: string;
  command: 'reopen_income_preliminary_document';
  disabled_reason: string | null;
  confirmation_title: string;
  confirmation_body: string;
  reason_required: true;
};

function cancelActionOf(
  row: WorkEngineInvoicesClientDocumentsByTypeRow,
): DocumentCancelAction | null {
  const action = (row as { cancel_action?: DocumentCancelAction | null }).cancel_action;
  if (!action || action.command !== 'cancel_income_preliminary_document') return null;
  return action;
}

function reopenActionOf(
  row: WorkEngineInvoicesClientDocumentsByTypeRow,
): DocumentReopenAction | null {
  const action = (row as { reopen_action?: DocumentReopenAction | null }).reopen_action;
  if (!action || action.command !== 'reopen_income_preliminary_document') return null;
  return action;
}

function convertActionOf(
  row: WorkEngineInvoicesClientDocumentsByTypeRow,
): DocumentConvertAction | null {
  const action = (row as { convert_action?: DocumentConvertAction | null }).convert_action;
  if (!action || action.command !== 'convert_income_document_to_draft') return null;
  return action;
}

function renderCellValue(
  row: WorkEngineInvoicesClientDocumentsByTypeRow,
  columnKey: string,
): string {
  const map: Record<string, string | null | undefined> = {
    document_number: row.document_number,
    issue_date_display: row.issue_date_display,
    created_at_display: row.created_at_display,
    customer_display_name: row.customer_display_name,
    amount_display: row.amount_display,
    due_date_display: row.due_date_display,
    status_label: row.status_label,
    document_type_label: row.document_type_label,
  };
  const value = map[columnKey];
  if (value == null || value === '') return '—';
  return String(value);
}

export function WorkEngineClientDocumentsByTypeModal({
  open,
  params,
  busy,
  onBusyChange,
  onClose,
  onError,
  onEditDraft,
  onInvoicesTabRefresh,
  onOpenConvertedDraft,
  onRequestTaxInvoiceCredit,
}: Props) {
  const [aggregate, setAggregate] = useState<WorkEngineInvoicesClientDocumentsByTypeAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [docEmailHistoryId, setDocEmailHistoryId] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<{
    row: WorkEngineInvoicesClientDocumentsByTypeRow;
    action: DocumentConvertAction;
  } | null>(null);
  const [selectedConvertDocumentType, setSelectedConvertDocumentType] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    documentId: string;
    documentNumber: string | null;
    action: DocumentCancelAction;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [reopenTarget, setReopenTarget] = useState<{
    documentId: string;
    documentNumber: string | null;
    documentTypeLabel: string | null;
    action: DocumentReopenAction;
  } | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const loadAggregate = useCallback(
    async (year?: number | null) => {
      if (!params) return;
      setLoading(true);
      onBusyChange?.(true);
      try {
        const agg = await fetchWorkEngineInvoicesClientDocumentsByTypeAggregate({
          representedClientId: params.representedClientId,
          documentTypeKey: params.documentTypeKey,
          incomeCustomerId: params.incomeCustomerId,
          year,
        });
        setAggregate(agg);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        onBusyChange?.(false);
      }
    },
    [onBusyChange, onError, params],
  );

  useEffect(() => {
    if (!open || !params) {
      setAggregate(null);
      setConvertTarget(null);
      setSelectedConvertDocumentType(null);
      setCancelTarget(null);
      setCancelReason('');
      setReopenTarget(null);
      setReopenReason('');
      return;
    }
    void loadAggregate();
  }, [loadAggregate, open, params]);

  const handleViewDocument = async (row: WorkEngineInvoicesClientDocumentsByTypeRow) => {
    if (!row.pdf_download_path || !row.can_view_document) return;
    onBusyChange?.(true);
    try {
      await downloadIncomeDocumentPdf(
        incomeApiPathFromBackend(row.pdf_download_path),
        `${row.document_number ?? 'document'}.pdf`,
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleEditDraft = async (row: WorkEngineInvoicesClientDocumentsByTypeRow) => {
    if (!row.draft_id || !row.can_edit_draft) return;
    if (onEditDraft) {
      await onEditDraft(row.draft_id);
      return;
    }
    onBusyChange?.(true);
    try {
      await executeIncomeCommand('resume_income_document_draft', { draft_id: row.draft_id });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleEditPreliminary = async (
    row: WorkEngineInvoicesClientDocumentsByTypeRow,
    editAction: PreliminaryDocumentEditAction,
  ) => {
    if (!row.document_id || !editAction.enabled) return;
    onBusyChange?.(true);
    try {
      const raw = await executeIncomeCommand(editAction.command, {
        income_document_id: row.document_id,
        documents_list_year: aggregate?.selected_year ?? null,
      });
      if (typeof raw !== 'object' || raw == null || !('income_workspace_aggregate' in raw)) return;
      const res = raw as {
        income_workspace_aggregate: IncomeWorkspaceAggregate;
        work_engine_invoices_client_documents_by_type_aggregate?: WorkEngineInvoicesClientDocumentsByTypeAggregate;
        work_engine_invoices_tab_aggregate?: Record<string, unknown>;
        meta?: { edited_draft_id?: string; converted_draft_id?: string };
      };
      const list = res.work_engine_invoices_client_documents_by_type_aggregate;
      if (list) setAggregate(list);
      if (res.work_engine_invoices_tab_aggregate) {
        onInvoicesTabRefresh?.(res.work_engine_invoices_tab_aggregate);
      }
      const draftId =
        res.meta?.edited_draft_id ??
        res.meta?.converted_draft_id ??
        res.income_workspace_aggregate.active_wizard_draft_id ??
        null;
      if (draftId && onOpenConvertedDraft) {
        await onOpenConvertedDraft({
          draftId,
          workspaceAggregate: res.income_workspace_aggregate,
        });
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };


  const closeConvertModal = () => {
    setConvertTarget(null);
    setSelectedConvertDocumentType(null);
  };

  const clearCancelModal = () => {
    setCancelTarget(null);
    setCancelReason('');
  };

  const clearReopenModal = () => {
    setReopenTarget(null);
    setReopenReason('');
  };

  const handleConfirmConvert = async () => {
    if (!convertTarget?.row.document_id || !convertTarget.action.enabled) return;
    const selectedTarget = convertTarget.action.targets.find(
      (target) => target.document_type === selectedConvertDocumentType,
    );
    if (!selectedTarget?.enabled) return;
    onBusyChange?.(true);
    try {
      const raw = await executeIncomeCommand(convertTarget.action.command, {
        source_document_id: convertTarget.row.document_id,
        target_document_type: selectedTarget.document_type,
        idempotency_key: crypto.randomUUID(),
        documents_list_year: aggregate?.selected_year ?? null,
      });
      if (typeof raw !== 'object' || raw == null || !('income_workspace_aggregate' in raw)) return;
      const res = raw as {
        income_workspace_aggregate: IncomeWorkspaceAggregate;
        work_engine_invoices_client_documents_by_type_aggregate?: WorkEngineInvoicesClientDocumentsByTypeAggregate;
        work_engine_invoices_tab_aggregate?: Record<string, unknown>;
        meta?: { converted_draft_id?: string };
      };
      const list = res.work_engine_invoices_client_documents_by_type_aggregate;
      if (list) setAggregate(list);
      if (res.work_engine_invoices_tab_aggregate) {
        onInvoicesTabRefresh?.(res.work_engine_invoices_tab_aggregate);
      }
      closeConvertModal();
      clearCancelModal();
      const draftId =
        res.meta?.converted_draft_id ??
        res.income_workspace_aggregate.active_wizard_draft_id ??
        null;
      if (draftId && onOpenConvertedDraft) {
        await onOpenConvertedDraft({
          draftId,
          workspaceAggregate: res.income_workspace_aggregate,
        });
      } else if (draftId && onEditDraft) {
        await onEditDraft(draftId);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget?.action.enabled) return;
    onBusyChange?.(true);
    try {
      const raw = await executeIncomeCommand(cancelTarget.action.command, {
        income_document_id: cancelTarget.documentId,
        reason: cancelReason.trim() || null,
        documents_list_year: aggregate?.selected_year ?? null,
      });
      if (typeof raw !== 'object' || raw == null || !('ok' in raw)) return;
      const res = raw as {
        work_engine_invoices_client_documents_by_type_aggregate?: WorkEngineInvoicesClientDocumentsByTypeAggregate;
        work_engine_invoices_tab_aggregate?: Record<string, unknown>;
      };
      const list = res.work_engine_invoices_client_documents_by_type_aggregate;
      if (list) setAggregate(list);
      if (res.work_engine_invoices_tab_aggregate) {
        onInvoicesTabRefresh?.(res.work_engine_invoices_tab_aggregate);
      }
      clearCancelModal();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleConfirmReopen = async () => {
    if (!reopenTarget?.action.enabled) return;
    if (reopenTarget.action.reason_required && !reopenReason.trim()) return;
    onBusyChange?.(true);
    try {
      const raw = await executeIncomeCommand(reopenTarget.action.command, {
        income_document_id: reopenTarget.documentId,
        reason: reopenReason.trim(),
        documents_list_year: aggregate?.selected_year ?? null,
      });
      if (typeof raw !== 'object' || raw == null || !('ok' in raw)) return;
      const res = raw as {
        work_engine_invoices_client_documents_by_type_aggregate?: WorkEngineInvoicesClientDocumentsByTypeAggregate;
        work_engine_invoices_tab_aggregate?: Record<string, unknown>;
      };
      const list = res.work_engine_invoices_client_documents_by_type_aggregate;
      if (list) setAggregate(list);
      if (res.work_engine_invoices_tab_aggregate) {
        onInvoicesTabRefresh?.(res.work_engine_invoices_tab_aggregate);
      }
      clearReopenModal();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  if (!open || !params) return null;

  const title = `מסמכים — ${params.documentTypeLabel} — ${params.clientDisplayName}`;
  const columns = aggregate?.table_columns ?? [];
  const rows = aggregate?.rows ?? [];
  const availableYears = aggregate?.available_years ?? [];
  const selectedYear = aggregate?.selected_year ?? new Date().getFullYear();

  return (
    <>
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
      <div className="nx-we-documents-modal nx-income-wizard nx-accounting-editor-modal">
        <div className="nx-income-wizard__head nx-we-documents-modal__head">
          <h2 className="nx-modal-title">{title}</h2>
          <div className="nx-we-documents-modal__head-actions">
          <div className="nx-we-documents-modal__year">
            <label htmlFor="nx-we-documents-year">שנה</label>
            <select
              id="nx-we-documents-year"
              value={selectedYear}
              disabled={busy || loading || availableYears.length === 0}
              onChange={(e) => void loadAggregate(Number(e.target.value))}
            >
              {(availableYears.length > 0 ? availableYears : [selectedYear]).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="nx-we-documents-modal__close"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
          </div>
        </div>

        <div className="nx-income-wizard__body">
          {loading && !aggregate ? (
            <p className="nx-we-documents-modal__loading">טוען מסמכים…</p>
          ) : (
            <div className="nx-we-documents-modal__table-wrap">
              <table className="nx-we-documents-modal__table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} scope="col">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.row_id}
                      className={
                        row.row_visual_state === 'muted'
                          ? 'nx-we-documents-modal__row nx-we-documents-modal__row--muted'
                          : undefined
                      }
                    >
                      {columns.map((col) => {
                        if (col.key === 'status_label' || col.key === 'status') {
                          return (
                            <td key={col.key}>
                              <div className="nx-we-documents-modal__status-cell">
                                <span>{row.status_label || '—'}</span>
                                {row.status_detail ? (
                                  <span className="nx-we-documents-modal__status-detail">
                                    {row.status_detail}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'actions') {
                          const hasDedicatedViewColumn = columns.some((column) => column.key === 'view');
                          const creditAction = row.credit_action ?? null;
                          const convertAction = convertActionOf(row);
                          const cancelAction = cancelActionOf(row);
                          const reopenAction = reopenActionOf(row);
                          const showCredit = Boolean(creditAction);
                          const showConvert = Boolean(convertAction);
                          const showCancel = Boolean(cancelAction);
                          const showReopen = Boolean(reopenAction);
                          const showView =
                            !hasDedicatedViewColumn && Boolean(row.can_view_document);
                          return (
                            <td key={col.key} className="nx-we-documents-modal__action-col">
                              {showView ||
                              showCredit ||
                              showConvert ||
                              workEngineDocumentsRowDeliveryVisible(row).showEmail ||
                              workEngineDocumentsRowDeliveryVisible(row).showDocflow ? (
                                <div className="nx-we-documents-modal__row-actions">
                                  {showConvert && convertAction ? (
                                    <button
                                      type="button"
                                      className="nx-we-documents-modal__icon-btn"
                                      disabled={busy || loading || !convertAction.enabled}
                                      title={convertAction.label}
                                      aria-label={convertAction.label}
                                      onClick={() => {
                                        clearCancelModal();
                                        setConvertTarget({ row, action: convertAction });
                                        setSelectedConvertDocumentType(null);
                                      }}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M12 5v14M5 12h14"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                  ) : null}
                                  {showCancel && cancelAction ? (
                                    <button
                                      type="button"
                                      className="nx-we-documents-modal__icon-btn nx-we-documents-modal__icon-btn--danger"
                                      disabled={busy || loading || !cancelAction.enabled}
                                      title={cancelAction.disabled_reason ?? cancelAction.label}
                                      aria-label={cancelAction.label}
                                      onClick={() => {
                                        if (!row.document_id) return;
                                        clearReopenModal();
                                        setCancelReason('');
                                        setCancelTarget({
                                          documentId: row.document_id,
                                          documentNumber: row.document_number,
                                          action: cancelAction,
                                        });
                                      }}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M6 6l12 12M18 6L6 18"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                  ) : null}
                                  {showReopen && reopenAction ? (
                                    <button
                                      type="button"
                                      className="nx-we-documents-modal__icon-btn"
                                      disabled={busy || loading || !reopenAction.enabled}
                                      title={reopenAction.disabled_reason ?? reopenAction.label}
                                      aria-label={reopenAction.label}
                                      onClick={() => {
                                        if (!row.document_id) return;
                                        clearCancelModal();
                                        setReopenReason('');
                                        setReopenTarget({
                                          documentId: row.document_id,
                                          documentNumber: row.document_number,
                                          documentTypeLabel: row.document_type_label,
                                          action: reopenAction,
                                        });
                                      }}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M3 12a9 9 0 0 1 15.5-6.4M21 3v6h-6"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M21 12a9 9 0 0 1-15.5 6.4M3 21v-6h6"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    </button>
                                  ) : null}
                                  {showCredit && creditAction ? (
                                    <button
                                      type="button"
                                      className="nx-btn nx-btn-taxes-compact"
                                      disabled={busy || loading || !creditAction.enabled}
                                      title={creditAction.disabled_reason ?? creditAction.label}
                                      onClick={() => {
                                        if (!row.document_id) return;
                                        onRequestTaxInvoiceCredit?.({
                                          documentId: row.document_id,
                                          documentNumber: row.document_number,
                                          action: creditAction,
                                          documentsListYear: aggregate?.selected_year ?? null,
                                        });
                                      }}
                                    >
                                      {creditAction.label}
                                    </button>
                                  ) : null}
                                  {showView ? (
                                    <button
                                      type="button"
                                      className="nx-we-documents-modal__view"
                                      disabled={busy || loading}
                                      aria-label="צפייה במסמך"
                                      title="צפייה במסמך"
                                      onClick={() => void handleViewDocument(row)}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                        />
                                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                                      </svg>
                                    </button>
                                  ) : null}
                                  <WorkEngineDocumentsRowDeliveryIcons
                                    row={row}
                                    busy={busy || loading}
                                    onOpenEmail={setDocEmailHistoryId}
                                    onOpenDocflow={() => undefined}
                                  />
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        }
                        if (col.key === 'view') {
                          const deliveryVisible = workEngineDocumentsRowDeliveryVisible(row);
                          return (
                            <td key={col.key} className="nx-we-documents-modal__action-col">
                              {row.can_view_document ||
                              deliveryVisible.showEmail ||
                              deliveryVisible.showDocflow ? (
                                <div className="nx-we-documents-modal__row-actions">
                                  {row.can_view_document ? (
                                    <button
                                      type="button"
                                      className="nx-we-documents-modal__view"
                                      disabled={busy || loading}
                                      aria-label="צפייה במסמך"
                                      title="צפייה במסמך"
                                      onClick={() => void handleViewDocument(row)}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                        />
                                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                                      </svg>
                                    </button>
                                  ) : null}
                                  <WorkEngineDocumentsRowDeliveryIcons
                                    row={row}
                                    busy={busy || loading}
                                    onOpenEmail={setDocEmailHistoryId}
                                    onOpenDocflow={() => undefined}
                                  />
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        }
                        if (col.key === 'edit') {
                          const editAction = preliminaryEditActionOf(row);
                          if (editAction) {
                            return (
                              <td key={col.key} className="nx-we-documents-modal__action-col">
                                <button
                                  type="button"
                                  className="nx-we-documents-modal__edit"
                                  disabled={busy || loading || !editAction.enabled}
                                  aria-label={editAction.label}
                                  title={editAction.disabled_reason ?? editAction.label}
                                  onClick={() => void handleEditPreliminary(row, editAction)}
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                      d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </td>
                            );
                          }
                          return (
                            <td key={col.key} className="nx-we-documents-modal__action-col">
                              {row.can_edit_draft ? (
                                <button
                                  type="button"
                                  className="nx-we-documents-modal__edit"
                                  disabled={busy || loading}
                                  aria-label="עריכת טיוטה"
                                  title="עריכה"
                                  onClick={() => void handleEditDraft(row)}
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                      d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        }
                        return <td key={col.key}>{renderCellValue(row, col.key)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
      <IncomeDocumentEmailHistoryModal
        open={docEmailHistoryId != null}
        incomeDocumentId={docEmailHistoryId}
        representedClientId={params.representedClientId}
        busy={busy}
        onBusyChange={onBusyChange}
        onClose={() => setDocEmailHistoryId(null)}
        onError={onError}
      />

      {convertTarget ? (
        <div
          className="nx-modal-overlay nx-modal-overlay--nested nx-we-documents-convert-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="nx-modal nx-owner-legal-command-modal nx-accounting-editor-modal nx-we-documents-convert-modal"
            dir="rtl"
            style={{ direction: 'rtl' }}
          >
            <div className="nx-modal-header">
              <h2>{convertTarget.action.label || 'הפקת מסמך'}</h2>
            </div>
            <div className="nx-modal-body">
              {convertTarget.row.document_number ? (
                <p className="nx-we-documents-convert-modal__source">
                  מסמך מקור: <strong>{convertTarget.row.document_number}</strong>
                </p>
              ) : null}
              <div
                className="nx-we-documents-convert-modal__options"
                role="radiogroup"
                aria-label={convertTarget.action.label || 'הפקת מסמך'}
              >
                {convertTarget.action.targets.map((target) => {
                  const optionId = `nx-we-convert-target-${target.document_type}`;
                  const selected = selectedConvertDocumentType === target.document_type;
                  return (
                    <label
                      key={target.document_type}
                      htmlFor={optionId}
                      title={target.disabled_reason ?? target.label}
                      className={[
                        'nx-we-documents-convert-modal__option',
                        selected ? 'nx-we-documents-convert-modal__option--selected' : '',
                        !target.enabled ? 'nx-we-documents-convert-modal__option--disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        id={optionId}
                        type="radio"
                        name="nx-we-convert-target"
                        value={target.document_type}
                        checked={selected}
                        disabled={busy || !target.enabled}
                        onChange={() => setSelectedConvertDocumentType(target.document_type)}
                      />
                      <span className="nx-we-documents-convert-modal__option-text">
                        <span className="nx-we-documents-convert-modal__option-label">{target.label}</span>
                        {!target.enabled && target.disabled_reason ? (
                          <span className="nx-we-documents-convert-modal__option-reason">
                            {target.disabled_reason}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                disabled={
                  busy ||
                  !selectedConvertDocumentType ||
                  !convertTarget.action.targets.some(
                    (target) =>
                      target.document_type === selectedConvertDocumentType && target.enabled,
                  )
                }
                onClick={() => void handleConfirmConvert()}
              >
                המשך
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy}
                onClick={closeConvertModal}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cancel confirm mounts only on explicit cancel click — never under convert/wizard. */}
      {cancelTarget && !convertTarget && !reopenTarget ? (
        <div className="nx-modal-overlay nx-modal-overlay--nested" role="dialog" aria-modal="true">
          <div className="nx-modal nx-owner-legal-command-modal">
            <div className="nx-modal-header">
              <h2>{cancelTarget.action.confirmation_title}</h2>
            </div>
            <div className="nx-modal-body">
              <p>{cancelTarget.action.confirmation_body}</p>
              {cancelTarget.documentNumber ? (
                <p>
                  מסמך: <strong>{cancelTarget.documentNumber}</strong>
                </p>
              ) : null}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                סיבת ביטול {cancelTarget.action.reason_required ? '(חובה)' : '(אופציונלי)'}
                <input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  disabled={busy}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </label>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy}
                onClick={clearCancelModal}
              >
                ביטול
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary"
                disabled={
                  busy ||
                  (cancelTarget.action.reason_required && !cancelReason.trim())
                }
                onClick={() => void handleConfirmCancel()}
              >
                אישור ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reopenTarget && !convertTarget && !cancelTarget ? (
        <div className="nx-modal-overlay nx-modal-overlay--nested" role="dialog" aria-modal="true">
          <div className="nx-modal nx-owner-legal-command-modal">
            <div className="nx-modal-header">
              <h2>{reopenTarget.action.confirmation_title}</h2>
            </div>
            <div className="nx-modal-body">
              <p>{reopenTarget.action.confirmation_body}</p>
              {(reopenTarget.documentTypeLabel || reopenTarget.documentNumber) ? (
                <p>
                  מסמך:{' '}
                  <strong>
                    {[reopenTarget.documentTypeLabel, reopenTarget.documentNumber]
                      .filter(Boolean)
                      .join(' ')}
                  </strong>
                </p>
              ) : null}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                סיבת פתיחה מחדש (חובה)
                <input
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  disabled={busy}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </label>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy}
                onClick={clearReopenModal}
              >
                ביטול
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary"
                disabled={busy || !reopenReason.trim()}
                onClick={() => void handleConfirmReopen()}
              >
                פתיחה מחדש
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
