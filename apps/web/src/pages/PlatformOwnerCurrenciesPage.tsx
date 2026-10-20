import { useCallback, useEffect, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import './owner-modules/nx-owner-modules.css';

type CurrencyRow = {
  code?: string;
  name_en?: string;
  symbol?: string;
  status?: string;
  version?: number;
};

export function PlatformOwnerCurrenciesPage() {
  const [aggregate, setAggregate] = useState<{ currencies?: CurrencyRow[]; audit?: unknown[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: '', name_en: '', symbol: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      setAggregate(await apiJson(OWNER.currencies));
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(command: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      })) as { refreshed?: { aggregate?: typeof aggregate } };
      if (out.refreshed?.aggregate) setAggregate(out.refreshed.aggregate);
      else await load();
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = Array.isArray(aggregate?.currencies) ? aggregate.currencies : [];

  return (
    <div className="nx-owner-modules">
      <h1 className="nx-owner-modules__title">Currencies</h1>
      <p className="nx-owner-modules__subtitle">
        Platform-published ISO 4217 registry. Settings receive published codes from the session aggregate. This does not
        rewrite Accounting Base history.
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run('create_platform_currency', form);
        }}
      >
        <input
          placeholder="GBP"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
          maxLength={3}
        />
        <input
          placeholder="British Pound"
          value={form.name_en}
          onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
        />
        <input
          placeholder="£"
          value={form.symbol}
          onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
        />
        <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
          Add currency
        </button>
      </form>
      <table className="nx-owner-sheet">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Symbol</th>
            <th>Status</th>
            <th>Version</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.code)}>
              <td>{row.code}</td>
              <td>{row.name_en}</td>
              <td>{row.symbol}</td>
              <td>{row.status}</td>
              <td>{row.version}</td>
              <td>
                {row.status !== 'published' ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    onClick={() => void run('publish_platform_currency', { code: row.code })}
                  >
                    Publish
                  </button>
                ) : row.code !== 'ILS' && row.code !== 'USD' && row.code !== 'EUR' ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    onClick={() => void run('deactivate_platform_currency', { code: row.code })}
                  >
                    Deactivate
                  </button>
                ) : (
                  'Initial'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
