import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiJson, apiPostDownload, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsHistoryCommands, moduleClientOperationsHistoryExport } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { fillI18n, localizeFilledLabel, localizeSystemLabel } from '../lib/co-display-label.pure';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type { ClientHistorySectionKey, ClientHistoryTabModel } from './client-history-tab-types';
import '../styles/nx-fees-tab.css';
import '../styles/nx-modal.css';
import '../styles/nx-history-tab.css';
import '../styles/nx-workspace-history-tab.css';

/** Two-column rows: equal width + gap (see .nx-history-section-pair-row) */
const HISTORY_SECTION_PAIR_ROWS: ClientHistorySectionKey[][] = [
  ['client_profile', 'taxes'],
  ['accounting', 'fees'],
  ['payroll', 'annual'],
  ['documents', 'history_system'],
];

const HISTORY_RETENTION_MONTHS = 12;

function formatHistoryOccurredAt(iso: string, lang: string, fallbackHe: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallbackHe || iso;
  try {
    return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return fallbackHe || iso;
  }
}

function historyEventSummary(
  t: (key: string) => string,
  ev: {
    summary_he: string;
    summary_key?: string;
    summary_params?: Record<string, string | number>;
    summary_param_keys?: Record<string, string>;
  },
): string {
  if (!ev.summary_key) return ev.summary_he;
  return localizeFilledLabel(t, ev.summary_key, ev.summary_he, ev.summary_params, ev.summary_param_keys);
}

