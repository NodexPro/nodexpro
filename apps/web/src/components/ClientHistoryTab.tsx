import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiJson, apiPostDownload, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsHistoryCommands, moduleClientOperationsHistoryExport } from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type { ClientHistorySectionKey, ClientHistoryTabModel } from './client-history-tab-types';
import '../styles/nx-fees-tab.css';
import '../styles/nx-modal.css';
import '../styles/nx-history-tab.css';

/** Two-column rows: equal width + gap (see .nx-history-section-pair-row) */
const HISTORY_SECTION_PAIR_ROWS: ClientHistorySectionKey[][] = [
  ['client_profile', 'taxes'],
  ['accounting', 'fees'],
  ['payroll', 'annual'],
  ['documents', 'history_system'],
];

function HistorySectionOverviewCard({
  sec,
  emptyStateHe,
  busy,
  onOpenSection,
}: {
  sec: ClientHistoryTabModel['sections'][number];
  emptyStateHe: string;
  busy: boolean;
  onOpenSection: (key: ClientHistorySectionKey) => void;
}) {
  return (
    <article className="nx-history-section-card">
      <div className="nx-history-section-head">
        <h3 className="nx-fees-card-title nx-fees-card-title--strict">{sec.title_he}</h3>
        <span className="nx-history-count-badge">{`${sec.total_events_in_last_12_months} אירועים`}</span>
      </div>
      {sec.latest_events.length === 0 ? (
        <p className="nx-history-section-empty">{emptyStateHe}</p>
      ) : (
        <div className="nx-history-events">
          {sec.latest_events.map((ev) => (
            <div key={ev.event_id} className="nx-history-event">
              <p className="nx-history-event-summary">{ev.summary_he}</p>
              <p className="nx-history-event-meta">
                {ev.occurred_display_he}
                {ev.actor_display_name ? ` · ${ev.actor_display_name}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
      {sec.can_open ? (
        <div className="nx-history-section-foot">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void onOpenSection(sec.section_key)}>
            כל הפעולות בסקציה
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
        setExportOkHe('הקובץ הורד — ניתן לפתוח אותו באקסל.');
      } else {
        setExportOkHe('דוח ה-PDF הורד למחשב.');
      }
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setExportBusy(false);
    }
  };

  const pairedKeys = new Set(HISTORY_SECTION_PAIR_ROWS.flat());
  const restSections = historyTab.sections.filter((s) => !pairedKeys.has(s.section_key));

  return (
    <div className="nx-history-root">
      <header className="nx-history-hero">
        <div className="nx-history-hero-top">
          <div>
            <h2 className="nx-history-title">{historyTab.ui.title_he}</h2>
            <p className="nx-history-retention">{historyTab.ui.retention_notice_he}</p>
            <p className="nx-history-todo">{historyTab.ui.retention_archival_todo_he}</p>
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
                  {exportBusy ? 'מכין קובץ…' : 'ייצוא לאקסל'}
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={exportBusy}
                  onClick={() => void downloadReport('pdf', 'overview')}
                >
                  הפקת דוח PDF
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="nx-history-period-bar" aria-label="סינון תקופה לפתיחת סקציה">
          <label className="nx-history-period-field">
            <span>מ-</span>
            <input type="date" className="nx-fees-inp" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="nx-history-period-field">
            <span>עד</span>
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
                      {open.title_he}
                    </h2>
                    <p className="nx-history-modal-meta">
                      {`סה\u05F4כ באירועים מסוננים: ${open.total_count}`}
                      {open.events.length < open.total_count ? ` · מוצגות עד ${open.events.length}` : null}
                    </p>
                  </div>
                  <button type="button" className="nx-modal-close" aria-label="סגירה" disabled={busy} onClick={closeSectionModal}>
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
                      <p className="nx-history-event-summary">{ev.summary_he}</p>
                      <p className="nx-history-event-meta">
                        {ev.occurred_display_he}
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
                        {exportBusy ? 'מכין קובץ…' : 'ייצוא לאקסל'}
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                        disabled={exportBusy}
                        onClick={() => void downloadReport('pdf', 'detail')}
                      >
                        הפקת דוח PDF
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={closeSectionModal}>
                    סגירה
                  </button>
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
                  emptyStateHe={historyTab.ui.empty_state_he}
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
            emptyStateHe={historyTab.ui.empty_state_he}
            busy={busy}
            onOpenSection={(key) => void openSection(key)}
          />
        ))}
      </div>
    </div>
  );
}
