import { useEffect, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import {
  moduleClientOperationsAnnualCommands,
  moduleClientOperationsAnnualFileOpen,
  moduleClientOperationsAnnualUpload,
} from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { fillI18n, localizeSystemLabel } from '../lib/co-display-label.pure';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type { AnnualDocumentRowDto, AnnualSubmissionRowDto, AnnualTabModel } from './annual-tab-types';
import { WorkspaceNestedDialogClose } from './WorkspaceNestedDialogClose';

function annualDocLabel(t: (key: string) => string, row: AnnualDocumentRowDto): string {
  return localizeSystemLabel(t, row.document_name_key, row.document_name_he);
}
import '../styles/nx-annual-report-tab.css';
import '../styles/nx-workspace-annual-tab.css';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function IconFolder() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 5.63a1 1 0 0 0 0-1.41L19.78 3.3a1 1 0 0 0-1.41 0l-1.46 1.46 3.75 3.75 1.45-1.88z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2h4v2H4V6h4l1-2z" />
    </svg>
  );
}

function statusBadgeClass(status: AnnualDocumentRowDto['status']): string {
  if (status === 'completed') return 'nx-annual-status-badge nx-annual-status-done';
  if (status === 'missing') return 'nx-annual-status-badge nx-annual-status-missing';
  return 'nx-annual-status-badge nx-annual-status-warn';
}

function IconCalendarSmall() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      className="nx-annual-cal-icon"
      fill="currentColor"
      aria-hidden
    >
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z" />
    </svg>
  );
}

type SubmissionDialogState =
  | null
  | { mode: 'add' }
  | { mode: 'edit'; row: AnnualSubmissionRowDto };

type UploadTarget = { kind: 'document'; id: string } | { kind: 'submission'; id: string } | null;

