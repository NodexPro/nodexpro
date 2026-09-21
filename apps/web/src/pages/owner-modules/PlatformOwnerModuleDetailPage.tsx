import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../../api/client';
import { OWNER } from '../../api/endpoints';
import './nx-owner-modules.css';

type UnknownRecord = Record<string, unknown>;
type TabKey = 'pricing' | 'users' | 'reporting_calendar';

function asRows(v: unknown): UnknownRecord[] {
  return Array.isArray(v) ? (v as UnknownRecord[]) : [];
}

function text(v: unknown): string {
  return v == null ? '' : String(v);
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
      const agg = await apiJson<UnknownRecord>(`${OWNER.moduleDetail(moduleCode)}?${qs.toString()}`);
      setAggregate(agg);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, [moduleCode, page, search, entitlementStatus, activationStatus]);

  useEffect(() => {
    void load();
  }, [load]);

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
            commercial_controls_context: {
              page,
              page_size: 20,
              search: search.trim() || null,
              module_key: moduleCode,
              entitlement_status: entitlementStatus.trim() || null,
              activation_status: activationStatus.trim() || null,
            },
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

  const module = (aggregate?.module as UnknownRecord | undefined) ?? null;
  const pricing = (aggregate?.platform_pricing as UnknownRecord | undefined) ?? null;
  const pricingRows = asRows((pricing?.table as UnknownRecord | undefined)?.rows);
  const commercial = (aggregate?.commercial_controls as UnknownRecord | undefined) ?? null;
  const orgRows = asRows(commercial?.org_rows);
  const pagination = (commercial?.pagination as UnknownRecord | undefined) ?? null;
  const reportingCalendar = (aggregate?.reporting_calendar as UnknownRecord | undefined) ?? null;

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
                      <td>{text(mod.trial_ends_at) || '—'}</td>
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
                          onClick={() => {
                            const expires = window.prompt('Extend trial — expires_at (ISO)');
                            const reason = window.prompt('Reason') || '';
                            if (!expires) return;
                            void sendCommand('extend_org_module_trial', {
                              org_id: text(org.org_id),
                              module_key: moduleCode,
                              expires_at: expires,
                              reason,
                            });
                          }}
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
        <div className="nx-owner-empty">
          <strong>{text(reportingCalendar?.message) || 'Reporting Calendar configuration is not available yet.'}</strong>
          <p style={{ marginTop: 8 }}>
            UI location: Modules → Client Operations → Reporting Calendar. Canonical legal owner remains Country Pack /
            Owner Legal Control. No invented filing dates.
          </p>
        </div>
      ) : null}
    </div>
  );
}
