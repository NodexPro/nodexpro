import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, userFacingApiMessage } from '../api/client';
import {
  orgBillingClientProcessing,
  orgBillingCommand,
  orgBillingModules,
  orgBillingPlatformPayments,
  orgBillingStaffLicenses,
  orgBillingWorkspace,
} from '../api/endpoints';
import '../styles/nx-glass-surface.css';
import '../styles/nx-office-deep-ocean.css';
import '../styles/nx-billing.css';

type BillingTab = {
  id: string;
  label: string;
};

type BillingWorkspace = {
  ui: { locale: string; direction: 'ltr' | 'rtl'; text: Record<string, string>; tabs: BillingTab[] };
  overview: {
    active_modules: Array<{ name: string; price_label: string }>;
    module_subscription_net_label: string;
    included_staff_seats: number;
    purchased_additional_staff_seats: number;
    occupied_staff_seats: number;
    available_staff_seats: number;
    extra_seats_net_label: string;
    subscription_net_label: string;
    vat_label: string;
    total_label: string;
    next_payment_label: string;
    payment_status_label: string;
  };
  billing_details: {
    legal_name: string | null;
    registration_number: string | null;
    address: string | null;
    email: string | null;
    country: string | null;
    currency: string;
    phone: string | null;
    note: string;
    edit_href: string;
  };
  payment_method: { label: string };
  timing?: { load_ms: number };
};

type StaffAggregate = {
  ui: { text: Record<string, string> };
  seats: {
    included_staff_seats: number;
    grandfathered_staff_seats: number;
    purchased_additional_staff_seats: number;
    occupied_staff_seats: number;
    available_staff_seats: number;
    extra_unit_label: string;
    extra_monthly_net_label: string;
  };
  purchase_quote: {
    quantity: number;
    labels: { unit: string; net: string; vat: string; total: string; recurring_after: string };
  };
  open_intent: { id: string; status: string } | null;
  available_commands: {
    quote_staff_seat_purchase: { enabled: boolean };
    create_staff_seat_purchase_intent: { enabled: boolean };
    cancel_staff_seat_purchase_intent: { enabled: boolean };
    pay: { enabled: boolean };
  };
};

type ModulesAggregate = {
  ui: { text: Record<string, string> };
  subscriptions: Array<{
    module_id: string;
    name: string;
    plan_name: string;
    price_label: string;
    period_label: string;
    started_at: string | null;
    status: string;
  }>;
  offers: Array<{
    module_id: string;
    name: string;
    plans: Array<{ module_plan_id: string; name: string; price_label: string; period_label: string }>;
    open_intent: { id: string; status: string } | null;
  }>;
  quote: { labels: { unit: string; net: string; vat: string; total: string }; vat_authoritative?: boolean } | null;
  available_commands: { pay: { enabled: boolean } };
};

type PaymentsAggregate = {
  ui: { text: Record<string, string> };
  note: string;
  empty: boolean;
  empty_label: string;
};

type ClientAggregate = {
  ui?: { text?: Record<string, string>; direction?: 'ltr' | 'rtl' };
  cards?: Array<{
    scenario: string;
    title: string;
    body: string;
    status_label: string;
    steps: string[];
    providers: Array<{ code: string; display_name: string; adapter_status: string }>;
    available_actions: {
      start: { action_key: string; enabled: boolean; label: string };
      disconnect: { action_key: string; enabled: boolean; label: string };
      enter_api_keys: { enabled: boolean };
    };
  }>;
};

const TAB_IDS = ['overview', 'modules', 'staff_licenses', 'billing_payments', 'billing_details', 'client_processing'] as const;

