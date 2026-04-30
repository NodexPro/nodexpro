import { useMemo, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsPayrollCommands } from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type { PayrollFieldModel, PayrollSectionModel, PayrollTabModel } from './payroll-tab-types';
import '../styles/nx-payroll-tab.css';

function IconPencil() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
    </svg>
  );
}

function sectionIconHe(sectionKey: string): string {
  if (sectionKey === 'employer_details') return '🏢';
  if (sectionKey === 'deductions') return '🧾';
  if (sectionKey === 'bank') return '🏦';
  if (sectionKey === 'reporting') return '📅';
  if (sectionKey === 'process') return '🧩';
  if (sectionKey === 'complexity') return '⚙️';
  if (sectionKey === 'employees') return '👥';
  return '•';
}

function lineIconHe(label: string): string {
  if (label.includes('דואר')) return '✉️';
  if (label.includes('טלפון')) return '☎️';
  if (label.includes('תאריך') || label.includes('מועד') || label.includes('טופס')) return '📅';
  if (label.includes('בנק') || label.includes('חשבון') || label.includes('סניף')) return '🏦';
  if (label.includes('עובדים')) return '👥';
  if (label.includes('מס')) return '🔢';
  return '▫';
}

function chartBarsFromTrend(raw: string | null | undefined): { heights: number[]; hasData: boolean } {
  const txt = (raw ?? '').trim();
  const nums = txt.match(/\d+(?:\.\d+)?/g)?.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0) ?? [];
  if (nums.length === 0) {
    return { heights: [24, 36, 30, 42, 34], hasData: false };
  }
  const values = nums.slice(0, 7);
  const max = Math.max(1, ...values);
  return {
    heights: values.map((v) => Math.max(16, Math.min(100, Math.round((v / max) * 100)))),
    hasData: true,
  };
}

function PayrollFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PayrollFieldModel;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  if (field.type === 'textarea') {
    return (
      <textarea
        className="nx-fees-inp"
        rows={3}
        value={value == null ? '' : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'select' && field.options) {
    return (
      <select className="nx-fees-inp" value={value == null ? '' : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label_he}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'radio' && field.options) {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        {field.options.map((o) => (
          <label key={o.value} style={{ display: 'inline-flex', gap: 6 }}>
            <input type="radio" checked={String(value ?? '') === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
            <span>{o.label_he}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      className="nx-fees-inp"
      value={value == null ? '' : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ClientPayrollTab({
  clientId,
  payrollTab,
  onCaseUpdated,
}: {
  clientId: string;
  payrollTab: PayrollTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [editSection, setEditSection] = useState<PayrollSectionModel | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canEdit = payrollTab.permissions.can_edit;
  const sectionByKey = useMemo(() => {
    const m = new Map<string, PayrollSectionModel>();
    for (const s of payrollTab.sections) m.set(s.section_key, s);
    return m;
  }, [payrollTab.sections]);

  const openSection = (s: PayrollSectionModel) => {
    if (!s.edit_action_key || !canEdit) return;
    const d: Record<string, unknown> = {};
    for (const f of s.edit_fields) d[f.key] = f.value;
    setDraft(d);
    setEditSection(s);
    setErr('');
  };

  const saveSection = async () => {
    if (!editSection?.edit_action_key) return;
    setBusy(true);
    setErr('');
    try {
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsPayrollCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: editSection.edit_action_key,
          expected_version: payrollTab.read_model_version,
          payload: draft,
        }),
      });
      onCaseUpdated(out);
      setEditSection(null);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const employeesSection = sectionByKey.get('employees') ?? null;
  const processSection = sectionByKey.get('process') ?? null;
  const complexitySection = sectionByKey.get('complexity') ?? null;
  const employerSection = sectionByKey.get('employer_details') ?? null;
  const reportingSection = sectionByKey.get('reporting') ?? null;
  const sectionsForColumn = (keys: string[]) =>
    keys.map((k) => sectionByKey.get(k)).filter((s): s is PayrollSectionModel => Boolean(s));

  const employeesCountDisplay =
    employeesSection?.lines.find((ln) => ln.label_he === 'מספר עובדים')?.value_he ?? '—';
  const payrollSoftwareDisplay =
    processSection?.lines.find((ln) => ln.label_he === 'באיזו תוכנה מחשבים שכר')?.value_he ?? '—';
  const employeesTrendDisplay =
    employeesSection?.lines.find((ln) => ln.label_he === 'גרף שינוי עובדים')?.value_he ?? '—';

  const renderReportingBody = (s: PayrollSectionModel) => {
    const frequencyLine = s.lines.find((ln) => ln.label_he === 'דיווח למס הכנסה');
    const formLines = s.lines.filter((ln) => ln.label_he.startsWith('דיווח טופס'));
    return (
      <div className="nx-payroll-reminders">
        {frequencyLine ? (
          <div className="nx-payroll-reminders-frequency">
            דיווח למס הכנסה: {frequencyLine.value_he ?? '—'}
          </div>
        ) : null}
        {formLines.map((ln) => (
          <div key={ln.label_he} className="nx-payroll-reminder-row">
            <span className="nx-payroll-reminder-form">{ln.label_he.replace('דיווח ', '')}</span>
            <span className="nx-payroll-reminder-value">{ln.value_he}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderEmployeesBody = (s: PayrollSectionModel) => {
    const countLine = s.lines.find((ln) => ln.label_he === 'מספר עובדים');
    return (
      <div className="nx-payroll-employees">
        <div className="nx-payroll-employees-count-wrap">
          <div className="nx-payroll-employees-count-label">מספר עובדים</div>
          <div className="nx-payroll-employees-count-value">{countLine?.value_he ?? '—'}</div>
        </div>
      </div>
    );
  };

  const renderCard = (s: PayrollSectionModel) => {
    const allowEdit = canEdit && s.edit_action_key;
    return (
      <section
        key={s.section_key}
        className={`nx-payroll-card nx-payroll-card--${s.section_key} ${payrollTab.status.has_employees ? '' : 'nx-payroll-card--inactive'}`}
      >
        <div className="nx-payroll-card-head">
          <h3 className="nx-payroll-card-title">
            <span className="nx-payroll-card-title-icon" aria-hidden>
              {sectionIconHe(s.section_key)}
            </span>
            {s.section_title_he}
          </h3>
          {allowEdit ? (
            <button type="button" className="nx-fees-pencil-btn" onClick={() => openSection(s)} aria-label="עריכה" title="עריכה">
              <IconPencil />
            </button>
          ) : null}
        </div>
        <div className="nx-payroll-card-body">
          {s.section_key === 'reporting'
            ? renderReportingBody(s)
            : s.section_key === 'employees'
              ? renderEmployeesBody(s)
              : (
                <div className="nx-payroll-kv">
                  {s.lines.map((ln, i) => (
                    <div key={i} className="nx-payroll-kv-row">
                      <span className="nx-payroll-kv-label">
                        <span className="nx-payroll-kv-icon" aria-hidden>
                          {lineIconHe(ln.label_he)}
                        </span>
                        {ln.label_he}
                      </span>
                      <span className="nx-payroll-kv-value">{ln.value_he}</span>
                    </div>
                  ))}
                </div>
              )}
        </div>
      </section>
    );
  };

  const renderTurnoverCard = () => {
    const bars = chartBarsFromTrend(employeesTrendDisplay === '—' ? null : employeesTrendDisplay);
    return (
      <section className={`nx-payroll-card nx-payroll-card--turnover ${payrollTab.status.has_employees ? '' : 'nx-payroll-card--inactive'}`}>
        <div className="nx-payroll-card-head">
          <h3 className="nx-payroll-card-title">
            <span className="nx-payroll-card-title-icon" aria-hidden>
              📊
            </span>
            גרף תחלופת עובדים
          </h3>
        </div>
        <div className="nx-payroll-turnover-chart">
          {bars.heights.map((h, i) => (
            <div key={i} className="nx-payroll-turnover-bar-wrap">
              <span
                className={`nx-payroll-turnover-bar ${bars.hasData ? '' : 'nx-payroll-turnover-bar--placeholder'}`}
                style={{ height: `${h}%` }}
              />
            </div>
          ))}
        </div>
        {!bars.hasData ? <div className="nx-payroll-turnover-empty">גרף תחלופת עובדים יוצג כאן</div> : null}
      </section>
    );
  };

  return (
    <div className="nx-payroll-tab-root" style={{ direction: 'rtl' }}>
      <div className="nx-payroll-tab-shell">
        <div className="nx-payroll-root">
          <div className="nx-payroll-meta-strip">
            <div className="nx-payroll-meta-item">
              <span className="nx-payroll-meta-label">סטטוס שכר</span>
              <span className="nx-payroll-meta-value">{payrollTab.status.has_employees ? 'פעיל' : 'לא פעיל'}</span>
            </div>
            <div className="nx-payroll-meta-item">
              <span className="nx-payroll-meta-label">מספר עובדים</span>
              <span className="nx-payroll-meta-value">{employeesCountDisplay}</span>
            </div>
            <div className="nx-payroll-meta-item">
              <span className="nx-payroll-meta-label">תוכנת שכר</span>
              <span className="nx-payroll-meta-value">{payrollSoftwareDisplay}</span>
            </div>
            <div className="nx-payroll-meta-item">
              <span className="nx-payroll-meta-label">עודכן לאחרונה</span>
              <span className="nx-payroll-meta-value">—</span>
            </div>
            {!payrollTab.status.has_employees ? <span className="nx-payroll-status-badge">לא פעיל</span> : null}
          </div>

          <div className="nx-payroll-grid">
            <div className="nx-payroll-col nx-payroll-col--top-left">
              {employerSection ? renderCard(employerSection) : null}
            </div>
            <div className="nx-payroll-col nx-payroll-col--top-right">
              {reportingSection ? renderCard(reportingSection) : null}
            </div>
            <div className="nx-payroll-col nx-payroll-col--bottom-left">
              {sectionsForColumn(['deductions', 'bank']).map((s) => renderCard(s))}
            </div>
            <div className="nx-payroll-col nx-payroll-col--process-wide">
              {processSection ? renderCard(processSection) : null}
            </div>
            <div className="nx-payroll-col nx-payroll-col--row-employees">
              {employeesSection ? renderCard(employeesSection) : null}
            </div>
            <div className="nx-payroll-col nx-payroll-col--row-turnover">
              {renderTurnoverCard()}
            </div>
            <div className="nx-payroll-col nx-payroll-col--row-complexity">
              {complexitySection ? renderCard(complexitySection) : null}
            </div>
          </div>

          {err ? <p className="nx-fees-save-error">{err}</p> : null}
        </div>
      </div>

      {editSection ? (
        <div className="nx-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && setEditSection(null)}>
          <div className="nx-modal nx-fees-editor-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap">
                <h2 className="nx-modal-title">{editSection.section_title_he}</h2>
              </div>
              <button type="button" className="nx-modal-close" onClick={() => setEditSection(null)} disabled={busy}>
                ×
              </button>
            </div>
            <div className="nx-modal-body nx-fees-editor-modal-body">
              {editSection.edit_fields.map((f) => (
                <div key={f.key} className="client-field">
                  <div className="client-field-label">{f.label_he}</div>
                  <PayrollFieldInput field={f} value={draft[f.key]} disabled={busy} onChange={(v) => setDraft((x) => ({ ...x, [f.key]: v }))} />
                </div>
              ))}
              {err ? <p className="nx-fees-save-error">{err}</p> : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={() => setEditSection(null)}>
                סגירה
              </button>
              <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={() => void saveSection()}>
                {busy ? 'שומר…' : 'שמירה'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