export function ClientAnnualReportTab({
  clientId,
  annualTab,
  onCaseUpdated,
}: {
  clientId: string;
  annualTab: AnnualTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notesDraft, setNotesDraft] = useState(annualTab.notes_card.notes ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>(null);
  const [submissionDlg, setSubmissionDlg] = useState<SubmissionDialogState>(null);

  useEffect(() => {
    setNotesDraft(annualTab.notes_card.notes ?? '');
  }, [annualTab.read_model_version, annualTab.notes_card.notes]);

  const postCmd = async (type: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setErr('');
    try {
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAnnualCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload,
          expected_version: annualTab.read_model_version,
          tab_scope: annualTab.tab_key,
        }),
      });
      onCaseUpdated(out);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (fileAssetId: string) => {
    setErr('');
    try {
      const { url } = await apiJson<{ url: string }>(`${moduleClientOperationsAnnualFileOpen(clientId, fileAssetId)}?tab_scope=${annualTab.tab_key}`, {
        method: 'GET',
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(userFacingApiMessage(e));
    }
  };

  const pickFileForRow = (rowId: string) => {
    setUploadTarget({ kind: 'document', id: rowId });
    fileRef.current?.click();
  };

  const pickFileForSubmission = (submissionId: string) => {
    setUploadTarget({ kind: 'submission', id: submissionId });
    fileRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = uploadTarget;
    setUploadTarget(null);
    if (!file || !target) return;
    setBusy(true);
    setErr('');
    try {
      const file_base64 = await fileToBase64(file);
      const { file_asset_id } = await apiJson<{ file_asset_id: string }>(moduleClientOperationsAnnualUpload(clientId), {
        method: 'POST',
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || null,
          file_base64,
          tab_scope: annualTab.tab_key,
        }),
      });
      const commandType = target.kind === 'document' ? 'attach_annual_document_file' : 'attach_annual_submission_file';
      const payload = target.kind === 'document' ? { row_id: target.id, file_asset_id } : { submission_id: target.id, file_asset_id };
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAnnualCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: commandType,
          payload,
          expected_version: annualTab.read_model_version,
          tab_scope: annualTab.tab_key,
        }),
      });
      onCaseUpdated(out);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    await postCmd('update_annual_notes', { notes: notesDraft });
  };

  const docHeaders = annualTab.documents_table.column_headers_he;
  const subHeaders = annualTab.submissions_table.column_headers_he;

  return (
    <div className="nx-annual-root nx-ws-annual">
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

      {err ? (
        <p className="nx-annual-err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="nx-annual-dashboard">
        <article className="nx-annual-dash-card nx-annual-dash-card--status" aria-labelledby="nx-annual-dash-status-heading">
          <h3 id="nx-annual-dash-status-heading" className="nx-annual-dash-card-title">
            {localizeSystemLabel(t, annualTab.status_card_title_key, annualTab.status_card_title_he)}
          </h3>
          <div className="nx-annual-dash-status-row">
            <span className={`nx-annual-dash-dot nx-annual-dash-dot--${annualTab.status.color}`} aria-hidden />
            <span className={`nx-annual-dash-status-label nx-annual-dash-status-label--${annualTab.status.color}`}>
              {localizeSystemLabel(t, annualTab.status.label_key, annualTab.status.label_he)}
            </span>
          </div>
          <p className="nx-annual-dash-risk">{localizeSystemLabel(t, annualTab.risk_indicator.label_key, annualTab.risk_indicator.label_he)}</p>
          <div className="nx-annual-dash-deadline">
            <IconCalendarSmall />
            <span>
              {annualTab.deadline_info.is_overdue
                ? t('clientOperations.annual.late')
                : fillI18n(t('clientOperations.annual.daysLeftToFile'), { n: annualTab.deadline_info.days_left })}
            </span>
          </div>
        </article>
        <article className="nx-annual-dash-card nx-annual-dash-card--missing" aria-labelledby="nx-annual-dash-missing-heading">
          <h3 id="nx-annual-dash-missing-heading" className="nx-annual-dash-card-title">
            {localizeSystemLabel(
              t,
              annualTab.missing_documents_section_title_key,
              annualTab.missing_documents_section_title_he,
            )}
          </h3>
          <div className="nx-annual-missing-dropdown-wrap">
            <select
              className="nx-annual-missing-dropdown"
              defaultValue=""
              aria-label={localizeSystemLabel(
                t,
                annualTab.missing_documents_section_title_key,
                annualTab.missing_documents_section_title_he,
              )}
            >
              <option value="" disabled>
                {localizeSystemLabel(
                  t,
                  annualTab.missing_documents_section_title_key,
                  annualTab.missing_documents_section_title_he,
                )}
              </option>
              {annualTab.documents_table.rows.filter((r) => r.status !== 'completed').length === 0 ? (
                <option value="none">{t('clientOperations.annual.noMissingDocuments')}</option>
              ) : (
                annualTab.documents_table.rows
                  .filter((r) => r.status !== 'completed')
                  .map((row) => (
                    <option key={row.row_id} value={row.row_id}>
                      {annualDocLabel(t, row)}
                    </option>
                  ))
              )}
            </select>
          </div>
          <div
            className="nx-annual-dash-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={annualTab.completion_percent}
            aria-label={t('clientOperations.annual.completeDocuments')}
          >
            <div
              className={`nx-annual-dash-progress-fill nx-annual-dash-progress-fill--${annualTab.status.color}`}
              style={{ width: `${annualTab.completion_percent}%` }}
            />
          </div>
        </article>
      </div>

      {annualTab.visibility.show_documents ? (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="nx-annual-card-title">{localizeSystemLabel(t, annualTab.documents_table.card_title_key, annualTab.documents_table.card_title_he)}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {annualTab.documents_table.add_custom_enabled ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt(t('clientOperations.annual.documentName'));
                    if (name != null && name.trim()) void postCmd('add_annual_document_row', { document_name_he: name.trim() });
                  }}
                >
                  {localizeSystemLabel(
                    t,
                    annualTab.documents_table.add_custom_label_key,
                    annualTab.documents_table.add_custom_label_he,
                  )}
                </button>
              ) : null}
            </div>
          </div>
          {annualTab.documents_table.summary ? (
            <div className="nx-annual-summary-bar" role="status">
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.totalDocuments')}</span>
                <span className="nx-annual-summary-value">{annualTab.documents_table.summary.total_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.receivedCount')}</span>
                <span className="nx-annual-summary-value">{annualTab.documents_table.summary.received_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.missingCount')}</span>
                <span className="nx-annual-summary-value">{annualTab.documents_table.summary.missing_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.fees.lastUpdated')}</span>
                <span className="nx-annual-summary-value nx-annual-summary-value--muted">{annualTab.documents_table.summary.updated_display_he}</span>
              </span>
            </div>
          ) : null}
          <div className="nx-annual-table-wrap">
            <table className="nx-annual-table nx-annual-table--documents">
              <colgroup>
                <col className="nx-annual-col--received" />
                <col className="nx-annual-col--doc-name" />
                <col className="nx-annual-col--file" />
                <col className="nx-annual-col--status" />
                <col className="nx-annual-col--note" />
              </colgroup>
              <thead>
                <tr>
                  {docHeaders.map((h, idx) => (
                    <th key={h}>
                      {idx === 0
                        ? ''
                        : localizeSystemLabel(t, annualTab.documents_table.column_header_keys?.[idx], h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {annualTab.documents_table.rows.length === 0 ? (
                  <tr>
                    <td colSpan={docHeaders.length} className="nx-annual-empty-cell">
                      {localizeSystemLabel(
                        t,
                        annualTab.documents_table.empty_state_key,
                        annualTab.documents_table.empty_state_he,
                      )}
                    </td>
                  </tr>
                ) : (
                  annualTab.documents_table.rows.map((row) => (
                    <DocumentRow
                      key={row.row_id}
                      row={row}
                      busy={busy}
                      onToggle={() => void postCmd('toggle_annual_document_received', { row_id: row.row_id, received: !row.received })}
                      onPickFile={() => pickFileForRow(row.row_id)}
                      onOpenFile={() => row.file.file_asset_id && void openFile(row.file.file_asset_id)}
                      onRemoveFile={() => void postCmd('remove_annual_document_file', { row_id: row.row_id })}
                      onRowNoteBlur={(note) => {
                        const next = note.trim() === '' ? null : note;
                        if (next === row.row_note) return;
                        void postCmd('update_annual_document_row', { row_id: row.row_id, row_note: next });
                      }}
                      onRemoveRow={() => {
                        if (window.confirm(t('clientOperations.annual.deleteRowConfirm'))) {
                          void postCmd('remove_annual_document_row', { row_id: row.row_id });
                        }
                      }}
                      onRename={() => {
                        const n = window.prompt(t('clientOperations.annual.documentName'), row.document_name_he);
                        if (n != null && n.trim() && n.trim() !== row.document_name_he) {
                          void postCmd('update_annual_document_row', { row_id: row.row_id, document_name_he: n.trim() });
                        }
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="nx-annual-lower">
        {annualTab.visibility.show_submissions ? (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h3 className="nx-annual-card-title">{localizeSystemLabel(t, annualTab.submissions_table.card_title_key, annualTab.submissions_table.card_title_he)}</h3>
              {annualTab.submissions_table.add_row_enabled ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => setSubmissionDlg({ mode: 'add' })}
                >
                  {localizeSystemLabel(
                    t,
                    annualTab.submissions_table.add_row_label_key,
                    annualTab.submissions_table.add_row_label_he,
                  )}
                </button>
              ) : null}
            </div>
            <div className="nx-annual-table-wrap">
              <table className="nx-annual-table nx-annual-table--submissions">
                <colgroup>
                  <col className="nx-annual-sub-col--year" />
                  <col className="nx-annual-sub-col--date" />
                  <col className="nx-annual-sub-col--status" />
                  <col className="nx-annual-sub-col--report" />
                  <col className="nx-annual-sub-col--actions" />
                </colgroup>
                <thead>
                  <tr>
                    {subHeaders.map((h, idx) => (
                      <th key={h}>{localizeSystemLabel(t, annualTab.submissions_table.column_header_keys?.[idx], h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {annualTab.submissions_table.rows.length === 0 ? (
                    <tr>
                      <td colSpan={subHeaders.length} className="nx-annual-empty-cell">
                        {localizeSystemLabel(
                          t,
                          annualTab.submissions_table.empty_state_key,
                          annualTab.submissions_table.empty_state_he,
                        )}
                      </td>
                    </tr>
                  ) : (
                    annualTab.submissions_table.rows.map((s) => (
                      <tr key={s.submission_id}>
                        <td>{s.tax_year}</td>
                        <td>{s.submitted_on}</td>
                        <td>{localizeSystemLabel(t, s.status_label_key, s.status_label_he)}</td>
                        <td>
                          {s.file.state === 'attached' && s.file.file_asset_id ? (
                            <button
                              type="button"
                              className="nx-annual-report-file-action nx-annual-report-file-action--attached"
                              disabled={busy || !s.actions.can_open_file}
                              onClick={() => {
                                const id = s.file.file_asset_id;
                                if (id) void openFile(id);
                              }}
                              aria-label={t('clientOperations.annual.viewReport')}
                              title={t('clientOperations.annual.viewReport')}
                            >
                              <IconDocument />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="nx-annual-report-file-action nx-annual-report-file-action--empty"
                              disabled={busy || !s.actions.can_attach_file}
                              onClick={() => pickFileForSubmission(s.submission_id)}
                              aria-label={t('clientOperations.annual.attachReport')}
                              title={t('clientOperations.annual.attachReport')}
                            >
                              <IconDocument />
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="nx-annual-row-actions">
                            {s.actions.can_edit ? (
                              <button
                                type="button"
                                className="nx-annual-icon-action"
                                disabled={busy}
                                onClick={() => setSubmissionDlg({ mode: 'edit', row: s })}
                                aria-label={t('clientOperations.edit')}
                                title={t('clientOperations.edit')}
                              >
                                <IconEdit />
                              </button>
                            ) : null}
                            {s.actions.can_remove ? (
                              <button
                                type="button"
                                className="nx-annual-icon-action"
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm(t('clientOperations.annual.deleteRecordConfirm'))) {
                                    void postCmd('remove_annual_submission_date', { submission_id: s.submission_id });
                                  }
                                }}
                                aria-label={t('clientOperations.delete')}
                                title={t('clientOperations.delete')}
                              >
                                <IconTrash />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div />
        )}

        {annualTab.visibility.show_notes ? (
          <section className="nx-annual-notes-card">
            <h3 className="nx-annual-card-title">{localizeSystemLabel(t, annualTab.notes_card.card_title_key, annualTab.notes_card.card_title_he)}</h3>
            <textarea
              className="nx-annual-notes-ta"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder={localizeSystemLabel(
                t,
                annualTab.notes_card.placeholder_key,
                annualTab.notes_card.placeholder_he,
              )}
              disabled={!annualTab.notes_card.edit_enabled || busy}
            />
            {annualTab.notes_card.edit_enabled ? (
              <div className="nx-annual-dialog-footer" style={{ marginTop: 10 }}>
                <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={() => void saveNotes()}>
                  {localizeSystemLabel(t, annualTab.notes_card.save_label_key, annualTab.notes_card.save_label_he)}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {submissionDlg ? (
        <SubmissionDialog
          state={submissionDlg}
          busy={busy}
          onClose={() => setSubmissionDlg(null)}
          onSave={async (payload) => {
            if (submissionDlg.mode === 'add') {
              await postCmd('add_annual_submission_date', payload);
            } else {
              await postCmd('update_annual_submission_date', { submission_id: submissionDlg.row.submission_id, ...payload });
            }
            setSubmissionDlg(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DocumentRow({
  row,
  busy,
  onToggle,
  onPickFile,
  onOpenFile,
  onRemoveFile,
  onRowNoteBlur,
  onRemoveRow,
  onRename,
}: {
  row: AnnualDocumentRowDto;
  busy: boolean;
  onToggle: () => void;
  onPickFile: () => void;
  onOpenFile: () => void;
  onRemoveFile: () => void;
  onRowNoteBlur: (note: string) => void;
  onRemoveRow: () => void;
  onRename: () => void;
}) {
  const { t } = useI18n();
  const [noteLocal, setNoteLocal] = useState(row.row_note ?? '');
  useEffect(() => {
    setNoteLocal(row.row_note ?? '');
  }, [row.row_id, row.row_note]);

  const rowClass =
    row.row_style === 'success'
      ? `nx-annual-doc-row nx-annual-doc-row--success nx-annual-doc-row--completed`
      : `nx-annual-doc-row nx-annual-doc-row--${row.row_style}`;

  return (
    <tr className={rowClass}>
      <td className="nx-annual-td">
        <input type="checkbox" checked={row.received} disabled={!row.actions.can_toggle_received || busy} onChange={onToggle} />
      </td>
      <td className="nx-annual-td nx-annual-td--doc-name">
        <div className="nx-annual-doc-name-row">
          <span className="nx-annual-doc-name">{annualDocLabel(t, row)}</span>
          {row.description_he ? (
            <span
              aria-label={localizeSystemLabel(t, row.description_key, row.description_he)}
              title={localizeSystemLabel(t, row.description_key, row.description_he)}
              style={{
                display: 'inline-flex',
                width: 16,
                height: 16,
                borderRadius: '50%',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #94a3b8',
                color: '#64748b',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'help',
              }}
            >
              i
            </span>
          ) : null}
          {row.source_type === 'custom' ? <span className="nx-annual-badge">{t('clientOperations.annual.customBadge')}</span> : null}
          {row.actions.can_rename_document || row.actions.can_remove_row ? (
            <span className="nx-annual-doc-inline-actions">
              {row.actions.can_rename_document ? (
                <button type="button" className="nx-annual-inline-action" disabled={busy} onClick={onRename}>
                  {t('clientOperations.annual.rename')}
                </button>
              ) : null}
              {row.actions.can_remove_row ? (
                <button type="button" className="nx-annual-inline-action nx-annual-inline-action--danger" disabled={busy} onClick={onRemoveRow}>
                  {t('clientOperations.delete')}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </td>
      <td className="nx-annual-td nx-annual-td--file">
        {row.file.state === 'attached' && row.file.file_asset_id ? (
          <div className="nx-annual-file-cell">
            <span className="nx-annual-file-cell-icon" aria-hidden>
              <IconDocument />
            </span>
            <button type="button" className="nx-annual-file-name" onClick={onOpenFile} disabled={busy}>
              {row.file.file_name || t('clientOperations.annual.file')}
            </button>
            {row.actions.can_remove_file ? (
              <button
                type="button"
                className="nx-annual-file-remove"
                disabled={busy}
                onClick={onRemoveFile}
                title={t('clientOperations.annual.removeFile')}
              >
                {t('clientOperations.annual.removeFile')}
              </button>
            ) : null}
          </div>
        ) : row.actions.can_attach_file ? (
          <button
            type="button"
            className="nx-annual-folder-btn"
            title={t('clientOperations.annual.attachFile')}
            disabled={busy}
            onClick={onPickFile}
          >
            <IconFolder />
          </button>
        ) : (
          <span className="nx-annual-dash">—</span>
        )}
      </td>
      <td className="nx-annual-td">
        <span className={statusBadgeClass(row.status)}>
          {localizeSystemLabel(t, row.status_label_key, row.status_label_he)}
        </span>
      </td>
      <td className="nx-annual-td">
        <input
          className="nx-annual-note-inp"
          value={noteLocal}
          disabled={!row.actions.can_edit_row_note || busy}
          onChange={(e) => setNoteLocal(e.target.value)}
          onBlur={() => onRowNoteBlur(noteLocal)}
        />
      </td>
    </tr>
  );
}

function SubmissionDialog({
  state,
  busy,
  onClose,
  onSave,
}: {
  state: NonNullable<SubmissionDialogState>;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const isEdit = state.mode === 'edit';
  const r = isEdit ? state.row : null;
  const [taxYear, setTaxYear] = useState(isEdit ? String(r!.tax_year) : String(new Date().getFullYear()));
  const [submittedOn, setSubmittedOn] = useState(isEdit ? r!.submitted_on : '');
  const [status, setStatus] = useState(isEdit ? r!.status : 'submitted');
  const [note, setNote] = useState(isEdit ? r!.note ?? '' : '');

  return (
    <div className="nx-annual-dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nx-annual-dialog" role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
        <WorkspaceNestedDialogClose disabled={busy} onClick={onClose} />
        <h4>{isEdit ? t('clientOperations.annual.editSubmission') : t('clientOperations.annual.addSubmissionDate')}</h4>
        <label>{t('clientOperations.annual.taxYear')}</label>
        <input type="number" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} disabled={busy} />
        <label>{t('clientOperations.annual.submissionDate')}</label>
        <input type="date" min="2023-01-01" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} disabled={busy} />
        <label>{t('clientOperations.annual.status')}</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
          <option value="submitted">{t('clientOperations.annual.submitted')}</option>
          <option value="late">{t('clientOperations.annual.late')}</option>
          <option value="extension">{t('clientOperations.annual.extended')}</option>
          <option value="draft">{t('clientOperations.annual.draft')}</option>
        </select>
        <label>{t('clientOperations.annual.note')}</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <div className="nx-annual-dialog-footer">
          <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            {t('clientOperations.cancel')}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy}
            onClick={() => {
              const ty = Number(taxYear);
              if (!Number.isFinite(ty)) return;
              void onSave({
                tax_year: ty,
                submitted_on: submittedOn,
                status,
                note: note.trim() === '' ? null : note,
              });
            }}
          >
            {t('clientOperations.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
