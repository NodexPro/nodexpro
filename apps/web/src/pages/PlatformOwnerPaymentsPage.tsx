import { useCallback, useEffect, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import './owner-modules/nx-owner-modules.css';

type ProviderRow = {
  code?: string;
  display_name?: string;
  adapter_status?: string;
  supported_scenarios?: string[];
  connectable?: boolean;
  notes?: string;
};

type OwnerPaymentsAggregate = {
  ui?: {
    text?: Record<string, string>;
    tabs?: Array<{ id: string; label: string }>;
  };
  providers?: ProviderRow[];
  platform_credentials?: Array<{ provider_code: string; environment_mode: string; credentials_configured: boolean }>;
  office_connections?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
  diagnostics?: { note?: string; checkout_available?: boolean; ready_adapter_count?: number };
  available_actions?: { save_platform_payment_provider_credentials?: boolean; reason?: string };
};

export function PlatformOwnerPaymentsPage() {
  const [aggregate, setAggregate] = useState<OwnerPaymentsAggregate | null>(null);
  const [tab, setTab] = useState('providers');
  const [error, setError] = useState('');

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

  return (
    <div className="nx-owner-modules" data-testid="owner-payments">
      <h1 className="nx-owner-modules__title">{text.owner_title ?? 'Payments'}</h1>
      <p className="nx-owner-modules__subtitle">{text.owner_subtitle}</p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <div className="nx-owner-payments__tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nx-btn nx-btn-taxes-compact${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'providers' ? (
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Scenarios</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((row) => (
              <tr key={row.code}>
                <td>{row.display_name}</td>
                <td>{row.adapter_status === 'ready' ? 'Ready' : text.catalog_only}</td>
                <td>{(row.supported_scenarios ?? []).join(', ')}</td>
                <td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === 'platform_billing' ? <p>{text.platform_seller}</p> : null}
      {tab === 'office_providers' ? <p>{text.office_seller}</p> : null}
      {tab === 'transactions' ? (
        <p>{(aggregate?.transactions ?? []).length ? String((aggregate?.transactions ?? []).length) : text.empty_transactions}</p>
      ) : null}
      {tab === 'subscriptions' ? <p>{text.empty_subscriptions}</p> : null}
      {tab === 'diagnostics' ? (
        <p>
          {text.diagnostics_note} {text.checkout_blocked}
        </p>
      ) : null}
      {aggregate?.available_actions?.save_platform_payment_provider_credentials ? null : (
        <p className="nx-owner-modules__subtitle">{aggregate?.available_actions?.reason}</p>
      )}
    </div>
  );
}
