import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../../api/client';
import { OWNER } from '../../api/endpoints';
import './nx-owner-modules.css';

type UnknownRecord = Record<string, unknown>;

function asRows(v: unknown): UnknownRecord[] {
  return Array.isArray(v) ? (v as UnknownRecord[]) : [];
}

function text(v: unknown): string {
  return v == null ? '' : String(v);
}

export function PlatformOwnerModulesPage() {
  const navigate = useNavigate();
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAggregate((await apiJson(OWNER.modules)) as UnknownRecord);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleGlobal(moduleCode: string, nextActive: boolean): Promise<void> {
    setBusyCode(moduleCode);
    setError('');
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({
          command: 'set_module_global_activation',
          payload: { module_code: moduleCode, is_active: nextActive },
        }),
      })) as UnknownRecord;
      const refreshed = out.refreshed as UnknownRecord | undefined;
      if (String(refreshed?.aggregate_key ?? '') === 'owner_modules_list_aggregate' && refreshed?.aggregate) {
        setAggregate(refreshed.aggregate as UnknownRecord);
      } else {
        await load();
      }
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusyCode(null);
    }
  }

  const rows = asRows(aggregate?.rows);

  return (
    <div className="nx-owner-modules">
      <h1 className="nx-owner-modules__title">Modules</h1>
      <p className="nx-owner-modules__subtitle">
        Canonical catalog from <code>modules</code>. Global ON/OFF uses <code>modules.is_active</code> (not
        organization activation).
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {loading && !aggregate ? <p>Loading…</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Module</th>
              <th>Status</th>
              <th>Organizations</th>
              <th>Price</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const code = text(row.module_code);
              const enabled = Boolean(row.globally_enabled);
              const actions = (row.allowed_actions as UnknownRecord | undefined) ?? {};
              const busy = busyCode === code;
              return (
                <tr key={code || text(row.module_id)}>
                  <td>
                    <Link className="nx-owner-sheet__link" to={`/platform-owner/modules/${encodeURIComponent(code)}`}>
                      {text(row.display_name) || code}
                    </Link>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>{code}</div>
                  </td>
                  <td>
                    <label className="nx-owner-toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={busy || actions.set_global_activation === false}
                        onChange={(e) => void toggleGlobal(code, e.target.checked)}
                      />
                      <span className={`nx-owner-badge ${enabled ? 'nx-owner-badge--on' : 'nx-owner-badge--off'}`}>
                        {text(row.global_status_label) || (enabled ? 'ON' : 'OFF')}
                      </span>
                    </label>
                  </td>
                  <td>{text(row.organizations_count)}</td>
                  <td>{text(row.catalog_price_summary) || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="nx-owner-btn"
                      onClick={() => navigate(`/platform-owner/modules/${encodeURIComponent(code)}`)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && !rows.length ? (
              <tr>
                <td colSpan={5} style={{ color: '#6b7280' }}>
                  No commercial modules in catalog.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
