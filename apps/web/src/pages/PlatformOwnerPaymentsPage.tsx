import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import '../styles/nx-glass-surface.css';
import '../components/users-roles/UsersRoles.css';
import '../styles/nx-office-deep-ocean.css';
import '../styles/nx-billing.css';

type ProviderRow = {
  code?: string;
  label?: string;
  display_name?: string;
  display_name_he?: string;
  description?: string;
  description_en?: string;
  description_he?: string;
  logo_url?: string;
  adapter_status?: string;
  adapter_label?: string;
  supported_scenarios?: string[];
  show_in_billing?: boolean;
  allow_new_connections?: boolean;
  commission_percent?: number | null;
  connection_fee_amount?: number | null;
  monthly_fee_amount?: number | null;
  fee_currency?: string;
  payout_terms_en?: string;
  payout_terms_he?: string;
  terms_url?: string;
  office_preview?: {
    display_name?: string;
    description?: string;
    shown_in_billing?: boolean;
    new_connections_allowed?: boolean;
    connect_enabled?: boolean;
    commercial?: {
      commission_label?: string;
      connection_fee_label?: string;
      monthly_fee_label?: string;
      payout_terms?: string;
      terms_url?: string;
    };
  };
};

type OwnerPaymentsAggregate = {
  ui?: {
    locale?: string;
    direction?: 'ltr' | 'rtl';
    text?: Record<string, string>;
    tabs?: Array<{ id: string; label: string }>;
  };
  providers?: ProviderRow[];
  diagnostics?: { note?: string; checkout_available?: boolean; ready_adapter_count?: number; adapter_toggle_blocked?: string; hidden_keeps_connection?: string };
  available_actions?: { upsert_payment_provider_catalog?: boolean; save_platform_payment_provider_credentials?: boolean; reason?: string };
};

const EMPTY_FORM = {
  code: '',
  display_name: '',
  display_name_he: '',
  logo_url: '',
  description_en: '',
  description_he: '',
  supported_scenarios: ['PLATFORM_BILLING', 'OFFICE_EXTERNAL', 'OFFICE_EMBEDDED'],
  show_in_billing: true,
  allow_new_connections: false,
  commission_percent: '',
  connection_fee_amount: '',
  monthly_fee_amount: '',
  payout_terms_en: '',
  payout_terms_he: '',
  terms_url: '',
};

