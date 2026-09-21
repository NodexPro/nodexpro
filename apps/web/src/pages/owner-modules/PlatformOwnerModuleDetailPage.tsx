import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../../api/client';
import { OWNER } from '../../api/endpoints';
import './nx-owner-modules.css';

type UnknownRecord = Record<string, unknown>;
type TabKey = 'pricing' | 'users' | 'reporting_calendar';

type ExtendTrialModal = {
  org_id: string;
  org_name: string;
  module_key: string;
  module_name: string;
  trial_ends_at: string | null;
};

function asRows(v: unknown): UnknownRecord[] {
  return Array.isArray(v) ? (v as UnknownRecord[]) : [];
}

function text(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Owner-facing date (presentation only). Matches Legal Control en-GB style as dd/mm/yyyy. */
function formatOwnerDate(v: unknown): string {
  const s = text(v).trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Transport formatting only — end-of-day UTC for existing expires_at contract. */
function ymdToIsoEndOfDayZ(ymd: string): string {
  const clean = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return new Date().toISOString();
  return `${clean}T23:59:59.000Z`;
}

export function PlatformOwnerModuleDetailPage() {
  const { moduleCode: rawCode } = useParams();
  const moduleCode = decodeURIComponent(rawCode ?? '').trim();
  const [searchParams, setSearchParams] = useSearchParams();

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [entitlementStatus, setEntitlementStatus] = useState('');
  const [activationStatus, setActivationStatus] = useState('');

  const [extendModal, setExtendModal] = useState<ExtendTrialModal | null>(null);
  const [extendUntilYmd, setExtendUntilYmd] = useState('');
  const [extendReason, setExtendReason] = useState('');
  const [extendError, setExtendError] = useState('');
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarEdits, setCalendarEdits] = useState<Record<string, Record<string, string>>>({});

  const tabs = asRows(aggregate?.available_detail_tabs);
  const requested = (searchParams.get('tab') as TabKey | null) ?? 'pricing';
  const activeTab: TabKey = useMemo(() => {
    const keys = tabs.map((t) => text(t.tab_key)) as TabKey[];
    if (keys.includes(requested)) return requested;
    return (keys[0] as TabKey) || 'pricing';
  }, [tabs, requested]);

  const load = useCallback(async () => {
    if (!moduleCode) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('commercial_page', String(page));
      qs.set('commercial_page_size', '20');
      if (search.trim()) qs.set('commercial_search', search.trim());
      if (entitlementStatus.trim()) qs.set('commercial_entitlement_status', entitlementStatus.trim());
      if (activationStatus.trim()) qs.set('commercial_activation_status', activationStatus.trim());
      qs.set('calendar_country', 'IL');
      qs.set('calendar_year', String(calendarYear));
      const agg = await apiJson<UnknownRecord>(`${OWNER.moduleDetail(moduleCode)}?${qs.toString()}`);
      setAggregate(agg);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, [moduleCode, page, search, entitlementStatus, activationStatus, calendarYear]);

  useEffect(() => {
    void load();
  }, [load]);

  function commercialContext(): UnknownRecord {
    return {
      page,
      page_size: 20,
      search: search.trim() || null,
      module_key: moduleCode,
      entitlement_status: entitlementStatus.trim() || null,
      activation_status: activationStatus.trim() || null,
    };
  }

  async function sendCommand(command: string, payload: UnknownRecord): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({
          command,
          payload: {
            ...payload,
            commercial_controls_context: commercialContext(),
          },
        }),
      });
      await load();
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendCalendarCommand(command: string, payload: UnknownRecord): Promise<UnknownRecord | null> {
    setBusy(true);
    setError('');
    try {
      const out = await apiJson<{
        refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord };
      }>(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({
          command,
          payload: {
            ...payload,
            owner_module_detail_code: moduleCode,
            commercial_controls_context: commercialContext(),
          },
        }),
      });
      if (out?.refreshed?.aggregate_key === 'owner_module_detail_aggregate' && out.refreshed.aggregate) {
        setAggregate(out.refreshed.aggregate);
        return out.refreshed.aggregate;
      }
      setError('Command succeeded but refreshed module aggregate was not returned.');
      return null;
    } catch (e) {
      setError(userFacingApiMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openExtendTrial(org: UnknownRecord, mod: UnknownRecord): void {
    const moduleDisplay =
      text(mod.module_name) ||
      text((aggregate?.module as UnknownRecord | undefined)?.display_name) ||
      moduleCode;
    setExtendError('');
    setExtendReason('');
    setExtendUntilYmd('');
    setExtendModal({
      org_id: text(org.org_id),
      org_name: text(org.org_name) || 'Organization',
      module_key: moduleCode,
      module_name: moduleDisplay,
      trial_ends_at: text(mod.trial_ends_at) || null,
    });
  }

  function closeExtendTrial(): void {
    if (busy) return;
    setExtendModal(null);
    setExtendError('');
    setExtendReason('');
    setExtendUntilYmd('');
  }

  async function submitExtendTrial(): Promise<void> {
    if (!extendModal) return;
    const ymd = extendUntilYmd.trim();
    const reason = extendReason.trim();
    if (!ymd || !reason) return;
    setExtendError('');
    setBusy(true);
    try {
      const out = await apiJson<{
        refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord };
      }>(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({
          command: 'extend_org_module_trial',
          payload: {
            org_id: extendModal.org_id,
            module_key: extendModal.module_key,
            expires_at: ymdToIsoEndOfDayZ(ymd),
            reason,
            owner_module_detail_code: moduleCode,
            commercial_controls_context: commercialContext(),
          },
        }),
      });
      if (out?.refreshed?.aggregate_key === 'owner_module_detail_aggregate' && out.refreshed.aggregate) {
        setAggregate(out.refreshed.aggregate);
      } else {
        setExtendError('Extend Trial succeeded but refreshed module aggregate was not returned.');
        return;
      }
      setExtendModal(null);
      setExtendReason('');
      setExtendUntilYmd('');
    } catch (e) {
      setExtendError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmitExtend = Boolean(extendUntilYmd.trim() && extendReason.trim()) && !busy;

  const module = (aggregate?.module as UnknownRecord | undefined) ?? null;
  const pricing = (aggregate?.platform_pricing as UnknownRecord | undefined) ?? null;
  const pricingRows = asRows((pricing?.table as UnknownRecord | undefined)?.rows);
  const commercial = (aggregate?.commercial_controls as UnknownRecord | undefined) ?? null;
  const orgRows = asRows(commercial?.org_rows);
  const pagination = (commercial?.pagination as UnknownRecord | undefined) ?? null;
  const reportingCalendar = (aggregate?.reporting_calendar as UnknownRecord | undefined) ?? null;
  const calendarColumns = asRows(reportingCalendar?.obligation_columns);
  const calendarRows = asRows(reportingCalendar?.rows);
  const availableCalendarYears = Array.isArray(reportingCalendar?.available_years)
    ? (reportingCalendar.available_years as unknown[]).map((y) => Number(y)).filter((y) => Number.isInteger(y))
    : [calendarYear];

  function calendarCell(row: UnknownRecord, obligationKey: string): UnknownRecord {
    const cells = row.cells as UnknownRecord | undefined;
    const cell = cells?.[obligationKey];
    return cell && typeof cell === 'object' && !Array.isArray(cell) ? (cell as UnknownRecord) : {};
  }

  function calendarInputValue(periodKey: string, obligationKey: string, cell: UnknownRecord): string {
    return calendarEdits[periodKey]?.[obligationKey] ?? text(cell.filing_due_date);
  }

  function setCalendarInputValue(periodKey: string, obligationKey: string, value: string): void {
    setCalendarEdits((prev) => ({
      ...prev,
      [periodKey]: {
        ...(prev[periodKey] ?? {}),
        [obligationKey]: value,
      },
    }));
  }

  async function saveCalendarPeriod(row: UnknownRecord): Promise<void> {
    const periodKey = text(row.reporting_period_key);
    if (!periodKey) return;
    const dates: UnknownRecord = {};
    for (const col of calendarColumns) {
      const key = text(col.obligation_key);
      if (!key) continue;
      const cell = calendarCell(row, key);
      const value = calendarInputValue(periodKey, key, cell).trim();
      if (value) dates[key] = value;
    }
    const refreshed = await sendCalendarCommand('save_reporting_calendar_period_dates', {
      country_code: text(reportingCalendar?.country_code) || 'IL',
      year: Number(reportingCalendar?.year ?? calendarYear),
      reporting_period_key: periodKey,
      dates,
    });
    if (refreshed) {
      setCalendarEdits((prev) => {
        const next = { ...prev };
        delete next[periodKey];
        return next;
      });
    }
  }

  async function publishCalendarYear(): Promise<void> {
    await sendCalendarCommand('publish_reporting_calendar_year', {
      country_code: text(reportingCalendar?.country_code) || 'IL',
      year: Number(reportingCalendar?.year ?? calendarYear),
    });
  }

  return (
    <div className="nx-owner-modules">
      <div style={{ marginBottom: 10 }}>
        <Link to="/platform-owner/modules" className="nx-owner-sheet__link">
          ← Modules
        </Link>
      </div>
      <h1 className="nx-owner-modules__title">{text(module?.display_name) || moduleCode}</h1>
      <p className="nx-owner-modules__subtitle">
        Code: <code>{moduleCode}</code>
        {' · '}
        Global:{' '}
        <span className={`nx-owner-badge ${module?.globally_enabled ? 'nx-owner-badge--on' : 'nx-owner-badge--off'}`}>
          {text(module?.global_status_label) || '—'}
        </span>
        {' · '}
        Organizations: {text(module?.organizations_count)}
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {loading && !aggregate ? <p>Loading…</p> : null}

      <div className="nx-owner-tabs">
        {tabs.map((t) => {
          const key = text(t.tab_key) as TabKey;
          return (
            <button
              key={key}
              type="button"
              className={activeTab === key ? 'is-active' : ''}
              onClick={() => setSearchParams({ tab: key })}
            >
              {text(t.label) || key}
            </button>
          );
        })}
      </div>

      {activeTab === 'pricing' ? (
        <div>
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="nx-owner-btn nx-owner-btn--primary"
              disabled={busy}
              onClick={() => {
                const planCode = window.prompt('Plan code');
                const name = window.prompt('Plan name');
                const amountRaw = window.prompt('Price amount');
                const currency = window.prompt('Currency', 'ILS') || 'ILS';
                if (!planCode || !name || amountRaw == null) return;
                const price_amount = Number(amountRaw);
                if (!Number.isFinite(price_amount)) return;
                void sendCommand('create_module_plan', {
                  module_code: moduleCode,
                  plan_code: planCode,
                  name,
                  price_amount,
                  currency,
                  billing_period: 'month',
                });
              }}
            >
              +New
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="nx-owner-sheet">
              <thead>
                <tr>
                  {['Module', 'Plan', 'Amount', 'Currency', 'Billing', 'Status', 'Actions'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricingRows.map((row, idx) => (
                  <tr key={`${text(row.module_plan_id)}:${idx}`}>
                    <td>
                      {text(row.module_code)}
                      <div style={{ color: '#6b7280', fontSize: 12 }}>{text(row.module_name)}</div>
                    </td>
                    <td>
                      {text(row.plan_name)}
                      <div style={{ color: '#6b7280', fontSize: 12 }}>{text(row.plan_code)}</div>
                    </td>
                    <td>{text(row.price_amount)}</td>
                    <td>{text(row.currency)}</td>
                    <td>{text(row.billing_period)}</td>
                    <td>
                      {text((row.status_badge as UnknownRecord | undefined)?.label) ||
                        (row.is_active ? 'Active' : 'Disabled')}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="nx-owner-btn"
                        disabled={busy}
                        onClick={() => {
                          const amountRaw = window.prompt('New module price', text(row.price_amount));
                          if (amountRaw == null) return;
                          const price_amount = Number(amountRaw);
                          if (!Number.isFinite(price_amount)) return;
                          void sendCommand('update_module_price', {
                            module_plan_id: text(row.module_plan_id),
                            price_amount,
                            currency: text(row.currency) || undefined,
                            billing_period: text(row.billing_period) || undefined,
                            is_active: Boolean(row.is_active),
                          });
                        }}
                      >
                        Update Module Price
                      </button>{' '}
                      <button
                        type="button"
                        className="nx-owner-btn"
                        disabled={busy}
                        onClick={() => {
                          const amountRaw = window.prompt('New package price', text(row.price_amount));
                          if (amountRaw == null) return;
                          const price_amount = Number(amountRaw);
                          if (!Number.isFinite(price_amount)) return;
                          void sendCommand('update_package_price', {
                            module_plan_id: text(row.module_plan_id),
                            price_amount,
                          });
                        }}
                      >
                        Update Package Price
                      </button>
                    </td>
                  </tr>
                ))}
                {!pricingRows.length ? (
                  <tr>
                    <td colSpan={7} style={{ color: '#6b7280' }}>
                      No pricing rows for this module.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Search org
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{ height: 34, borderRadius: 6, border: '1px solid #d1d5db', padding: '0 8px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Entitlement
              <select
                value={entitlementStatus}
                onChange={(e) => {
                  setEntitlementStatus(e.target.value);
                  setPage(1);
                }}
                style={{ height: 34, borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                <option value="">Any</option>
                <option value="entitled">entitled</option>
                <option value="trial">trial</option>
                <option value="not_entitled">not_entitled</option>
                <option value="expired">expired</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Org activation
              <select
                value={activationStatus}
                onChange={(e) => {
                  setActivationStatus(e.target.value);
                  setPage(1);
                }}
                style={{ height: 34, borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                <option value="">Any</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
          </div>
          <p style={{ fontSize: 12, color: '#6b7280' }}>
            Organization activation is distinct from Modules global ON/OFF (<code>modules.is_active</code>).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="nx-owner-sheet">
              <thead>
                <tr>
                  {['Organization', 'Clients', 'Org activation', 'Entitlement', 'Trial ends', 'Base', 'Effective', 'Actions'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {orgRows.map((org) => {
                  const modules = asRows(org.modules);
                  const mod = modules.find((m) => text(m.module_key) === moduleCode) ?? modules[0] ?? {};
                  const eff = (mod.effective_price_preview as UnknownRecord | undefined) ?? {};
                  return (
                    <tr key={text(org.org_id)}>
                      <td>{text(org.org_name)}</td>
                      <td>{text(org.clients_count)}</td>
                      <td>{text(mod.activation_status)}</td>
                      <td>{text(mod.entitlement_status)}</td>
                      <td>{mod.trial_ends_at ? formatOwnerDate(mod.trial_ends_at) : '—'}</td>
                      <td>
                        {text(mod.base_price_amount)} {text(mod.base_price_currency)}
                      </td>
                      <td>
                        {text(eff.amount)} {text(eff.currency)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="nx-owner-btn"
                          disabled={busy}
                          onClick={() => openExtendTrial(org, mod)}
                        >
                          Extend Trial
                        </button>{' '}
                        <button
                          type="button"
                          className="nx-owner-btn"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt('Activation reason') || '';
                            void sendCommand('activate_org_module_access', {
                              org_id: text(org.org_id),
                              module_key: moduleCode,
                              active_from: new Date().toISOString(),
                              reason,
                            });
                          }}
                        >
                          Activate
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!orgRows.length ? (
                  <tr>
                    <td colSpan={8} style={{ color: '#6b7280' }}>
                      No organizations for this module filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button type="button" className="nx-owner-btn" disabled={busy || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
            <span style={{ fontSize: 13 }}>Page {text(pagination?.page) || page}</span>
            <button
              type="button"
              className="nx-owner-btn"
              disabled={busy || Number(pagination?.page ?? page) >= Number(pagination?.total_pages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === 'reporting_calendar' ? (
        <div className="nx-owner-calendar" dir="rtl">
          <div className="nx-owner-calendar__toolbar">
            <div>
              <div className="nx-owner-calendar__title">יומן דיווחים</div>
              <div className="nx-owner-calendar__meta">
                Country: {text(reportingCalendar?.country_code) || 'IL'} · Legal owner:{' '}
                {text(reportingCalendar?.legal_owner) || 'country_pack_owner_legal_control'}
              </div>
            </div>
            <div className="nx-owner-calendar__actions">
              <label className="nx-owner-calendar__year">
                שנה
                <select
                  value={String(reportingCalendar?.year ?? calendarYear)}
                  onChange={(e) => setCalendarYear(Number(e.target.value))}
                  disabled={busy}
                >
                  {availableCalendarYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <span className={`nx-owner-badge ${text(reportingCalendar?.status) === 'active' ? 'nx-owner-badge--on' : 'nx-owner-badge--off'}`}>
                {text(reportingCalendar?.status_label) || 'Draft'}
              </span>
              <button
                type="button"
                className="nx-owner-btn nx-owner-btn--primary"
                disabled={busy || !calendarRows.length}
                onClick={() => void publishCalendarYear()}
              >
                פרסם שנה
              </button>
            </div>
          </div>

          <div className="nx-owner-calendar__note">
            עריכת תאריך בתא שומרת טיוטה בלבד. פרסום שנתי הופך את התאריכים לאמת משפטית פעילה.
          </div>

          <div className="nx-owner-calendar__table-wrap">
            <table className="nx-owner-sheet nx-owner-calendar__table">
              <thead>
                <tr>
                  <th>תקופה</th>
                  {calendarColumns.map((col) => (
                    <th key={text(col.obligation_key)}>{text(col.label) || text(col.obligation_key)}</th>
                  ))}
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {calendarRows.map((row) => {
                  const periodKey = text(row.reporting_period_key);
                  return (
                    <tr key={periodKey}>
                      <td className="nx-owner-calendar__period">
                        {text(row.period_label) || periodKey}
                        <div>{periodKey}</div>
                      </td>
                      {calendarColumns.map((col) => {
                        const obligationKey = text(col.obligation_key);
                        const cell = calendarCell(row, obligationKey);
                        const display = text(cell.filing_due_date_display);
                        return (
                          <td key={`${periodKey}:${obligationKey}`}>
                            <input
                              className="nx-owner-calendar__date"
                              type="date"
                              value={calendarInputValue(periodKey, obligationKey, cell)}
                              onChange={(e) => setCalendarInputValue(periodKey, obligationKey, e.target.value)}
                              disabled={busy}
                            />
                            <div className="nx-owner-calendar__display">{display || '—'}</div>
                            <div className="nx-owner-calendar__cell-status">{text(cell.status) || 'missing'}</div>
                          </td>
                        );
                      })}
                      <td>{text(row.row_status) || 'missing'}</td>
                      <td>
                        <button
                          type="button"
                          className="nx-owner-btn"
                          disabled={busy}
                          onClick={() => void saveCalendarPeriod(row)}
                        >
                          שמור
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!calendarRows.length ? (
                  <tr>
                    <td colSpan={calendarColumns.length + 3} style={{ color: '#6b7280' }}>
                      No reporting calendar rows for this year.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {extendModal ? (
        <div className="nx-owner-modal-overlay" role="presentation" onClick={closeExtendTrial}>
          <div
            className="nx-owner-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nx-owner-extend-trial-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-owner-modal__header">
              <h2 id="nx-owner-extend-trial-title" className="nx-owner-modal__title">
                Extend Trial
              </h2>
              <button type="button" className="nx-owner-btn" disabled={busy} onClick={closeExtendTrial}>
                Cancel
              </button>
            </div>

            {extendError ? <div className="nx-owner-modal__error">{extendError}</div> : null}

            <div className="nx-owner-modal__meta">
              <div>
                <div className="nx-owner-modal__label">Organization</div>
                <div className="nx-owner-modal__value">{extendModal.org_name}</div>
              </div>
              <div>
                <div className="nx-owner-modal__label">Module</div>
                <div className="nx-owner-modal__value">{extendModal.module_name}</div>
              </div>
              <div>
                <div className="nx-owner-modal__label">Current trial end</div>
                <div className="nx-owner-modal__value">
                  {extendModal.trial_ends_at ? formatOwnerDate(extendModal.trial_ends_at) : 'No active trial'}
                </div>
              </div>
            </div>

            <label className="nx-owner-modal__field">
              New trial end date
              <input type="date" value={extendUntilYmd} onChange={(e) => setExtendUntilYmd(e.target.value)} disabled={busy} />
            </label>

            <label className="nx-owner-modal__field">
              Reason
              <textarea
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder="Reason for extending the trial"
              />
            </label>

            <div className="nx-owner-modal__footer">
              <button type="button" className="nx-owner-btn" disabled={busy} onClick={closeExtendTrial}>
                Cancel
              </button>
              <button
                type="button"
                className="nx-owner-btn nx-owner-btn--primary"
                disabled={!canSubmitExtend}
                onClick={() => void submitExtendTrial()}
              >
                Extend Trial
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
