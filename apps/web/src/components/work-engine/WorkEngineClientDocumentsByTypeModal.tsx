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
import { btnPrimary } from '../../pages/owner-legal-control-panel-actions';

type OpenParams = {
  representedClientId: string;
  clientDisplayName: string;
  documentTypeKey: IncomeClientDocumentTypeCounterKey;
  documentTypeLabel: string;
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

  const loadAggregate = useCallback(
    async (year?: number | null) => {
      if (!params) return;
      setLoading(true);
      onBusyChange?.(true);
      try {
        const agg = await fetchWorkEngineInvoicesClientDocumentsByTypeAggregate({
          representedClientId: params.representedClientId,
          documentTypeKey: params.documentTypeKey,
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
                    <tr key={row.row_id}>
                      {columns.map((col) => {
                        if (col.key === 'actions') {
                          const hasDedicatedViewColumn = columns.some((column) => column.key === 'view');
                          const creditAction = row.credit_action ?? null;
                          const convertAction = convertActionOf(row);
                          const showCredit = Boolean(creditAction);
                          const showConvert = Boolean(convertAction);
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
          dir="rtl"
        >
          <div className="nx-modal nx-owner-legal-command-modal nx-accounting-editor-modal">
            <div className="nx-modal-header">
              <h2>{convertTarget.action.label || 'הפקת מסמך'}</h2>
            </div>
            <div className="nx-modal-body">
              {convertTarget.row.document_number ? (
                <p>
                  מסמך מקור: <strong>{convertTarget.row.document_number}</strong>
                </p>
              ) : null}
              <div
                role="radiogroup"
                aria-label={convertTarget.action.label || 'הפקת מסמך'}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}
              >
                {convertTarget.action.targets.map((target) => {
                  const optionId = `nx-we-convert-target-${target.document_type}`;
                  return (
                    <label
                      key={target.document_type}
                      htmlFor={optionId}
                      title={target.disabled_reason ?? target.label}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid #d1d5db',
                        opacity: target.enabled ? 1 : 0.55,
                        cursor: busy || !target.enabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input
                        id={optionId}
                        type="radio"
                        name="nx-we-convert-target"
                        value={target.document_type}
                        checked={selectedConvertDocumentType === target.document_type}
                        disabled={busy || !target.enabled}
                        onChange={() => setSelectedConvertDocumentType(target.document_type)}
                        style={{ marginTop: 2 }}
                      />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{target.label}</span>
                        {!target.enabled && target.disabled_reason ? (
                          <span style={{ fontSize: 12, color: '#64748b' }}>{target.disabled_reason}</span>
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
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy}
                onClick={closeConvertModal}
              >
                ביטול
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary"
                style={btnPrimary}
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