export function Billing() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const tab = TAB_IDS.includes(params.get('tab') as (typeof TAB_IDS)[number])
    ? String(params.get('tab'))
    : 'overview';

  const [workspace, setWorkspace] = useState<BillingWorkspace | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<ModulesAggregate | null>(null);
  const [staff, setStaff] = useState<StaffAggregate | null>(null);
  const [payments, setPayments] = useState<PaymentsAggregate | null>(null);
  const [client, setClient] = useState<ClientAggregate | null>(null);
  const [tabError, setTabError] = useState('');
  const [tabLoading, setTabLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const text = workspace?.ui.text ?? {};

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const next = await apiJson<BillingWorkspace>(orgBillingWorkspace(orgId), signal ? { signal } : undefined);
      if (signal?.aborted) return;
      setWorkspace(next);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(userFacingApiMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    const ac = new AbortController();
    void loadWorkspace(ac.signal);
    return () => ac.abort();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!orgId || tab === 'overview' || tab === 'billing_details') return;
    const ac = new AbortController();
    setTabError('');
    setTabLoading(true);
    const load = async () => {
      try {
        if (tab === 'modules') setModules(await apiJson(orgBillingModules(orgId), { signal: ac.signal }));
        if (tab === 'staff_licenses') setStaff(await apiJson(orgBillingStaffLicenses(orgId), { signal: ac.signal }));
        if (tab === 'billing_payments') setPayments(await apiJson(orgBillingPlatformPayments(orgId), { signal: ac.signal }));
        if (tab === 'client_processing') setClient(await apiJson(orgBillingClientProcessing(orgId), { signal: ac.signal }));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setTabError(userFacingApiMessage(e));
      } finally {
        if (!ac.signal.aborted) setTabLoading(false);
      }
    };
    void load();
    return () => ac.abort();
  }, [orgId, tab]);

  async function run(command: string, payload: Record<string, unknown>, kind: 'staff' | 'modules' | 'client') {
    if (!orgId) return;
    setBusy(true);
    setTabError('');
    try {
      const out = await apiJson<Record<string, unknown>>(orgBillingCommand(orgId, command), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (kind === 'staff' && out.billing_staff_licenses_aggregate) {
        setStaff(out.billing_staff_licenses_aggregate as StaffAggregate);
        if (command !== 'quote_staff_seat_purchase') {
          void apiJson<BillingWorkspace>(orgBillingWorkspace(orgId)).then(setWorkspace).catch(() => undefined);
        }
      }
      if (kind === 'modules' && out.billing_modules_aggregate) {
        setModules(out.billing_modules_aggregate as ModulesAggregate);
        if (command !== 'quote_module_purchase') {
          void apiJson<BillingWorkspace>(orgBillingWorkspace(orgId)).then(setWorkspace).catch(() => undefined);
        }
      }
      if (kind === 'client' && out.office_payments_aggregate) setClient(out.office_payments_aggregate as ClientAggregate);
    } catch (e) {
      setTabError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const dash = (value: string | number | null | undefined) => value || text.not_configured || '—';
  const tabs = workspace?.ui.tabs ?? [];

  const overviewItems = useMemo(() => {
    if (!workspace) return [];
    const o = workspace.overview;
    return [
      [text.active_modules, o.active_modules.length ? o.active_modules.map((row) => row.name).join(', ') : text.empty_modules],
      [text.module_subscription_cost, o.module_subscription_net_label],
      [text.included_seats, o.included_staff_seats],
      [text.purchased_seats, o.purchased_additional_staff_seats],
      [text.occupied_seats, o.occupied_staff_seats],
      [text.available_seats, o.available_staff_seats],
      [text.extra_seat_cost, o.extra_seats_net_label],
      [text.subscription_total_net, o.subscription_net_label],
      [text.vat, o.vat_label],
      [text.total, o.total_label],
      [text.next_payment, o.next_payment_label],
      [text.payment_status, o.payment_status_label],
    ] as Array<[string, string | number]>;
  }, [workspace, text]);

  if (auth.status !== 'authenticated') return null;

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-office-ocean nx-billing" data-testid="nx-billing" dir={workspace?.ui.direction ?? 'ltr'}>
      <div className="nx-billing__head">
        <h1 className="nx-billing__title">{text.title || 'Billing'}</h1>
        <p className="nx-billing__lead">{text.lead}</p>
      </div>
      {error ? <div className="nx-glass-alert nx-glass-alert--error" role="alert">{error}</div> : null}
      <div className="nx-billing__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`nx-btn nx-btn-taxes-compact nx-billing__tab${tab === item.id ? ' is-active' : ''}`}
            aria-selected={tab === item.id}
            onClick={() => setParams(item.id === 'overview' ? {} : { tab: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {loading ? <p className="nx-glass-muted">…</p> : null}
      {error ? (
        <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => void loadWorkspace()}>
          {text.retry || 'Retry'}
        </button>
      ) : null}

      {tab === 'overview' && workspace ? (
        <section className="nx-glass-card">
          <div className="nx-billing__grid">
            {overviewItems.map(([label, value]) => (
              <div className="nx-billing__metric" key={label}>
                <span className="nx-billing__label">{label}</span>
                <span className="nx-billing__value">{value}</span>
              </div>
            ))}
          </div>
          {workspace.timing ? <p className="nx-billing__timing">{workspace.timing.load_ms} ms</p> : null}
        </section>
      ) : null}

      {tab === 'modules' ? (
        <section className="nx-glass-card">
          {tabLoading ? <p className="nx-glass-muted">…</p> : null}
          {tabError ? <p role="alert">{tabError}</p> : null}
          {modules?.subscriptions.length ? (
            <div className="nx-glass-table-wrap">
              <table className="nx-glass-table">
                <thead>
                  <tr>
                    <th>{modules.ui.text.module}</th>
                    <th>{modules.ui.text.plan}</th>
                    <th>{modules.ui.text.price}</th>
                    <th>{modules.ui.text.period}</th>
                    <th>{modules.ui.text.activated}</th>
                    <th>{modules.ui.text.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.subscriptions.map((row) => (
                    <tr key={row.module_id}>
                      <td>{row.name}</td>
                      <td>{row.plan_name}</td>
                      <td>{row.price_label}</td>
                      <td>{row.period_label}</td>
                      <td>{row.started_at ?? '—'}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !tabLoading ? (
            <p className="nx-glass-muted">{modules?.ui.text.empty_modules}</p>
          ) : null}
          {(modules?.offers ?? []).map((offer) => (
            <div key={offer.module_id} className="nx-billing__metric">
              <strong>{offer.name}</strong>
              {offer.plans.map((plan) => (
                <p key={plan.module_plan_id}>
                  {plan.name} · {plan.price_label} / {plan.period_label}{' '}
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    onClick={() => void run('quote_module_purchase', { module_id: offer.module_id, module_plan_id: plan.module_plan_id }, 'modules')}
                  >
                    {modules?.ui.text.quote}
                  </button>
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    onClick={() => void run('create_module_purchase_intent', { module_id: offer.module_id, module_plan_id: plan.module_plan_id }, 'modules')}
                  >
                    {modules?.ui.text.save_unpaid}
                  </button>
                </p>
              ))}
              {offer.open_intent ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => void run('cancel_module_purchase_intent', { intent_id: offer.open_intent!.id }, 'modules')}
                >
                  {modules?.ui.text.cancel_unpaid}
                </button>
              ) : null}
            </div>
          ))}
          {modules?.quote ? (
            <p>
              {modules.quote.labels.net} · {modules.quote.labels.vat} · {modules.quote.labels.total}
            </p>
          ) : null}
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled>
            {modules?.ui.text.pay ?? text.pay}
          </button>
          <p className="nx-glass-muted">{text.checkout_unavailable}</p>
        </section>
      ) : null}

      {tab === 'staff_licenses' ? (
        <section className="nx-glass-card" data-testid="nx-billing-staff">
          {tabLoading ? <p className="nx-glass-muted">…</p> : null}
          {tabError ? <p role="alert">{tabError}</p> : null}
          {staff ? (
            <>
              <div className="nx-billing__grid">
                <div><span className="nx-billing__label">{staff.ui.text.staff_included}</span><span className="nx-billing__value">{staff.seats.included_staff_seats}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_grandfathered}</span><span className="nx-billing__value">{staff.seats.grandfathered_staff_seats}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_purchased}</span><span className="nx-billing__value">{staff.seats.purchased_additional_staff_seats}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_occupied}</span><span className="nx-billing__value">{staff.seats.occupied_staff_seats}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_available}</span><span className="nx-billing__value">{staff.seats.available_staff_seats}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_unit}</span><span className="nx-billing__value">{staff.seats.extra_unit_label}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.staff_monthly}</span><span className="nx-billing__value">{staff.seats.extra_monthly_net_label}</span></div>
              </div>
              <div className="nx-billing__stepper">
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || !staff.available_commands.quote_staff_seat_purchase.enabled || staff.purchase_quote.quantity <= 1}
                  onClick={() => void run('quote_staff_seat_purchase', { quantity: staff.purchase_quote.quantity - 1 }, 'staff')}
                >
                  −
                </button>
                <span className="nx-billing__value">{staff.purchase_quote.quantity}</span>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || !staff.available_commands.quote_staff_seat_purchase.enabled || staff.purchase_quote.quantity >= 99}
                  onClick={() => void run('quote_staff_seat_purchase', { quantity: staff.purchase_quote.quantity + 1 }, 'staff')}
                >
                  +
                </button>
              </div>
              <div className="nx-billing__grid">
                <div><span className="nx-billing__label">{staff.ui.text.unit}</span><span className="nx-billing__value">{staff.purchase_quote.labels.unit}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.net}</span><span className="nx-billing__value">{staff.purchase_quote.labels.net}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.vat_amount}</span><span className="nx-billing__value">{staff.purchase_quote.labels.vat}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.total}</span><span className="nx-billing__value">{staff.purchase_quote.labels.total}</span></div>
                <div><span className="nx-billing__label">{staff.ui.text.recurring_after}</span><span className="nx-billing__value">{staff.purchase_quote.labels.recurring_after}</span></div>
              </div>
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !staff.available_commands.create_staff_seat_purchase_intent.enabled} onClick={() => void run('create_staff_seat_purchase_intent', { quantity: staff.purchase_quote.quantity }, 'staff')}>{staff.ui.text.save_unpaid}</button>
              {staff.open_intent ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !staff.available_commands.cancel_staff_seat_purchase_intent.enabled} onClick={() => void run('cancel_staff_seat_purchase_intent', { intent_id: staff.open_intent!.id }, 'staff')}>{staff.ui.text.cancel_unpaid}</button>
              ) : null}
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled>{staff.ui.text.pay}</button>
              <p className="nx-glass-muted">{text.checkout_unavailable}</p>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'billing_payments' ? (
        <section className="nx-glass-card" data-testid="nx-billing-history">
          {tabLoading ? <p className="nx-glass-muted">…</p> : null}
          {tabError ? <p role="alert">{tabError}</p> : null}
          <p className="nx-glass-muted">{payments?.note}</p>
          <p data-testid="nx-billing-payment-method">{workspace?.payment_method.label}</p>
          {payments?.empty ? <p>{payments.empty_label}</p> : null}
        </section>
      ) : null}

      {tab === 'billing_details' && workspace ? (
        <section className="nx-glass-card" data-testid="nx-billing-payer">
          <p className="nx-glass-muted">{workspace.billing_details.note}</p>
          <dl className="nx-glass-dl">
            <dt>{text.legal_name}</dt><dd>{dash(workspace.billing_details.legal_name)}</dd>
            <dt>{text.registration}</dt><dd>{dash(workspace.billing_details.registration_number)}</dd>
            <dt>{text.address}</dt><dd>{dash(workspace.billing_details.address)}</dd>
            <dt>{text.email}</dt><dd>{dash(workspace.billing_details.email)}</dd>
            <dt>{text.country}</dt><dd>{dash(workspace.billing_details.country)}</dd>
            <dt>{text.currency}</dt><dd>{dash(workspace.billing_details.currency)}</dd>
            <dt>{text.phone}</dt><dd>{dash(workspace.billing_details.phone)}</dd>
          </dl>
          <p className="nx-glass-muted">{workspace.payment_method.label}</p>
          <Link className="nx-glass-link" to={workspace.billing_details.edit_href}>{text.edit_in_settings}</Link>
        </section>
      ) : null}

      {tab === 'client_processing' ? (
        <section className="nx-glass-card" data-testid="office-payments">
          {tabLoading ? <p className="nx-glass-muted">…</p> : null}
          {tabError ? <p role="alert">{tabError}</p> : null}
          <div className="nx-billing__cards">
            {(client?.cards ?? []).map((card) => (
              <article key={card.scenario}>
                <h2>{card.title}</h2>
                <p>{card.body}</p>
                <p>{card.status_label}</p>
                <ul>{card.steps.map((step) => <li key={step}>{step}</li>)}</ul>
                <ul>
                  {card.providers.map((provider) => (
                    <li key={provider.code}>{provider.display_name} — {provider.adapter_status}</li>
                  ))}
                </ul>
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !card.available_actions.start.enabled} onClick={() => void run(card.available_actions.start.action_key, {}, 'client')}>{card.available_actions.start.label}</button>
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !card.available_actions.disconnect.enabled} onClick={() => void run(card.available_actions.disconnect.action_key, { scenario: card.scenario }, 'client')}>{card.available_actions.disconnect.label}</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
