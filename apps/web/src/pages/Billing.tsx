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
import '../components/users-roles/UsersRoles.css';
import '../styles/nx-billing.css';

type BillingTab = { id: string; label: string };

type BillingWorkspace = {
  ui: { locale: string; direction: 'ltr' | 'rtl'; text: Record<string, string>; tabs: BillingTab[] };
  overview: {
    active_modules: Array<{ name: string }>;
    occupied_staff_seats: number;
    available_staff_seats: number;
    subscription_net_label: string;
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
};

type StaffAggregate = {
  ui: { text: Record<string, string> };
  seats: {
    included_staff_seats: number;
    grandfathered_staff_seats: number;
    purchased_additional_staff_seats: number;
    occupied_staff_seats: number;
    available_staff_seats: number;
  };
  pricing: {
    current_contract_label: string;
    current_contract_note: string;
    catalog_list_label: string;
    catalog_list_note: string;
    quote_source_note: string;
  };
  purchase_quote: {
    quantity: number;
    vat_authoritative?: boolean;
    labels: { unit: string; net: string; vat: string; total: string; recurring_after: string };
  };
  open_intent: { id: string } | null;
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
    started_at: string;
    status_label: string;
  }>;
  offers: Array<{
    module_id: string;
    name: string;
    plans: Array<{ module_plan_id: string; name: string; price_label: string; period_label: string }>;
    open_intent: { id: string; label: string } | null;
  }>;
  quote: { labels: { net: string; vat: string; total: string }; vat_authoritative?: boolean } | null;
  available_commands: { pay: { enabled: boolean } };
};

type PaymentsAggregate = {
  ui: { text: Record<string, string> };
  note: string;
  empty: boolean;
  empty_label: string;
  rows: Array<{ id: string; date_label: string; amount_label: string; status_label: string }>;
};

