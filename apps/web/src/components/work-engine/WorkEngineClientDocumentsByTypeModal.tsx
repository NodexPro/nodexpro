import { useCallback, useEffect, useState } from 'react';
import type {
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
};

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
}: Props) {
  const [aggregate, setAggregate] = useState<WorkEngineInvoicesClientDocumentsByTypeAggregate | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!open || !params) return null;

  const title = `מסמכים — ${params.documentTypeLabel} — ${params.clientDisplayName}`;
  const columns = aggregate?.table_columns ?? [];
  const rows = aggregate?.rows ?? [];
  const availableYears = aggregate?.available_years ?? [];
  const selectedYear = aggregate?.selected_year ?? new Date().getFullYear();

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
      <div className="nx-we-documents-modal nx-income-wizard nx-accounting-editor-modal">
        <div className="nx-income-wizard__head nx-we-documents-modal__head">
          <h2 className="nx-modal-title">{title}</h2>
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
                        if (col.key === 'view') {
                          return (
                            <td key={col.key} className="nx-we-documents-modal__action-col">
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
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        }
                        if (col.key === 'edit') {
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

        <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || loading} onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  );
}
