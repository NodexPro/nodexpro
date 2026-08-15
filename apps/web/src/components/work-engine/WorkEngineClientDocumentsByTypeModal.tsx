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
import type { WorkEngineDocumentCreditAction } from '../../income/income-workspace-types';

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
}: Props) {
  const [aggregate, setAggregate] = useState<WorkEngineInvoicesClientDocumentsByTypeAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [docEmailHistoryId, setDocEmailHistoryId] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState<{
    documentId: string;
    documentNumber: string | null;
    action: WorkEngineDocumentCreditAction;
  } | null>(null);
  const [creditMode, setCreditMode] = useState<'full' | 'partial'>('full');
  const [creditReasonKey, setCreditReasonKey] = useState('billing_error');
  const [creditReasonNote, setCreditReasonNote] = useState('');

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
      return;
    }
    void loadAggregate();
  }, [loadAggregate, open, params]);

  const handleConfirmCredit = async () => {
    if (!creditTarget?.action.enabled) return;
    onBusyChange?.(true);
    try {
      const res = await executeIncomeCommand(creditTarget.action.command, {
        income_document_id: creditTarget.documentId,
        credit_mode: creditMode,
        reason_key: creditReasonKey,
        reason_note: creditReasonNote.trim() || null,
        idempotency_key: crypto.randomUUID(),
        documents_list_year: aggregate?.selected_year ?? null,
      });
      const list = (res as { work_engine_invoices_client_documents_by_type_aggregate?: WorkEngineInvoicesClientDocumentsByTypeAggregate }).work_engine_invoices_client_documents_by_type_aggregate;
      if (list) setAggregate(list);
      setCreditTarget(null);
      setCreditReasonNote('');
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

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
                          const showCredit = Boolean(creditAction);
                          const showView =
                            !hasDedicatedViewColumn && Boolean(row.can_view_document);
                          return (
                            <td key={col.key} className="nx-we-documents-modal__action-col">
                              {showView ||
                              showCredit ||
                              workEngineDocumentsRowDeliveryVisible(row).showEmail ||
                              workEngineDocumentsRowDeliveryVisible(row).showDocflow ? (
                                <div className="nx-we-documents-modal__row-actions">
                                  {showCredit && creditAction ? (
                                    <button
                                      type="button"
                                      className="nx-btn nx-btn-taxes-compact"
                                      disabled={busy || loading || !creditAction.enabled}
                                      title={creditAction.disabled_reason ?? creditAction.label}
                                      onClick={() => {
                                        setCreditTarget({
                                          documentId: row.document_id ?? '',
                                          documentNumber: row.document_number,
                                          action: creditAction,
                                        });
                                        setCreditMode('full');
                                        setCreditReasonKey(creditAction.reason_options[0]?.key ?? 'billing_error');
                                        setCreditReasonNote('');
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
      {creditTarget ? (
        <div className="nx-modal-overlay nx-modal-overlay--nested" role="dialog" aria-modal="true">
          <div className="nx-modal nx-owner-legal-command-modal">
            <div className="nx-modal-header">
              <h2>{creditTarget.action.label}</h2>
            </div>
            <div className="nx-modal-body">
              <p>החשבונית המקורית לא תבוטל. יווצר מסמך זיכוי חדש ומקושר.</p>
              <label>
                סוג זיכוי
                <select value={creditMode} disabled={busy} onChange={(e) => setCreditMode(e.target.value === 'partial' ? 'partial' : 'full')}>
                  {creditTarget.action.modes.map((mode) => (
                    <option key={mode.key} value={mode.key}>{mode.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setCreditTarget(null)}>סגירה</button>
              <button type="button" className="nx-btn nx-btn-taxes-compact nx-btn-primary" disabled={busy || !creditTarget.action.enabled} onClick={() => void handleConfirmCredit()}>המשך</button>
            </div>
          </div>
        </div>
      ) : null}
      <IncomeDocumentEmailHistoryModal
        open={docEmailHistoryId != null}
        incomeDocumentId={docEmailHistoryId}
        representedClientId={params.representedClientId}
        busy={busy}
        onBusyChange={onBusyChange}
        onClose={() => setDocEmailHistoryId(null)}
        onError={onError}
      />
    </>
  );
}
