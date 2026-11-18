import { useEffect, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import {
  moduleClientOperationsAnnualCommands,
  moduleClientOperationsAnnualFileOpen,
  moduleClientOperationsAnnualUpload,
  moduleClientOperationsCase,
} from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n/I18nProvider';
import { fillI18n, localizeSystemLabel } from '../lib/co-display-label.pure';
import {
  annualTabVersionFromCase,
  getAnnualYearSnapshot,
  invalidateAnnualYearSnapshotsForClient,
  isAnnualVersionConflict,
  mayRetryAnnualCommandAfterVersionConflict,
  putAnnualYearSnapshot,
  resolveDisplayedAnnualTaxYear,
  shouldApplyAnnualYearPersistResponse,
} from '../lib/client-operations-annual-year-cache.pure';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import { displayedPendingIsoDate } from '../lib/client-operations-filing-date-field.pure';
import type { AnnualDocumentRowDto, AnnualSubmissionRowDto, AnnualTabModel } from './annual-tab-types';
import { ClientOperationsFilingDateField } from './client-operations/ClientOperationsFilingDateField';
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

function statusBadgeClass(row: AnnualDocumentRowDto, capital: boolean): string {
  if (capital && row.receipt_mark === 'cyan_check') return 'nx-annual-status-badge nx-annual-status-received';
  if (capital && row.show_missing_badge) return 'nx-annual-status-badge nx-annual-status-missing-alert';
  if (capital) return '';
  if (row.status === 'completed') return 'nx-annual-status-badge nx-annual-status-done';
  if (row.status === 'missing') return 'nx-annual-status-badge nx-annual-status-missing';
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
  const { t, lang } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const auth = useAuth();
  const organizationId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const boardYears = annualTab.filing_years ?? [];
  const olderYears = annualTab.older_tax_years ?? [];
  const extraYears = olderYears.map((year) => year.tax_year);
  const yearViews = annualTab.year_views ?? [];
  const olderYearSelect = annualTab.older_tax_year_select;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notesDraft, setNotesDraft] = useState(annualTab.notes_card.notes ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>(null);
  const [submissionDlg, setSubmissionDlg] = useState<SubmissionDialogState>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(() =>
    resolveDisplayedAnnualTaxYear({
      selectedYear: annualTab.working_tax_year ?? null,
      workingTaxYear: annualTab.working_tax_year ?? null,
      boardYears: boardYears.map((year) => year.tax_year),
      extraYears,
    }),
  );
  const [archiveOpenKey, setArchiveOpenKey] = useState<string | null>(null);
  const [pendingDueDate, setPendingDueDate] = useState<string | null>(null);
  const [historyOpenKey, setHistoryOpenKey] = useState<string | null>(null);
  const capitalDateGenRef = useRef(0);
  const [yearPersistPending, setYearPersistPending] = useState(false);
  const yearCacheRef = useRef(new Map<string, (typeof yearViews)[number]>());
  const persistGenRef = useRef(0);
  const persistInFlightRef = useRef(false);
  const pendingPersistYearRef = useRef<number | null>(null);
  const selectedYearRef = useRef<number | null>(null);
  const workingYearRef = useRef(annualTab.working_tax_year ?? null);
  const expectedVersionRef = useRef(annualTab.read_model_version);

  useEffect(() => {
    setNotesDraft(annualTab.notes_card.notes ?? '');
  }, [annualTab.read_model_version, annualTab.notes_card.notes]);

  useEffect(() => {
    const version = annualTab.read_model_version;
    if (typeof version === 'number' && Number.isFinite(version)) {
      expectedVersionRef.current = version;
    }
    workingYearRef.current = annualTab.working_tax_year ?? workingYearRef.current;
  }, [annualTab.read_model_version, annualTab.working_tax_year]);

  useEffect(() => {
    workingYearRef.current = annualTab.working_tax_year ?? null;
    expectedVersionRef.current = annualTab.read_model_version;
    setPendingDueDate(null);
    setHistoryOpenKey(null);
    setSelectedYear(
      resolveDisplayedAnnualTaxYear({
        selectedYear: null,
        workingTaxYear: annualTab.working_tax_year ?? null,
        boardYears: (annualTab.filing_years ?? []).map((year) => year.tax_year),
        extraYears: (annualTab.older_tax_years ?? []).map((year) => year.tax_year),
      }),
    );
  }, [clientId]);

  useEffect(() => {
    const confirmed = annualTab.assigned_due_date ?? '';
    if (pendingDueDate != null && pendingDueDate === confirmed) {
      setPendingDueDate(null);
    }
  }, [annualTab.assigned_due_date, annualTab.read_model_version, pendingDueDate]);

  useEffect(() => {
    setSelectedYear((current) =>
      resolveDisplayedAnnualTaxYear({
        selectedYear: current,
        workingTaxYear: annualTab.working_tax_year ?? null,
        boardYears: (annualTab.filing_years ?? []).map((year) => year.tax_year),
        extraYears: (annualTab.older_tax_years ?? []).map((year) => year.tax_year),
      }),
    );
  }, [annualTab.working_tax_year, annualTab.filing_years, annualTab.older_tax_years]);

  useEffect(() => {
    invalidateAnnualYearSnapshotsForClient(yearCacheRef.current, { organizationId, clientId });
    for (const view of annualTab.year_views ?? []) {
      putAnnualYearSnapshot(
        yearCacheRef.current,
        {
          organizationId,
          clientId,
          taxYear: view.tax_year,
          aggregateVersion: annualTab.read_model_version,
        },
        view,
      );
    }
  }, [organizationId, clientId, annualTab.read_model_version, annualTab.year_views]);

  const displayedYear = resolveDisplayedAnnualTaxYear({
    selectedYear,
    workingTaxYear: annualTab.working_tax_year ?? null,
    boardYears: boardYears.map((year) => year.tax_year),
    extraYears,
  });
  selectedYearRef.current = displayedYear;
  const isAnnualBoard = annualTab.tab_key === 'annual_report';
  const yearView =
    yearViews.find((view) => view.tax_year === displayedYear) ??
    (displayedYear != null
      ? getAnnualYearSnapshot(yearCacheRef.current, {
          organizationId,
          clientId,
          taxYear: displayedYear,
          aggregateVersion: annualTab.read_model_version,
        })
      : null);
  const yearContentPending = Boolean(
    isAnnualBoard && displayedYear != null && !yearView,
  ) || Boolean(
    displayedYear != null &&
      yearView?.visibility.show_working_checklist &&
      (yearView.documents_table.rows?.length ?? 0) === 0 &&
      yearPersistPending &&
      displayedYear !== annualTab.working_tax_year,
  );

  const applyReturnedVersion = (out: ClientOperationsCaseResponse) => {
    const nextVersion = annualTabVersionFromCase(out, annualTab.tab_key);
    if (nextVersion != null) expectedVersionRef.current = nextVersion;
  };

  const postAnnualCommand = async (
    type: string,
    payload: Record<string, unknown>,
  ): Promise<ClientOperationsCaseResponse> => {
    const body = () =>
      JSON.stringify({
        type,
        payload,
        expected_version: expectedVersionRef.current,
        tab_scope: annualTab.tab_key,
      });
    try {
      return await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAnnualCommands(clientId), {
        method: 'POST',
        body: body(),
      });
    } catch (attachErr) {
      if (!isAnnualVersionConflict(attachErr)) throw attachErr;
      const refreshed = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(clientId), {
        method: 'GET',
      });
      applyReturnedVersion(refreshed);
      onCaseUpdated(refreshed);
      if (
        !mayRetryAnnualCommandAfterVersionConflict(type) ||
        annualTabVersionFromCase(refreshed, annualTab.tab_key) == null
      ) {
        throw attachErr;
      }
      return await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAnnualCommands(clientId), {
        method: 'POST',
        body: body(),
      });
    }
  };

  const postCmd = async (type: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setErr('');
    try {
      const out = await postAnnualCommand(type, payload);
      applyReturnedVersion(out);
      onCaseUpdated(out);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const assignCapitalDueDate = async (iso: string) => {
    if (!iso || iso === (annualTab.assigned_due_date ?? '') && pendingDueDate == null) return;
    const gen = ++capitalDateGenRef.current;
    setPendingDueDate(iso);
    setErr('');
    try {
      const out = await postAnnualCommand('set_capital_declaration_operational_target_date', {
        operational_target_date: iso,
        operational_period_key: annualTab.capital_workspace?.working_panel.operational_period_key,
      });
      if (gen !== capitalDateGenRef.current) return;
      applyReturnedVersion(out);
      onCaseUpdated(out);
    } catch (e) {
      if (gen !== capitalDateGenRef.current) return;
      setPendingDueDate(null);
      setErr(userFacingApiMessage(e));
    }
  };

  const persistWorkingYear = (taxYear: number) => {
    pendingPersistYearRef.current = taxYear;
    setYearPersistPending(true);
    const run = async () => {
      if (persistInFlightRef.current) return;
      const nextYear = pendingPersistYearRef.current;
      if (nextYear == null) {
        setYearPersistPending(false);
        return;
      }
      if (nextYear === workingYearRef.current) {
        pendingPersistYearRef.current = null;
        setYearPersistPending(false);
        return;
      }
      pendingPersistYearRef.current = null;
      persistInFlightRef.current = true;
      const generation = ++persistGenRef.current;
      try {
        const out = await postAnnualCommand('select_annual_working_tax_year', { tax_year: nextYear });
        const nextVersion = annualTabVersionFromCase(out, annualTab.tab_key);
        if (nextVersion != null) expectedVersionRef.current = nextVersion;
        workingYearRef.current = nextYear;
        const apply = shouldApplyAnnualYearPersistResponse({
          selectedYear: selectedYearRef.current,
          persistedYear: nextYear,
          pendingYear: pendingPersistYearRef.current,
          persistGeneration: persistGenRef.current,
          responseGeneration: generation,
        });
        if (apply) onCaseUpdated(out);
      } catch (e) {
        if (generation === persistGenRef.current) setErr(userFacingApiMessage(e));
      } finally {
        persistInFlightRef.current = false;
        if (pendingPersistYearRef.current != null) {
          void run();
        } else {
          setYearPersistPending(false);
        }
      }
    };
    void run();
  };

  const selectYearTab = (taxYear: number, canSelect: boolean) => {
    setSelectedYear(taxYear);
    selectedYearRef.current = taxYear;
    setErr('');
    if (!canSelect) return;
    if (taxYear === workingYearRef.current) return;
    persistWorkingYear(taxYear);
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
    if (busy) return;
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
      const out = await postAnnualCommand(commandType, payload);
      applyReturnedVersion(out);
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

  const annualYearReady = !isAnnualBoard || yearView != null;
  const activeDocuments = yearView?.documents_table ?? (isAnnualBoard ? { ...annualTab.documents_table, rows: [] } : annualTab.documents_table);
  const showChecklist = annualYearReady && (yearView ? yearView.visibility.show_working_checklist : annualTab.visibility.show_documents);
  const showMissingProblem =
    annualYearReady &&
    (yearView
      ? yearView.visibility.show_missing_as_active_problem
      : annualTab.visibility.show_missing_as_active_problem !== false && isAnnualBoard
        ? true
        : annualTab.visibility.show_missing_as_active_problem === true);
  const showReadiness =
    annualYearReady &&
    (yearView
      ? yearView.visibility.show_document_readiness
      : isAnnualBoard
        ? true
        : annualTab.visibility.show_document_readiness === true);
  const showDeadline =
    annualYearReady &&
    (yearView ? yearView.visibility.show_deadline : isAnnualBoard ? true : annualTab.visibility.show_deadline === true);
  const showFiledConfirmation =
    yearView?.visibility.show_filed_confirmation === true ||
    (!isAnnualBoard && annualTab.visibility.show_filed_confirmation === true);
  const filedConfirmation = yearView?.filed_confirmation ?? annualTab.filed_confirmation ?? null;
  const filingStatus = yearView?.filing_status ?? (isAnnualBoard ? null : annualTab.filing_status);
  const documentReadiness = yearView?.document_readiness ?? (isAnnualBoard ? null : annualTab.document_readiness ?? annualTab.status);
  const completionPercent = yearView?.completion_percent ?? (annualYearReady ? annualTab.completion_percent : 0);
  const missingRows = (yearView?.documents_table.rows ?? (isAnnualBoard ? [] : annualTab.documents_table.rows)).filter(
    (row) => row.status !== 'completed',
  );
  const docHeaders = activeDocuments.column_headers_he;
  const subHeaders = annualTab.submissions_table.column_headers_he;

  return (
    <div className="nx-annual-root nx-ws-annual" data-tab-key={annualTab.tab_key}>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

      {err ? (
        <p className="nx-annual-err" role="alert">
          {err}
        </p>
      ) : null}

      {boardYears.length > 0 || olderYearSelect?.visible ? (
        <div className="nx-annual-year-tabs" role="tablist" aria-label={t('clientOperations.annual.yearTabsAria')} data-testid="annual-tab-year-tabs">
          {boardYears.map((year) => {
            const selected = year.tax_year === displayedYear;
            const view = yearViews.find((item) => item.tax_year === year.tax_year);
            const canSelect = view?.allowed_actions.can_select ?? year.can_select_working;
            return (
              <button
                key={year.tax_year}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`nx-annual-year-tab${selected ? ' is-selected' : ''}${year.filed ? ' is-filed' : ' is-open'}`}
                data-testid={`annual-tab-filing-year-${year.tax_year}`}
                disabled={!canSelect}
                onClick={() => selectYearTab(year.tax_year, canSelect)}
              >
                {year.tax_year}
              </button>
            );
          })}
          {olderYearSelect?.visible ? (
            <label className="nx-annual-older-year">
              <span className="nx-annual-older-year-label">{t(olderYearSelect.label_key)}</span>
              <select
                className="nx-annual-older-year-select"
                data-testid="annual-tab-older-year-select"
                value={extraYears.includes(displayedYear as number) ? String(displayedYear) : ''}
                disabled={!olderYearSelect.can_select}
                onChange={(e) => {
                  const nextYear = Number(e.target.value);
                  const option = olderYears.find((row) => row.tax_year === nextYear);
                  if (!option) return;
                  selectYearTab(option.tax_year, option.can_select);
                }}
              >
                <option value="">{t(olderYearSelect.placeholder_key)}</option>
                {olderYears.map((year) => (
                  <option key={year.tax_year} value={year.tax_year}>
                    {year.tax_year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="nx-annual-year-panel" data-testid="annual-tab-year-panel">
        {yearContentPending ? (
          <p className="nx-annual-year-loading" role="status">
            {t('clientOperations.annual.yearContentLoading')}
          </p>
        ) : null}
      {!isAnnualBoard ? (
        <div className="nx-annual-dashboard nx-capital-top-panels" data-testid="capital-tab-top-panels">
          <article className="nx-annual-dash-card nx-capital-ready-panel" data-testid="capital-tab-ready-panel">
            <h3 className="nx-annual-dash-card-title">
              {t(annualTab.capital_workspace?.working_panel.title_key ?? 'clientOperations.annual.readyForNewCapital')}
            </h3>
            <ClientOperationsFilingDateField
              id={`capital-due-date-${clientId}`}
              label={t(annualTab.capital_workspace?.working_panel.date_field_label_key ?? 'clientOperations.annual.assignCapitalDueDate')}
              value={displayedPendingIsoDate({
                confirmed: annualTab.assigned_due_date ?? annualTab.capital_workspace?.working_panel.assigned_due_date,
                pending: pendingDueDate,
              })}
              lang={lang}
              dir={dir}
              disabled={!annualTab.permissions.can_edit || !(annualTab.capital_workspace?.working_panel.can_assign_due_date ?? annualTab.permissions.can_edit)}
              pending={pendingDueDate != null}
              calendarClassName="nx-capital-tab-calendar"
              onChange={(iso) => void assignCapitalDueDate(iso)}
            />
            {annualTab.visibility.show_working_status && annualTab.status.label_key ? (
              <div className="nx-annual-dash-status-row" data-testid="annual-tab-capital-status">
                <span className={`nx-annual-status-chip nx-annual-status-chip--${annualTab.status.color}`}>
                  {localizeSystemLabel(t, annualTab.status.label_key, annualTab.status.label_he)}
                </span>
              </div>
            ) : null}
            {showDeadline ? (
              <div className="nx-annual-dash-deadline">
                <IconCalendarSmall />
                <span>
                  {annualTab.deadline_info.is_overdue
                    ? t('clientOperations.annual.late')
                    : fillI18n(t('clientOperations.annual.daysLeftToFile'), { n: annualTab.deadline_info.days_left })}
                </span>
              </div>
            ) : null}
          </article>
          <article className="nx-annual-dash-card nx-capital-history-panel" data-testid="capital-tab-history-panel">
            <h3 className="nx-annual-dash-card-title">
              {t(annualTab.capital_workspace?.history_panel.title_key ?? 'clientOperations.annual.capitalHistory')}
            </h3>
            {(annualTab.capital_workspace?.history_panel.entries ?? []).length === 0 ? (
              <p className="nx-annual-dash">{t(annualTab.capital_workspace?.history_panel.empty_state_key ?? 'clientOperations.annual.capitalHistoryEmpty')}</p>
            ) : (
              <ul className="nx-capital-history-list">
                {(annualTab.capital_workspace?.history_panel.entries ?? []).map((entry) => {
                  const open = historyOpenKey === entry.folder_key;
                  return (
                    <li key={entry.folder_key} className={`nx-capital-history-item${open ? ' is-open' : ''}`}>
                      <div className="nx-capital-history-row">
                        <strong>{fillI18n(t(entry.folder_label_key), { n: entry.sequence_no })}</strong>
                        <span className="nx-annual-status-chip nx-annual-status-chip--neutral">
                          {t('clientOperations.annual.filedStatus')}
                        </span>
                        <span data-testid={`capital-history-submitted-${entry.sequence_no}`}>
                          {entry.submitted_on || '—'}
                        </span>
                        <button
                          type="button"
                          className="nx-annual-folder-btn"
                          data-testid={`annual-tab-capital-folder-${entry.sequence_no}`}
                          data-instance-id={entry.instance_id}
                          aria-expanded={open}
                          onClick={() => setHistoryOpenKey(open ? null : entry.folder_key)}
                          title={t('clientOperations.annual.expandFolder')}
                        >
                          <IconFolder />
                        </button>
                      </div>
                      {open ? (
                        <ul className="nx-annual-logical-folder-files">
                          {entry.files.length === 0 ? (
                            <li className="nx-annual-dash">{t('clientOperations.annual.folderEmpty')}</li>
                          ) : (
                            entry.files.map((file) => (
                              <li key={file.file_asset_id} className="nx-annual-logical-folder-file">
                                <span className="nx-annual-folder-file-name">
                                  {file.file_name || t(file.source_kind_label_key)}
                                </span>
                                {(file.actions?.can_preview ?? file.can_open) ? (
                                  <button
                                    type="button"
                                    className="nx-annual-folder-file-preview"
                                    disabled={busy || !(file.actions?.can_open ?? file.can_open)}
                                    onClick={() => void openFile(file.file_asset_id)}
                                  >
                                    {t('clientOperations.annual.previewFile')}
                                  </button>
                                ) : null}
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </div>
      ) : (
      <div className={`nx-annual-dashboard${showMissingProblem ? '' : ' is-single'}`}>
        <article className="nx-annual-dash-card nx-annual-dash-card--status" aria-labelledby="nx-annual-dash-status-heading">
          <h3 id="nx-annual-dash-status-heading" className="nx-annual-dash-card-title">
            {localizeSystemLabel(t, annualTab.status_card_title_key, annualTab.status_card_title_he)}
          </h3>
          {filingStatus && isAnnualBoard ? (
            <p
              className={`nx-annual-filing-status${filingStatus.filed ? ' is-filed' : ''}${yearView?.filing_tone ? ` is-${yearView.filing_tone}` : ''}`}
              data-testid="annual-tab-filing-status"
            >
              {t(filingStatus.label_key)}
              {filingStatus.submitted_on ? ` · ${filingStatus.submitted_on}` : ''}
            </p>
          ) : yearContentPending ? (
            <p className="nx-annual-year-loading" role="status" data-testid="annual-tab-filing-status-loading">
              {t('clientOperations.annual.yearContentLoading')}
            </p>
          ) : !isAnnualBoard && annualTab.status.label_he ? (
            <div className="nx-annual-dash-status-row" data-testid="annual-tab-capital-status">
              <span className={`nx-annual-status-chip nx-annual-status-chip--${annualTab.status.color}`}>
                {localizeSystemLabel(t, annualTab.status.label_key, annualTab.status.label_he)}
              </span>
            </div>
          ) : null}
          {showFiledConfirmation && filedConfirmation ? (
            <div className="nx-annual-filed-confirm" data-testid="annual-tab-filed-confirmation">
              <p>{t(filedConfirmation.label_key)}</p>
              {filedConfirmation.submitted_on ? (
                <p data-testid="annual-tab-actual-submitted-on">{filedConfirmation.submitted_on}</p>
              ) : null}
              {filedConfirmation.archive_folder_key ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  data-testid="annual-tab-open-archive"
                  onClick={() => setArchiveOpenKey(filedConfirmation.archive_folder_key ?? null)}
                >
                  {t(filedConfirmation.open_archive_label_key)}
                </button>
              ) : null}
            </div>
          ) : null}
          {showReadiness && documentReadiness ? (
          <p
            className="nx-annual-readiness"
            data-testid="annual-tab-document-readiness"
          >
            <span
              className={`nx-annual-dash-dot nx-annual-dash-dot--${documentReadiness.color}`}
              aria-hidden
            />
            <span>
              {t('clientOperations.annual.documentReadiness')}:{' '}
              {localizeSystemLabel(
                t,
                documentReadiness.label_key,
                documentReadiness.label_he,
              )}
            </span>
          </p>
          ) : null}
          {showMissingProblem && annualTab.risk_indicator.label_he ? (
            <p className="nx-annual-dash-risk">{localizeSystemLabel(t, annualTab.risk_indicator.label_key, annualTab.risk_indicator.label_he)}</p>
          ) : null}
          {showDeadline ? (
          <div className="nx-annual-dash-deadline">
            <IconCalendarSmall />
            <span>
              {(yearView?.deadline_info ?? annualTab.deadline_info).is_overdue
                ? t('clientOperations.annual.late')
                : fillI18n(t('clientOperations.annual.daysLeftToFile'), { n: (yearView?.deadline_info ?? annualTab.deadline_info).days_left })}
            </span>
          </div>
          ) : null}
        </article>
        {showMissingProblem ? (
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
              {missingRows.length === 0 ? (
                <option value="none">{t('clientOperations.annual.noMissingDocuments')}</option>
              ) : (
                missingRows.map((row) => (
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
            aria-valuenow={completionPercent}
            aria-label={t('clientOperations.annual.completeDocuments')}
          >
            <div
              className={`nx-annual-dash-progress-fill nx-annual-dash-progress-fill--${documentReadiness?.color ?? 'yellow'}`}
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </article>
        ) : null}
      </div>
      )}

      {showChecklist ? (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="nx-annual-card-title nx-annual-documents-year-heading" data-testid="annual-tab-documents-year-heading">
              {isAnnualBoard && displayedYear != null
                ? fillI18n(
                    t(
                      yearView?.documents_year_heading?.label_key ??
                        annualTab.documents_year_heading_label_key ??
                        'clientOperations.annual.documentsForTaxYear',
                    ),
                    { year: displayedYear },
                  )
                : localizeSystemLabel(t, activeDocuments.card_title_key, activeDocuments.card_title_he)}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {activeDocuments.add_custom_enabled ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt(t('clientOperations.annual.documentName'));
                    if (name != null && name.trim()) {
                      void postCmd('add_annual_document_row', {
                        document_name_he: name.trim(),
                        ...(displayedYear != null ? { tax_year: displayedYear } : {}),
                      });
                    }
                  }}
                >
                  {localizeSystemLabel(
                    t,
                    activeDocuments.add_custom_label_key,
                    activeDocuments.add_custom_label_he,
                  )}
                </button>
              ) : null}
            </div>
          </div>
          {activeDocuments.summary ? (
            <div className="nx-annual-summary-bar" role="status">
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.totalDocuments')}</span>
                <span className="nx-annual-summary-value">{activeDocuments.summary.total_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.receivedCount')}</span>
                <span className="nx-annual-summary-value">{activeDocuments.summary.received_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.annual.missingCount')}</span>
                <span className="nx-annual-summary-value">{activeDocuments.summary.missing_count}</span>
              </span>
              <span className="nx-annual-summary-sep" aria-hidden />
              <span className="nx-annual-summary-item">
                <span className="nx-annual-summary-label">{t('clientOperations.fees.lastUpdated')}</span>
                <span className="nx-annual-summary-value nx-annual-summary-value--muted">{activeDocuments.summary.updated_display_he}</span>
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
                        : localizeSystemLabel(t, activeDocuments.column_header_keys?.[idx], h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeDocuments.rows.length === 0 ? (
                  <tr>
                    <td colSpan={docHeaders.length} className="nx-annual-empty-cell">
                      {localizeSystemLabel(
                        t,
                        activeDocuments.empty_state_key,
                        activeDocuments.empty_state_he,
                      )}
                    </td>
                  </tr>
                ) : (
                  activeDocuments.rows.map((row) => (
                    <DocumentRow
                      key={row.row_id}
                      row={row}
                      capital={!isAnnualBoard}
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
      </div>

      <div
        className={`nx-annual-lower${
          annualTab.visibility.show_submissions && annualTab.visibility.show_notes ? '' : ' is-single'
        }`}
      >
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
        ) : null}

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

      <AnnualArchiveFolders
        annualTab={annualTab}
        busy={busy}
        forcedOpenKey={archiveOpenKey}
        onOpenFile={(fileAssetId) => void openFile(fileAssetId)}
      />

      {submissionDlg ? (
        <SubmissionDialog
          state={submissionDlg}
          busy={busy}
          defaultTaxYear={annualTab.current_tax_year ?? annualTab.working_tax_year}
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
  capital,
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
  capital: boolean;
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
        <span className="nx-annual-received-cell">
          {capital && row.receipt_mark === 'cyan_check' ? (
            <span className="nx-annual-received-check" aria-hidden>
              ✓
            </span>
          ) : null}
          <input type="checkbox" checked={row.received} disabled={!row.actions.can_toggle_received || busy} onChange={onToggle} />
        </span>
      </td>
      <td className="nx-annual-td nx-annual-td--doc-name">
        <div className="nx-annual-doc-name-row">
          <span className="nx-annual-doc-name">{annualDocLabel(t, row)}</span>
          {row.receipt_hint_key ? (
            <span className="nx-capital-receipt-hint">{t(row.receipt_hint_key)}</span>
          ) : null}
          {row.description_he ? (
            <span
              className="nx-annual-doc-info"
              aria-label={localizeSystemLabel(t, row.description_key, row.description_he)}
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
        {statusBadgeClass(row, capital) ? (
          <span className={statusBadgeClass(row, capital)}>
            {localizeSystemLabel(t, row.status_label_key, row.status_label_he)}
          </span>
        ) : (
          <span className="nx-annual-dash">—</span>
        )}
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

function AnnualArchiveFolders({
  annualTab,
  busy,
  forcedOpenKey,
  onOpenFile,
}: {
  annualTab: AnnualTabModel;
  busy: boolean;
  forcedOpenKey?: string | null;
  onOpenFile: (fileAssetId: string) => void;
}) {
  const { t } = useI18n();
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!forcedOpenKey) return;
    setOpenKeys((prev) => ({ ...prev, [forcedOpenKey]: true }));
  }, [forcedOpenKey]);
  const yearFolders = annualTab.year_folders ?? [];
  const showLegacyCapitalFolders = annualTab.visibility.show_legacy_capital_folders === true;
  const capitalFolders = showLegacyCapitalFolders ? annualTab.capital_folders ?? [] : [];
  useEffect(() => {
    if (capitalFolders.length === 0) return;
    setOpenKeys((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const folder of capitalFolders) {
        if (next[folder.folder_key] === undefined) {
          next[folder.folder_key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [capitalFolders]);
  if (yearFolders.length === 0 && capitalFolders.length === 0) return null;

  const toggle = (key: string) => {
    setOpenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section className="nx-annual-logical-folders nx-annual-logical-folders--archive" data-testid="annual-tab-logical-folders">
      {yearFolders.length > 0 ? (
        <div>
          <h3 className="nx-annual-card-title">{t('clientOperations.annual.yearFolders')}</h3>
          <ul className="nx-annual-logical-folder-list">
            {yearFolders.map((folder) => {
              const open = Boolean(openKeys[folder.folder_key]);
              return (
                <li key={folder.folder_key} className={`nx-annual-logical-folder${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="nx-annual-logical-folder-head"
                    aria-expanded={open}
                    onClick={() => toggle(folder.folder_key)}
                    data-testid={`annual-tab-year-folder-${folder.tax_year}`}
                  >
                    <IconFolder />
                    <strong>{folder.label}</strong>
                    <span>{t('clientOperations.annual.filedStatus')}</span>
                  </button>
                  {open ? (
                    <ul className="nx-annual-logical-folder-files">
                      {folder.files.length === 0 ? (
                        <li className="nx-annual-dash">{t('clientOperations.annual.folderEmpty')}</li>
                      ) : (
                        folder.files.map((file) => (
                          <li key={file.file_asset_id} className="nx-annual-logical-folder-file">
                            <span className="nx-annual-folder-file-name">
                              {file.file_name || t(file.source_kind_label_key)}
                            </span>
                            <span className="nx-annual-folder-file-type">
                              {file.type_label || t(file.source_kind_label_key)}
                            </span>
                            <span className="nx-annual-folder-file-date">{file.uploaded_on || folder.submitted_on}</span>
                            {(file.actions?.can_preview ?? file.can_open) ? (
                              <button
                                type="button"
                                className="nx-annual-folder-file-preview"
                                disabled={busy || !(file.actions?.can_open ?? file.can_open)}
                                onClick={() => onOpenFile(file.file_asset_id)}
                              >
                                {t('clientOperations.annual.previewFile')}
                              </button>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {capitalFolders.length > 0 ? (
        <div>
          <h3 className="nx-annual-card-title">{t('clientOperations.annual.capitalFolders')}</h3>
          <ul className="nx-annual-logical-folder-list">
            {capitalFolders.map((folder) => {
              const open = Boolean(openKeys[folder.folder_key]);
              return (
                <li key={folder.folder_key} className={`nx-annual-logical-folder${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="nx-annual-logical-folder-head"
                    aria-expanded={open}
                    data-instance-id={folder.instance_id}
                    data-testid={`annual-tab-capital-folder-${folder.sequence_no}`}
                    onClick={() => toggle(folder.folder_key)}
                  >
                    <IconFolder />
                    <strong>{fillI18n(t(folder.folder_label_key), { n: folder.sequence_no })}</strong>
                    <span>
                      {folder.filed ? t('clientOperations.annual.filedStatus') : t('clientOperations.annual.notFiledStatus')}
                    </span>
                  </button>
                  {open ? (
                    <ul className="nx-annual-logical-folder-files">
                      {folder.files.length === 0 ? (
                        <li className="nx-annual-dash">{t('clientOperations.annual.folderEmpty')}</li>
                      ) : (
                        folder.files.map((file) => (
                          <li key={file.file_asset_id} className="nx-annual-logical-folder-file">
                            <span className="nx-annual-folder-file-name">
                              {file.file_name || t(file.source_kind_label_key)}
                            </span>
                            <span className="nx-annual-folder-file-type">
                              {file.type_label || t(file.source_kind_label_key)}
                            </span>
                            <span className="nx-annual-folder-file-date">{file.uploaded_on || folder.submitted_on || '—'}</span>
                            {(file.actions?.can_preview ?? file.can_open) ? (
                              <button
                                type="button"
                                className="nx-annual-folder-file-preview"
                                disabled={busy || !(file.actions?.can_open ?? file.can_open)}
                                onClick={() => onOpenFile(file.file_asset_id)}
                              >
                                {t('clientOperations.annual.previewFile')}
                              </button>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SubmissionDialog({
  state,
  busy,
  defaultTaxYear,
  onClose,
  onSave,
}: {
  state: NonNullable<SubmissionDialogState>;
  busy: boolean;
  defaultTaxYear?: number;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const isEdit = state.mode === 'edit';
  const r = isEdit ? state.row : null;
  const [taxYear, setTaxYear] = useState(isEdit ? String(r!.tax_year) : String(defaultTaxYear ?? ''));
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
