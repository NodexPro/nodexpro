import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson, ApiError, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import type { AggregateAction, CommandModalState } from './owner-legal-control-panel-actions';
import { ActionToolbar, CommandActionModal } from './owner-legal-control-panel-actions';
import type { OwnerCommandResponse, UnknownRecord } from './owner-legal-control-types';
import './owner-modules/nx-owner-modules.css';

type TaxVersion = {
  version_id?: string;
  rate_label?: string;
  calculation_type?: string;
  name_he?: string;
  name_en?: string;
  description_he?: string;
  description_en?: string;
  conditions_label?: string;
  effective_from?: string;
  effective_to?: string | null;
  status?: string;
  is_current?: boolean;
};

type TaxRule = {
  row_id?: string;
  country_code?: string;
  country_name?: string;
  tax_type?: string;
  value_key?: string;
  name_he?: string;
  name_en?: string;
  description_he?: string;
  description_en?: string;
  rate_label?: string;
  calculation_type?: string;
  scope?: string;
  conditions_label?: string;
  effective_from?: string;
  effective_to?: string | null;
  version_label?: string;
  status?: string;
  history?: TaxVersion[];
  actions?: AggregateAction[];
};

type TaxesAggregate = {
  aggregate_key?: string;
  ui?: { locale?: string; direction?: 'ltr' | 'rtl'; text?: Record<string, string> };
  platform_seller_vat?: { authoritative?: boolean; message?: string; unresolved_reason?: string | null };
  rules?: TaxRule[];
  empty?: boolean;
  audit?: Array<{ id?: string; action?: string; entity_type?: string; created_at?: string }>;
  available_actions?: AggregateAction[];
};

function asTaxesAggregate(raw: unknown): TaxesAggregate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as UnknownRecord;
  if (rec.aggregate_key === 'owner_taxes_aggregate') return rec as TaxesAggregate;
  const nested = rec.owner_taxes_aggregate;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as TaxesAggregate;
  return rec.rules ? (rec as TaxesAggregate) : null;
}

export function PlatformOwnerTaxesPage() {
  const [aggregate, setAggregate] = useState<TaxesAggregate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [modal, setModal] = useState<CommandModalState | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setAggregate(await apiJson<TaxesAggregate>(OWNER.taxes));
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
        body: JSON.stringify({ command, payload: { ...payload, owner_surface: 'taxes' } }),
      })) as OwnerCommandResponse;
      const next = asTaxesAggregate(out.refreshed?.aggregate) ?? asTaxesAggregate(out.refreshed);
      if (next?.rules) setAggregate(next);
      else await load();
      setModal(null);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const text = aggregate?.ui?.text ?? {};
  const lang = aggregate?.ui?.locale === 'he' ? 'he' : 'en';
  const rules = Array.isArray(aggregate?.rules) ? aggregate.rules : [];
  const toolbarActions = useMemo(
    () => (Array.isArray(aggregate?.available_actions) ? aggregate.available_actions : []),
    [aggregate],
  );

  return (
    <div
      className="nx-owner-modules nx-owner-taxes"
      dir={aggregate?.ui?.direction ?? 'ltr'}
      lang={aggregate?.ui?.locale ?? 'en'}
      data-testid="nx-owner-taxes"
    >
      <h1 className="nx-owner-modules__title">{text.title ?? 'Taxes'}</h1>
      <p className="nx-owner-modules__subtitle">{text.lead}</p>
      {aggregate?.platform_seller_vat?.message ? (
        <p className={aggregate.platform_seller_vat.authoritative ? 'nx-owner-taxes__ok' : 'nx-owner-taxes__warn'}>
          {text.platform_vat}: {aggregate.platform_seller_vat.message}
        </p>
      ) : null}
      <p className="nx-owner-modules__subtitle">{text.supported_types}</p>
      <p className="nx-owner-modules__subtitle">{text.immutable_note}</p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <ActionToolbar
        actions={toolbarActions}
        disabled={busy}
        variant="compact"
        onPick={(command, meta, prefilled) =>
          setModal({
            command,
            actionMeta: meta,
            prefilled: { ...(typeof meta.payload === 'object' ? {} : {}), ...(meta as { prefill?: UnknownRecord }).prefill, ...prefilled },
          })
        }
      />
      <div className="nx-owner-sheet-wrap">
        <table className="nx-owner-sheet" data-testid="nx-owner-taxes-table">
          <thead>
            <tr>
              <th>{text.country}</th>
              <th>{text.tax_type}</th>
              <th>{text.name}</th>
              <th>{text.description}</th>
              <th>{text.rate}</th>
              <th>{text.calculation_type}</th>
              <th>{text.scope}</th>
              <th>{text.conditions}</th>
              <th>{text.effective_from}</th>
              <th>{text.effective_to}</th>
              <th>{text.version}</th>
              <th>{text.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((row) => {
              const name = lang === 'he' ? row.name_he || row.name_en : row.name_en || row.name_he;
              const description =
                lang === 'he' ? row.description_he || row.description_en : row.description_en || row.description_he;
              return (
                <tr key={row.row_id ?? row.value_key}>
                  <td>{row.country_name}</td>
                  <td>{row.tax_type}</td>
                  <td>{name}</td>
                  <td>{description}</td>
                  <td>{row.rate_label}</td>
                  <td>{row.calculation_type}</td>
                  <td>{row.scope}</td>
                  <td>{row.conditions_label}</td>
                  <td>{row.effective_from}</td>
                  <td>{row.effective_to ?? text.none}</td>
                  <td>{row.version_label}</td>
                  <td>{row.status}</td>
                  <td>
                    <div className="nx-owner-taxes__row-actions">
                      {(row.actions ?? [])
                        .filter((a) => a.enabled !== false)
                        .map((action) => (
                          <button
                            key={String(action.action_key)}
                            type="button"
                            className="nx-owner-taxes__btn"
                            disabled={busy}
                            onClick={() =>
                              setModal({
                                command: String(action.action_key),
                                actionMeta: action,
                                prefilled: ((action as { prefill?: UnknownRecord }).prefill ?? {}) as UnknownRecord,
                              })
                            }
                          >
                            {action.button_label}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="nx-owner-taxes__btn"
                        onClick={() =>
                          setOpenHistory((cur) => (cur === row.row_id ? null : String(row.row_id ?? '')))
                        }
                      >
                        {text.history}
                      </button>
                    </div>
                    {openHistory === row.row_id ? (
                      <table className="nx-owner-sheet nx-owner-taxes__history">
                        <thead>
                          <tr>
                            <th>{text.effective_from}</th>
                            <th>{text.effective_to}</th>
                            <th>{text.rate}</th>
                            <th>{text.status}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(row.history ?? []).map((ver) => (
                            <tr key={ver.version_id}>
                              <td>{ver.effective_from}</td>
                              <td>{ver.effective_to ?? text.none}</td>
                              <td>{ver.rate_label}</td>
                              <td>{ver.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {aggregate?.empty ? <p className="nx-owner-modules__subtitle">{text.empty}</p> : null}
      <h2 className="nx-owner-taxes__audit-title">{text.audit}</h2>
      <table className="nx-owner-sheet">
        <tbody>
          {(aggregate?.audit ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.created_at}</td>
              <td>{row.action}</td>
              <td>{row.entity_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CommandActionModal
        open={Boolean(modal)}
        state={modal}
        busy={busy}
        onClose={() => setModal(null)}
        onSubmit={run}
      />
    </div>
  );
}