type ClientAggregate = {
  ui?: { text?: Record<string, string> };
  cards?: Array<{
    scenario: string;
    title: string;
    body: string;
    status_label: string;
    application_status?: string;
    merchant_note: string;
    merchant_reference?: string | null;
    blocked_reason: string | null;
    provider_choices_label: string;
    provider_choices: Array<{
      code: string;
      display_name: string;
      description?: string;
      logo_url?: string;
      commercial?: { commission_label?: string; connection_fee_label?: string; monthly_fee_label?: string; payout_terms?: string; terms_url?: string };
      collect_secrets?: boolean;
      can_start?: boolean;
      credential_fields?: Array<{ key: string; secret: boolean; label: string }>;
    }>;
    steps: string[];
    available_actions: {
      start: { action_key: string; enabled: boolean; label: string };
      save_credentials?: { action_key: string; enabled: boolean; label: string };
      verify?: { action_key: string; enabled: boolean; label: string };
      activate?: { action_key: string; enabled: boolean; label: string };
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
  const [clientForm, setClientForm] = useState<Record<string, { provider: string; merchant_id: string; api_key: string }>>({});

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
    if (
      (tab === 'modules' && modules) ||
      (tab === 'staff_licenses' && staff) ||
      (tab === 'billing_payments' && payments) ||
      (tab === 'client_processing' && client)
    ) {
      setTabLoading(false);
      return;
    }
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
  }, [orgId, tab, modules, staff, payments, client]);

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
      }
      if (kind === 'modules' && out.billing_modules_aggregate) {
        setModules(out.billing_modules_aggregate as ModulesAggregate);
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
      [text.occupied_seats, o.occupied_staff_seats],
      [text.available_seats, o.available_staff_seats],
      [text.subscription_total_net, o.subscription_net_label],
      [text.next_payment, o.next_payment_label],
      [text.payment_status, o.payment_status_label],
    ] as Array<[string, string | number]>;
  }, [workspace, text]);

  if (auth.status !== 'authenticated') return null;

  return (
    <div className="nx-ur-page nx-glass-page nx-glass-page--wide nx-office-ocean nx-billing" data-testid="nx-billing" dir={workspace?.ui.direction ?? 'ltr'}>
      <div className="nx-ur-page__head">
        <div>
          <h1 className="nx-ur-page__title">{text.title || 'Billing'}</h1>
          <p className="nx-ur-page__lead">{text.lead}</p>
        </div>
      </div>
      {error ? (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
          <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => void loadWorkspace()}>
            {text.retry}
          </button>
        </div>
      ) : null}
      <div className="nx-billing__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`nx-billing__tab${tab === item.id ? ' is-active' : ''}`}
            aria-selected={tab === item.id}
            onClick={() => setParams(item.id === 'overview' ? {} : { tab: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="nx-ur-sheet nx-billing__sheet">
        {loading ? <p className="nx-billing__muted">{text.loading}</p> : null}

        {tab === 'overview' && workspace ? (
          <div className="nx-billing__kpis">
            {overviewItems.map(([label, value]) => (
              <div key={label}>
                <span className="nx-billing__label">{label}</span>
                <span className="nx-billing__value">{value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'modules' ? (
          <>
            {tabLoading ? <p className="nx-billing__muted">{text.loading}</p> : null}
            {tabError ? <p role="alert">{tabError}</p> : null}
            <div className="nx-ur-table-scroll nx-billing__table-scroll">
              <table className="nx-ur-table">
                <thead>
                  <tr>
                    <th>{modules?.ui.text.module ?? text.module}</th>
                    <th>{modules?.ui.text.plan ?? text.plan}</th>
                    <th className="is-num">{modules?.ui.text.price ?? text.price}</th>
                    <th>{modules?.ui.text.period ?? text.period}</th>
                    <th>{modules?.ui.text.activated ?? text.activated}</th>
                    <th>{modules?.ui.text.status ?? text.status}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(modules?.subscriptions ?? []).map((row) => (
                    <tr key={row.module_id}>
                      <td>{row.name}</td>
                      <td>{row.plan_name}</td>
                      <td className="is-num">{row.price_label}</td>
                      <td>{row.period_label}</td>
                      <td>{row.started_at}</td>
                      <td>{row.status_label}</td>
                      <td />
                    </tr>
                  ))}
                  {(modules?.offers ?? []).flatMap((offer) =>
                    offer.plans.map((plan) => (
                      <tr key={`${offer.module_id}-${plan.module_plan_id}`}>
                        <td>{offer.name}</td>
                        <td>{plan.name}</td>
                        <td className="is-num">{plan.price_label}</td>
                        <td>{plan.period_label}</td>
                        <td>—</td>
                        <td>{offer.open_intent?.label ?? text.not_configured}</td>
                        <td>
                          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void run('quote_module_purchase', { module_id: offer.module_id, module_plan_id: plan.module_plan_id }, 'modules')}>{modules?.ui.text.quote}</button>
                          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void run('create_module_purchase_intent', { module_id: offer.module_id, module_plan_id: plan.module_plan_id }, 'modules')}>{modules?.ui.text.save_unpaid}</button>
                          {offer.open_intent ? (
                            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void run('cancel_module_purchase_intent', { intent_id: offer.open_intent!.id }, 'modules')}>{modules?.ui.text.cancel_unpaid}</button>
                          ) : null}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              {!tabLoading && !modules?.subscriptions.length && !modules?.offers.length ? (
                <p className="nx-billing__muted">{modules?.ui.text.empty_modules ?? text.empty_modules}</p>
              ) : null}
            </div>
            {modules?.quote ? <p className="nx-billing__note">{modules.quote.labels.net} · {modules.quote.labels.vat} · {modules.quote.labels.total}</p> : null}
            <div className="nx-billing__actions">
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled>{modules?.ui.text.pay ?? text.pay}</button>
              <span className="nx-billing__muted">{text.checkout_unavailable}</span>
            </div>
          </>
        ) : null}

        {tab === 'staff_licenses' ? (
          <section data-testid="nx-billing-staff" className="nx-ur-seats">
            {tabLoading ? <p className="nx-billing__muted">{text.loading}</p> : null}
            {tabError ? <p role="alert">{tabError}</p> : null}
            {staff ? (
              <>
                <div className="nx-ur-seats__metrics">
                  <div className="nx-ur-seats__metric"><span className="nx-ur-seats__label">{staff.ui.text.staff_included}</span><span className="nx-ur-seats__value">{staff.seats.included_staff_seats}</span></div>
                  <div className="nx-ur-seats__metric"><span className="nx-ur-seats__label">{staff.ui.text.staff_grandfathered}</span><span className="nx-ur-seats__value">{staff.seats.grandfathered_staff_seats}</span></div>
                  <div className="nx-ur-seats__metric"><span className="nx-ur-seats__label">{staff.ui.text.staff_purchased}</span><span className="nx-ur-seats__value">{staff.seats.purchased_additional_staff_seats}</span></div>
                  <div className="nx-ur-seats__metric"><span className="nx-ur-seats__label">{staff.ui.text.staff_occupied}</span><span className="nx-ur-seats__value">{staff.seats.occupied_staff_seats}</span></div>
                  <div className="nx-ur-seats__metric"><span className="nx-ur-seats__label">{staff.ui.text.staff_available}</span><span className="nx-ur-seats__value">{staff.seats.available_staff_seats}</span></div>
                </div>
                <div className="nx-ur-seats__qty">
                  <span className="nx-ur-seats__label">{staff.ui.text.qty}</span>
                  <div className="nx-ur-seats__stepper">
                    <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !staff.available_commands.quote_staff_seat_purchase.enabled || staff.purchase_quote.quantity <= 1} onClick={() => void run('quote_staff_seat_purchase', { quantity: staff.purchase_quote.quantity - 1 }, 'staff')}>−</button>
                    <span className="nx-ur-seats__value nx-ur-seats__value--sm">{staff.purchase_quote.quantity}</span>
                    <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !staff.available_commands.quote_staff_seat_purchase.enabled || staff.purchase_quote.quantity >= 99} onClick={() => void run('quote_staff_seat_purchase', { quantity: staff.purchase_quote.quantity + 1 }, 'staff')}>+</button>
                  </div>
                </div>
                <div className="nx-ur-table-scroll">
                  <table className="nx-ur-table">
                    <thead>
                      <tr>
                        <th>{staff.ui.text.staff_contract}</th>
                        <th>{staff.ui.text.staff_catalog}</th>
                        <th className="is-num">{staff.ui.text.unit}</th>
                        <th className="is-num">{staff.ui.text.net}</th>
                        <th className="is-num">{staff.ui.text.vat_amount}</th>
                        <th className="is-num">{staff.ui.text.total}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{staff.pricing.current_contract_label}</td>
                        <td>{staff.pricing.catalog_list_label}</td>
                        <td className="is-num">{staff.purchase_quote.labels.unit}</td>
                        <td className="is-num">{staff.purchase_quote.labels.net}</td>
                        <td className="is-num">{staff.purchase_quote.labels.vat}</td>
                        <td className="is-num">{staff.purchase_quote.labels.total}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="nx-ur-seats__note">{staff.pricing.quote_source_note}</p>
                {staff.purchase_quote.vat_authoritative ? null : <p className="nx-ur-seats__vat">{staff.ui.text.vat_not_configured}</p>}
                <div className="nx-ur-seats__actions">
                  <button type="button" className="nx-ur-btn nx-ur-btn--primary" disabled={busy || !staff.available_commands.create_staff_seat_purchase_intent.enabled} onClick={() => void run('create_staff_seat_purchase_intent', { quantity: staff.purchase_quote.quantity }, 'staff')}>{staff.ui.text.save_unpaid}</button>
                  {staff.open_intent ? (
                    <button type="button" className="nx-ur-btn nx-ur-btn--secondary" disabled={busy || !staff.available_commands.cancel_staff_seat_purchase_intent.enabled} onClick={() => void run('cancel_staff_seat_purchase_intent', { intent_id: staff.open_intent!.id }, 'staff')}>{staff.ui.text.cancel_unpaid}</button>
                  ) : null}
                  <button type="button" className="nx-ur-btn nx-ur-btn--secondary" disabled>{staff.ui.text.pay}</button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === 'billing_payments' ? (
          <section data-testid="nx-billing-history">
            {tabLoading ? <p className="nx-billing__muted">{text.loading}</p> : null}
            {tabError ? <p role="alert">{tabError}</p> : null}
            <p className="nx-billing__note">{payments?.note}</p>
            {payments?.empty ? <p className="nx-billing__muted">{payments.empty_label}</p> : (
              <div className="nx-ur-table-scroll nx-billing__table-scroll">
                <table className="nx-ur-table">
                  <thead>
                    <tr>
                      <th>{text.date}</th>
                      <th className="is-num">{text.amount}</th>
                      <th>{text.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payments?.rows ?? []).map((row) => (
                      <tr key={row.id}>
                        <td>{row.date_label}</td>
                        <td className="is-num">{row.amount_label}</td>
                        <td>{row.status_label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {tab === 'billing_details' && workspace ? (
          <section data-testid="nx-billing-payer">
            <p className="nx-billing__note">{workspace.billing_details.note}</p>
            <dl>
              <dt>{text.legal_name}</dt><dd>{dash(workspace.billing_details.legal_name)}</dd>
              <dt>{text.registration}</dt><dd>{dash(workspace.billing_details.registration_number)}</dd>
              <dt>{text.address}</dt><dd>{dash(workspace.billing_details.address)}</dd>
              <dt>{text.email}</dt><dd>{dash(workspace.billing_details.email)}</dd>
              <dt>{text.country}</dt><dd>{dash(workspace.billing_details.country)}</dd>
              <dt>{text.currency}</dt><dd>{dash(workspace.billing_details.currency)}</dd>
              <dt>{text.phone}</dt><dd>{dash(workspace.billing_details.phone)}</dd>
            </dl>
            <p className="nx-billing__note" data-testid="nx-billing-payment-method">{workspace.payment_method.label}</p>
            <Link className="nx-glass-link" to={workspace.billing_details.edit_href}>{text.edit_in_settings}</Link>
          </section>
        ) : null}

        {tab === 'client_processing' ? (
          <section data-testid="office-payments">
            {tabLoading ? <p className="nx-billing__muted">{text.loading}</p> : null}
            {tabError ? <p role="alert">{tabError}</p> : null}
            <div className="nx-billing__wizard">
              {(client?.cards ?? []).map((card) => {
                const form = clientForm[card.scenario] ?? {
                  provider: card.provider_choices[0]?.code ?? '',
                  merchant_id: card.merchant_reference ?? '',
                  api_key: '',
                };
                const selected = card.provider_choices.find((row) => row.code === form.provider) ?? card.provider_choices[0];
                const setForm = (next: Partial<typeof form>) =>
                  setClientForm((prev) => ({ ...prev, [card.scenario]: { ...form, ...next } }));
                return (
                  <article key={card.scenario}>
                    <h2>{card.title}</h2>
                    <p>{card.body}</p>
                    <p className="nx-billing__note">{card.status_label}</p>
                    {card.application_status ? <p className="nx-billing__note">{card.application_status}</p> : null}
                    <label className="nx-ur-field">
                      <span>{card.provider_choices_label}</span>
                      <select className="nx-glass-input" value={form.provider} onChange={(e) => setForm({ provider: e.target.value })}>
                        {card.provider_choices.map((provider) => (
                          <option key={provider.code} value={provider.code}>{provider.display_name}</option>
                        ))}
                      </select>
                    </label>
                    {selected?.description ? <p className="nx-billing__note">{selected.description}</p> : null}
                    {selected?.commercial ? (
                      <p className="nx-billing__note">
                        {selected.commercial.commission_label} · {selected.commercial.connection_fee_label} · {selected.commercial.monthly_fee_label}
                      </p>
                    ) : null}
                    {selected?.commercial?.payout_terms ? <p className="nx-billing__note">{selected.commercial.payout_terms}</p> : null}
                    {selected?.commercial?.terms_url ? <a className="nx-glass-link" href={selected.commercial.terms_url} target="_blank" rel="noreferrer">{selected.commercial.terms_url}</a> : null}
                    {(selected?.credential_fields ?? []).map((field) => (
                      <label className="nx-ur-field" key={field.key}>
                        <span>{field.label}</span>
                        <input
                          className="nx-glass-input"
                          type={field.secret ? 'password' : 'text'}
                          autoComplete="off"
                          value={field.key === 'api_key' ? form.api_key : form.merchant_id}
                          onChange={(e) => setForm(field.key === 'api_key' ? { api_key: e.target.value } : { merchant_id: e.target.value })}
                          disabled={!card.available_actions.enter_api_keys.enabled}
                        />
                      </label>
                    ))}
                    {card.blocked_reason ? <p className="nx-billing__note">{card.blocked_reason}</p> : null}
                    <div className="nx-billing__actions">
                      <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--primary" disabled={busy || !card.available_actions.start.enabled} onClick={() => void run(card.available_actions.start.action_key, { provider_code: form.provider }, 'client')}>{card.available_actions.start.label}</button>
                      {card.available_actions.save_credentials ? (
                        <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !card.available_actions.save_credentials.enabled} onClick={() => void run(card.available_actions.save_credentials!.action_key, { provider_code: form.provider, merchant_id: form.merchant_id, api_key: form.api_key }, 'client')}>{card.available_actions.save_credentials.label}</button>
                      ) : null}
                      {card.available_actions.verify ? (
                        <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !card.available_actions.verify.enabled} onClick={() => void run(card.available_actions.verify!.action_key, { scenario: card.scenario }, 'client')}>{card.available_actions.verify.label}</button>
                      ) : null}
                      {card.available_actions.activate ? (
                        <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !card.available_actions.activate.enabled} onClick={() => void run(card.available_actions.activate!.action_key, { scenario: card.scenario }, 'client')}>{card.available_actions.activate.label}</button>
                      ) : null}
                      <button type="button" className="nx-ur-btn nx-ur-btn--sm nx-ur-btn--secondary" disabled={busy || !card.available_actions.disconnect.enabled} onClick={() => void run(card.available_actions.disconnect.action_key, { scenario: card.scenario }, 'client')}>{card.available_actions.disconnect.label}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