function HistorySectionOverviewCard({
  sec,
  emptyState,
  busy,
  onOpenSection,
}: {
  sec: ClientHistoryTabModel['sections'][number];
  emptyState: string;
  busy: boolean;
  onOpenSection: (key: ClientHistorySectionKey) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <article className="nx-history-section-card">
      <div className="nx-history-section-head">
        <h3 className="nx-fees-card-title nx-fees-card-title--strict">
          {localizeSystemLabel(t, sec.title_key, sec.title_he)}
        </h3>
        <span className="nx-history-count-badge">
          {fillI18n(t('clientOperations.history.eventsCount'), { count: sec.total_events_in_last_12_months })}
        </span>
      </div>
      {sec.latest_events.length === 0 ? (
        <p className="nx-history-section-empty">{emptyState}</p>
      ) : (
        <div className="nx-history-events">
          {sec.latest_events.map((ev) => (
            <div key={ev.event_id} className="nx-history-event">
              <p className="nx-history-event-summary">{historyEventSummary(t, ev)}</p>
              <p className="nx-history-event-meta">
                {formatHistoryOccurredAt(ev.occurred_at, lang, ev.occurred_display_he)}
                {ev.actor_display_name ? ` · ${ev.actor_display_name}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
      {sec.can_open ? (
        <div className="nx-history-section-foot">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void onOpenSection(sec.section_key)}>
            {t('clientOperations.history.allInSection')}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ClientHistoryTab({
  clientId,
  historyTab,
  onCaseUpdated,
}: {
  clientId: string;
  historyTab: ClientHistoryTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [err, setErr] = useState('');
  const [exportOkHe, setExportOkHe] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const open = historyTab.open_section;

  const runCommand = async (type: 'open_history_section' | 'close_history_section', payload?: Record<string, unknown>) => {
    setBusy(true);
    setErr('');
    try {
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsHistoryCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({ type, payload: payload ?? {} }),
      });
      onCaseUpdated(out);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closeSectionModal = () => {
    setErr('');
    setExportOkHe('');
    void runCommand('close_history_section');
  };

  const openSection = async (section_key: ClientHistorySectionKey) => {
    const payload: Record<string, unknown> = { section_key };
    if (fromDate.trim()) payload.from_date = fromDate.trim();
    if (toDate.trim()) payload.to_date = toDate.trim();
    await runCommand('open_history_section', payload);
  };

  /** Human-readable report from server (Excel CSV or PDF TODO); no client-side assembly of rows. */
  const downloadReport = async (format: 'pdf' | 'excel', mode: 'overview' | 'detail') => {
    if (!historyTab.permissions.can_export) return;
    setExportBusy(true);
    setErr('');
    setExportOkHe('');
    try {
      const body: Record<string, unknown> = { format };
      if (mode === 'detail' && open) {
        body.section_key = open.section_key;
        body.from_date = open.range.from_date;
        body.to_date = open.range.to_date;
      } else {
        if (fromDate.trim()) body.from_date = fromDate.trim();
        if (toDate.trim()) body.to_date = toDate.trim();
      }
      const defaultName = format === 'excel' ? 'history-report.csv' : 'history-report.pdf';
      await apiPostDownload(moduleClientOperationsHistoryExport(clientId), body, defaultName);
      if (format === 'excel') {
        setExportOkHe(t('clientOperations.history.excelDownloaded'));
      } else {
        setExportOkHe(t('clientOperations.history.pdfDownloaded'));
      }
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setExportBusy(false);
    }
  };

  const pairedKeys = new Set(HISTORY_SECTION_PAIR_ROWS.flat());
  const restSections = historyTab.sections.filter((s) => !pairedKeys.has(s.section_key));
  const emptyState = localizeSystemLabel(t, historyTab.ui.empty_state_key, historyTab.ui.empty_state_he);

  return (
    <div className="nx-history-root nx-ws-history">
      <header className="nx-history-hero">
        <div className="nx-history-hero-top">
          <div>
            <h2 className="nx-history-title">{localizeSystemLabel(t, historyTab.ui.title_key, historyTab.ui.title_he)}</h2>
            <p className="nx-history-retention">
              {fillI18n(localizeSystemLabel(t, historyTab.ui.retention_notice_key, historyTab.ui.retention_notice_he), {
                n: HISTORY_RETENTION_MONTHS,
              })}
            </p>
            <p className="nx-history-todo">
              {localizeSystemLabel(t, historyTab.ui.retention_archival_todo_key, historyTab.ui.retention_archival_todo_he)}
            </p>
          </div>
          <div className="nx-history-hero-actions nx-history-hero-export-actions">
            {historyTab.permissions.can_export ? (
              <>
                <button
                  type="button"
                  className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                  disabled={exportBusy}
                  onClick={() => void downloadReport('excel', 'overview')}
                >
                  {exportBusy ? t('clientOperations.history.preparingFile') : t('clientOperations.history.exportExcel')}
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={exportBusy}
                  onClick={() => void downloadReport('pdf', 'overview')}
                >
                  {t('clientOperations.history.pdfReport')}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="nx-history-period-bar" aria-label={t('clientOperations.history.periodFilter')}>
          <label className="nx-history-period-field">
            <span>{t('clientOperations.history.from')}</span>
            <input type="date" className="nx-fees-inp" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="nx-history-period-field">
            <span>{t('clientOperations.history.to')}</span>
            <input type="date" className="nx-fees-inp" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
      </header>

      {open
        ? createPortal(
            <div
              className="nx-modal-overlay nx-history-section-overlay"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && !busy && closeSectionModal()}
            >
              <div
                className="nx-modal nx-fees-editor-modal nx-history-section-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="nx-history-section-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="nx-modal-header">
                  <div className="nx-modal-title-wrap">
                    <h2 id="nx-history-section-modal-title" className="nx-modal-title">
                      {localizeSystemLabel(t, open.title_key, open.title_he)}
                    </h2>
                    <p className="nx-history-modal-meta">
                      {fillI18n(t('clientOperations.history.filteredTotal'), { count: open.total_count })}
                      {open.events.length < open.total_count
                        ? fillI18n(t('clientOperations.history.showingUpTo'), { count: open.events.length })
                        : null}
                    </p>
                  </div>
                  <button type="button" className="nx-modal-close" aria-label={t('clientOperations.close')} disabled={busy} onClick={closeSectionModal}>
                    ×
                  </button>
                </div>
                <div className="nx-modal-body nx-fees-editor-modal-body nx-history-modal-events">
                  {err ? (
                    <div className="nx-history-modal-alert nx-history-modal-alert--error" role="alert">
                      {err}
                    </div>
                  ) : null}
                  {exportOkHe ? (
                    <div className="nx-history-modal-alert nx-history-modal-alert--ok" role="status">
                      {exportOkHe}
                    </div>
                  ) : null}
                  {open.events.map((ev) => (
                    <div key={ev.event_id} className="nx-history-event">
                      <p className="nx-history-event-summary">{historyEventSummary(t, ev)}</p>
                      <p className="nx-history-event-meta">
                        {formatHistoryOccurredAt(ev.occurred_at, lang, ev.occurred_display_he)}
                        {ev.actor_display_name ? ` · ${ev.actor_display_name}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="nx-modal-footer nx-tax-nested-modal-footer nx-history-modal-export-footer">
                  {historyTab.permissions.can_export ? (
                    <>
                      <button
                        type="button"
                        className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                        disabled={exportBusy}
                        onClick={() => void downloadReport('excel', 'detail')}
                      >
                        {exportBusy ? t('clientOperations.history.preparingFile') : t('clientOperations.history.exportExcel')}
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                        disabled={exportBusy}
                        onClick={() => void downloadReport('pdf', 'detail')}
                      >
                        {t('clientOperations.history.pdfReport')}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {err && !open ? (
        <p className="nx-history-err" role="alert">
          {err}
        </p>
      ) : null}
      {exportOkHe && !open ? (
        <p className="nx-history-export-ok" role="status">
          {exportOkHe}
        </p>
      ) : null}

      <div className="nx-history-sections">
        {HISTORY_SECTION_PAIR_ROWS.map((keys, rowIdx) => {
          const rowSections = keys
            .map((k) => historyTab.sections.find((s) => s.section_key === k))
            .filter((s): s is ClientHistoryTabModel['sections'][number] => s != null);
          if (rowSections.length === 0) return null;
          return (
            <div key={rowIdx} className="nx-history-section-pair-row">
              {rowSections.map((sec) => (
                <HistorySectionOverviewCard
                  key={sec.section_key}
                  sec={sec}
                  emptyState={emptyState}
                  busy={busy}
                  onOpenSection={(key) => void openSection(key)}
                />
              ))}
            </div>
          );
        })}
        {restSections.map((sec) => (
          <HistorySectionOverviewCard
            key={sec.section_key}
            sec={sec}
            emptyState={emptyState}
            busy={busy}
            onOpenSection={(key) => void openSection(key)}
          />
        ))}
      </div>
    </div>
  );
}