export function PlatformOwnerPaymentsPage() {
  const [aggregate, setAggregate] = useState<OwnerPaymentsAggregate | null>(null);
  const [tab, setTab] = useState('providers');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<typeof EMPTY_FORM | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await apiJson<OwnerPaymentsAggregate>(OWNER.payments);
      setAggregate(next);
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const text = aggregate?.ui?.text ?? {};
  const tabs = aggregate?.ui?.tabs ?? [];
  const providers = aggregate?.providers ?? [];

  function openNew() {
    setEditing({ ...EMPTY_FORM });
  }

  function openEdit(row: ProviderRow) {
    setEditing({
      code: row.code ?? '',
      display_name: row.display_name ?? '',
      display_name_he: row.display_name_he ?? '',
      logo_url: row.logo_url ?? '',
      description_en: row.description_en ?? row.description ?? '',
      description_he: row.description_he ?? '',
      supported_scenarios: row.supported_scenarios?.length ? [...row.supported_scenarios] : [...EMPTY_FORM.supported_scenarios],
      show_in_billing: row.show_in_billing !== false,
      allow_new_connections: row.allow_new_connections === true,
      commission_percent: row.commission_percent != null ? String(row.commission_percent) : '',
      connection_fee_amount: row.connection_fee_amount != null ? String(row.connection_fee_amount) : '',
      monthly_fee_amount: row.monthly_fee_amount != null ? String(row.monthly_fee_amount) : '',
      payout_terms_en: row.payout_terms_en ?? '',
      payout_terms_he: row.payout_terms_he ?? '',
      terms_url: row.terms_url ?? '',
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const out = await apiJson<{ owner_payments_aggregate?: OwnerPaymentsAggregate }>(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({
          command: 'upsert_payment_provider_catalog',
          payload: {
            ...editing,
            commission_percent: editing.commission_percent === '' ? null : Number(editing.commission_percent),
            connection_fee_amount: editing.connection_fee_amount === '' ? null : Number(editing.connection_fee_amount),
            monthly_fee_amount: editing.monthly_fee_amount === '' ? null : Number(editing.monthly_fee_amount),
          },
        }),
      });
      if (out.owner_payments_aggregate) setAggregate(out.owner_payments_aggregate);
      setEditing(null);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const preview = useMemo(() => {
    if (!editing) return null;
    return {
      name: editing.display_name_he || editing.display_name,
      description: editing.description_he || editing.description_en,
      commission: editing.commission_percent ? `${editing.commission_percent}%` : text.no_fee_published,
      shown: editing.show_in_billing,
    };
  }, [editing, text.no_fee_published]);

  return (
    <div className="nx-ur-page nx-office-ocean nx-owner-payments nx-billing" data-testid="owner-payments" dir={aggregate?.ui?.direction ?? 'ltr'}>
      <div className="nx-ur-page__head">
        <div>
          <h1 className="nx-ur-page__title">{text.owner_title ?? 'Payments'}</h1>
          <p className="nx-ur-page__lead">{text.owner_subtitle}</p>
        </div>
        {tab === 'providers' ? (
          <button type="button" className="nx-ur-btn nx-ur-btn--primary" onClick={openNew}>
            {text.add_provider}
          </button>
        ) : null}
      </div>
      {error ? <p className="nx-ur-error" role="alert">{error}</p> : null}
      <div className="nx-billing__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`nx-billing__tab${tab === item.id ? ' is-active' : ''}`}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="nx-ur-sheet nx-billing__sheet">
        {tab === 'providers' ? (
          <>
            <div className="nx-ur-table-scroll">
              <table className="nx-ur-table">
                <thead>
                  <tr>
                    <th>{text.col_provider}</th>
                    <th>{text.col_scenarios}</th>
                    <th>{text.col_show_billing}</th>
                    <th>{text.col_allow_new}</th>
                    <th>{text.col_adapter}</th>
                    <th>{text.col_preview}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {providers.map((row) => (
                    <tr key={row.code}>
                      <td>{row.label || row.display_name}</td>
                      <td>{(row.supported_scenarios ?? []).join(', ')}</td>
                      <td>{row.show_in_billing ? '✓' : '—'}</td>
                      <td>{row.allow_new_connections ? '✓' : '—'}</td>
                      <td>{row.adapter_label}</td>
                      <td>
                        {row.office_preview?.commercial?.commission_label}
                        {row.office_preview?.shown_in_billing ? '' : ` · ${text.show_in_billing}`}
                      </td>
                      <td>
                        <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" onClick={() => openEdit(row)}>
                          {text.edit_provider}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editing ? (
              <form
                className="nx-billing__editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="nx-billing__kpis">
                  <label className="nx-ur-field">
                    <span>{text.choose_provider}</span>
                    <input className="nx-glass-input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} required />
                  </label>
                  <label className="nx-ur-field">
                    <span>{text.name_en}</span>
                    <input className="nx-glass-input" value={editing.display_name} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} required />
                  </label>
                  <label className="nx-ur-field">
                    <span>{text.name_he}</span>
                    <input className="nx-glass-input" value={editing.display_name_he} onChange={(e) => setEditing({ ...editing, display_name_he: e.target.value })} />
                  </label>
                  <label className="nx-ur-field">
                    <span>{text.logo_url}</span>
                    <input className="nx-glass-input" value={editing.logo_url} onChange={(e) => setEditing({ ...editing, logo_url: e.target.value })} />
                  </label>
                </div>
                <label className="nx-ur-field">
                  <span>{text.description_en}</span>
                  <textarea className="nx-glass-input" value={editing.description_en} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })} />
                </label>
                <label className="nx-ur-field">
                  <span>{text.description_he}</span>
                  <textarea className="nx-glass-input" value={editing.description_he} onChange={(e) => setEditing({ ...editing, description_he: e.target.value })} />
                </label>
                <fieldset className="nx-billing__checks">
                  {['PLATFORM_BILLING', 'OFFICE_EXTERNAL', 'OFFICE_EMBEDDED'].map((code) => (
                    <label key={code}>
                      <input
                        type="checkbox"
                        checked={editing.supported_scenarios.includes(code)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            supported_scenarios: e.target.checked
                              ? [...editing.supported_scenarios, code]
                              : editing.supported_scenarios.filter((item) => item !== code),
                          })
                        }
                      />
                      {code}
                    </label>
                  ))}
                </fieldset>
                <label>
                  <input type="checkbox" checked={editing.show_in_billing} onChange={(e) => setEditing({ ...editing, show_in_billing: e.target.checked })} />
                  {text.show_in_billing}
                </label>
                <label>
                  <input type="checkbox" checked={editing.allow_new_connections} onChange={(e) => setEditing({ ...editing, allow_new_connections: e.target.checked })} />
                  {text.allow_new_connections}
                </label>
                <p className="nx-billing__note">{text.adapter_toggle_blocked}</p>
                <p className="nx-billing__note">{text.hidden_keeps_connection}</p>
                <div className="nx-billing__kpis">
                  <label className="nx-ur-field">
                    <span>{text.commission}</span>
                    <input className="nx-glass-input" value={editing.commission_percent} onChange={(e) => setEditing({ ...editing, commission_percent: e.target.value })} />
                  </label>
                  <label className="nx-ur-field">
                    <span>{text.connection_fee}</span>
                    <input className="nx-glass-input" value={editing.connection_fee_amount} onChange={(e) => setEditing({ ...editing, connection_fee_amount: e.target.value })} />
                  </label>
                  <label className="nx-ur-field">
                    <span>{text.monthly_fee}</span>
                    <input className="nx-glass-input" value={editing.monthly_fee_amount} onChange={(e) => setEditing({ ...editing, monthly_fee_amount: e.target.value })} />
                  </label>
                </div>
                <label className="nx-ur-field">
                  <span>{text.payout_terms_en}</span>
                  <textarea className="nx-glass-input" value={editing.payout_terms_en} onChange={(e) => setEditing({ ...editing, payout_terms_en: e.target.value })} />
                </label>
                <label className="nx-ur-field">
                  <span>{text.payout_terms_he}</span>
                  <textarea className="nx-glass-input" value={editing.payout_terms_he} onChange={(e) => setEditing({ ...editing, payout_terms_he: e.target.value })} />
                </label>
                <label className="nx-ur-field">
                  <span>{text.terms_url}</span>
                  <input className="nx-glass-input" value={editing.terms_url} onChange={(e) => setEditing({ ...editing, terms_url: e.target.value })} />
                </label>
                <aside className="nx-billing__preview">
                  <h2>{text.office_preview}</h2>
                  <p>{preview?.name}</p>
                  <p>{preview?.description}</p>
                  <p>{text.commission}: {preview?.commission}</p>
                  <p>{preview?.shown ? text.show_in_billing : ''}</p>
                </aside>
                <div className="nx-billing__actions">
                  <button type="submit" className="nx-ur-btn nx-ur-btn--primary" disabled={busy}>{text.save_provider}</button>
                  <button type="button" className="nx-ur-btn nx-ur-btn--secondary" onClick={() => setEditing(null)}>{text.cancel}</button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
        {tab === 'platform_billing' ? <p className="nx-billing__note">{text.platform_seller}</p> : null}
        {tab === 'office_providers' ? <p className="nx-billing__note">{text.office_seller}</p> : null}
        {tab === 'transactions' ? <p className="nx-billing__muted">{text.empty_transactions}</p> : null}
        {tab === 'subscriptions' ? <p className="nx-billing__muted">{text.empty_subscriptions}</p> : null}
        {tab === 'diagnostics' ? (
          <p className="nx-billing__note">
            {text.diagnostics_note} {text.checkout_blocked} {aggregate?.diagnostics?.hidden_keeps_connection}
          </p>
        ) : null}
        {aggregate?.available_actions?.save_platform_payment_provider_credentials ? null : (
          <p className="nx-billing__muted">{aggregate?.available_actions?.reason}</p>
        )}
      </div>
    </div>
  );
}
