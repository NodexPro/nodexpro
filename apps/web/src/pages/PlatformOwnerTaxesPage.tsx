import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson, ApiError, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import type { AggregateAction } from './owner-legal-control-panel-actions';
import { isPayloadFieldSchema } from './owner-legal-control-panel-actions';
import type { OwnerCommandResponse, StringFieldMap, UnknownRecord } from './owner-legal-control-types';
import '../styles/nx-glass-surface.css';
import '../styles/nx-settings-deep-ocean.css';
import '../styles/nx-office-deep-ocean.css';
import '../styles/nx-owner-taxes.css';

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

type TaxAction = AggregateAction & {
  disabled_reason?: string | null;
  prefill?: UnknownRecord;
  payload?: unknown;
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
  actions?: TaxAction[];
};

type TaxesAggregate = {
  aggregate_key?: string;
  ui?: { locale?: string; direction?: 'ltr' | 'rtl'; text?: Record<string, string> };
  platform_seller_vat?: { authoritative?: boolean; message?: string; unresolved_reason?: string | null };
  rules?: TaxRule[];
  default_country_code?: string;
  empty?: boolean;
  audit?: Array<{ id?: string; action?: string; entity_type?: string; created_at?: string }>;
  available_actions?: TaxAction[];
};

type CommandModalState = {
  command: string;
  actionMeta: TaxAction;
  prefilled: UnknownRecord;
  size?: 'compact' | 'wide';
};

const HIDDEN_FIELDS = new Set([
  'owner_surface',
  'status',
  'legal_value_version_id',
  'country_pack_ruleset_id',
  'value_type',
  'owner_note',
  'name_he',
  'name_en',
  'description_he',
  'description_en',
  'conditions',
]);

function chromeLabel(text: Record<string, string>, key: string, lang: 'he' | 'en', he: string, en: string): string {
  const value = String(text[key] ?? '').trim();
  return value || (lang === 'he' ? he : en);
}

const VISIBLE_FIELDS: Record<string, string[]> = {
  create_legal_value: ['country_code', 'label', 'category', 'module_scope', 'value_key', 'usage_hint'],
  schedule_tax_rate_change: ['rate', 'effective_from'],
  create_legal_value_version: ['rate', 'effective_from', 'effective_to'],
  update_legal_value_metadata: ['label', 'usage_hint'],
};

function asTaxesAggregate(raw: unknown): TaxesAggregate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as UnknownRecord;
  if (rec.aggregate_key === 'owner_taxes_aggregate') return rec as TaxesAggregate;
  const nested = rec.owner_taxes_aggregate;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as TaxesAggregate;
  return rec.rules ? (rec as TaxesAggregate) : null;
}

function displayDate(raw?: string | null): string {
  if (!raw) return '';
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function fieldLabel(text: Record<string, string>, field: string): string {
  const mapped: Record<string, string> = {
    country_code: text.country,
    label: text.name,
    category: text.tax_type,
    module_scope: text.scope,
    usage_hint: text.description,
    value_key: text.rule_key,
    rate: text.new_rate || text.rate,
    effective_from: text.effective_from,
    effective_to: text.effective_to,
    name_he: text.name_he,
    name_en: text.name_en,
    description_he: text.description_he,
    description_en: text.description_en,
    conditions: text.conditions,
  };
  return mapped[field] || text[field] || field;
}

function visibleFieldsFor(command: string, hints: StringFieldMap | null): string[] {
  const preferred = VISIBLE_FIELDS[command];
  if (!hints) return preferred ?? [];
  const keys = preferred?.filter((key) => key in hints) ?? Object.keys(hints).filter((key) => !HIDDEN_FIELDS.has(key));
  return keys.length ? keys : Object.keys(hints).filter((key) => !HIDDEN_FIELDS.has(key));
}

function buildPayloadFromHints(form: StringFieldMap, hints: StringFieldMap): UnknownRecord {
  const out: UnknownRecord = {};
  for (const [key, hint] of Object.entries(hints)) {
    const raw = form[key];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
      if (hint.toLowerCase().includes('optional')) continue;
      continue;
    }
    const hl = hint.toLowerCase();
    if (hl.includes('|')) out[key] = v;
    else if (hl.includes('number')) {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = n;
    } else if (hl.includes('boolean')) out[key] = v === 'true' || v === '1' || v === 'yes';
    else out[key] = v;
  }
  return out;
}

function TaxesCommandModal({
  open,
  state,
  busy,
  text,
  direction,
  locale,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: CommandModalState | null;
  busy: boolean;
  text: Record<string, string>;
  direction: 'ltr' | 'rtl';
  locale: string;
  onClose: () => void;
  onSubmit: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const [schemaFields, setSchemaFields] = useState({} as StringFieldMap);
  const [localError, setLocalError] = useState('');
  const command = state?.command ?? '';
  const actionMeta = state?.actionMeta;
  const prefilled = state?.prefilled ?? {};
  const hints = actionMeta?.payload && isPayloadFieldSchema(actionMeta.payload) ? actionMeta.payload : null;
  const fields = visibleFieldsFor(command, hints);

  useEffect(() => {
    if (!open || !state) return;
    setLocalError('');
    if (state.actionMeta.payload && isPayloadFieldSchema(state.actionMeta.payload)) {
      const init: StringFieldMap = {};
      for (const k of Object.keys(state.actionMeta.payload as StringFieldMap)) {
        const pv = state.prefilled[k];
        init[k] = pv === undefined || pv === null ? '' : typeof pv === 'object' ? '' : String(pv);
      }
      setSchemaFields(init);
    }
  }, [open, state]);

  async function handleSubmit(): Promise<void> {
    if (!state || !actionMeta || !hints) return;
    setLocalError('');
    const payload = { ...prefilled, ...buildPayloadFromHints(schemaFields, hints) };
    try {
      await onSubmit(command, payload);
    } catch (e) {
      setLocalError(userFacingApiMessage(e));
    }
  }

  if (!open || !state || !actionMeta) return null;

  return (
    <div className="nx-owner-taxes__modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`nx-glass-card nx-owner-taxes__modal${state.size === 'wide' ? ' nx-owner-taxes__modal--wide' : ''}`}
        dir={direction}
        lang={locale}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid={command === 'schedule_tax_rate_change' ? 'nx-owner-taxes-rate-modal' : 'nx-owner-taxes-modal'}
      >
        <h3>
          {actionMeta.button_label?.trim()
            ? actionMeta.button_label
            : chromeLabel(text, 'settings', locale === 'he' ? 'he' : 'en', 'הגדרות', 'Settings')}
        </h3>
        {actionMeta.note ? <p className="nx-settings-muted">{actionMeta.note}</p> : null}
        {localError ? (
          <div className="nx-glass-alert nx-glass-alert--error" role="alert">
            {localError}
          </div>
        ) : null}
        <div className="nx-owner-taxes__modal-body">
          {fields.map((fieldKey) => {
            const isDate = fieldKey.startsWith('effective_');
            const isRate = fieldKey === 'rate';
            return (
              <label key={fieldKey} className="nx-glass-label">
                {fieldLabel(text, fieldKey)}
                <input
                  className="nx-glass-input"
                  type={isDate ? 'date' : 'text'}
                  inputMode={isRate ? 'decimal' : undefined}
                  value={schemaFields[fieldKey] ?? ''}
                  placeholder={isRate ? text.rate_hint : undefined}
                  onChange={(e) => setSchemaFields((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                />
              </label>
            );
          })}
          {command === 'schedule_tax_rate_change' ? (
            <>
              <p className="nx-settings-muted">{text.rate_hint}</p>
              {text.immutable_note ? <p className="nx-settings-muted">{text.immutable_note}</p> : null}
            </>
          ) : null}
        </div>
        <div className="nx-owner-taxes__modal-footer">
          <button type="button" className="nx-glass-btn nx-glass-btn--secondary" disabled={busy} onClick={onClose}>
            {chromeLabel(text, 'close', locale === 'he' ? 'he' : 'en', 'סגירה', 'Close')}
          </button>
          <button type="button" className="nx-glass-btn nx-glass-btn--purple" disabled={busy} onClick={() => void handleSubmit()}>
            {busy
              ? chromeLabel(text, 'loading', locale === 'he' ? 'he' : 'en', 'טוען…', 'Loading…')
              : chromeLabel(text, 'save', locale === 'he' ? 'he' : 'en', 'שמירה', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlatformOwnerTaxesPage() {
  const [aggregate, setAggregate] = useState<TaxesAggregate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [countryFilter, setCountryFilter] = useState('');
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [modal, setModal] = useState<CommandModalState | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setLoading(true);
    try {
      const next = await apiJson<TaxesAggregate>(OWNER.taxes, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      setAggregate(next);
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(userFacingApiMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
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
      if (next?.rules) {
        setAggregate(next);
        setLoading(false);
      } else {
        await load();
      }
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
  const direction = aggregate?.ui?.direction === 'rtl' ? 'rtl' : 'ltr';
  const rules = Array.isArray(aggregate?.rules) ? aggregate.rules : [];
  const countries = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rules) {
      const code = String(row.country_code ?? '').trim();
      if (!code) continue;
      map.set(code, row.country_name || code);
    }
    return [...map.entries()].map(([code, name]) => ({ code, name }));
  }, [rules]);

  const defaultCountry = String(aggregate?.default_country_code ?? '').trim();
  const selectedCountry = countryFilter || defaultCountry || (countries.length === 1 ? countries[0].code : 'all');
  const visibleRules = useMemo(() => {
    if (selectedCountry === 'all' || !selectedCountry) return rules;
    return rules.filter((row) => row.country_code === selectedCountry);
  }, [rules, selectedCountry]);

  const addAction = (aggregate?.available_actions ?? []).find((item) => item.action_key === 'create_legal_value');
  const countryOptions =
    countries.length > 0
      ? countries
      : addAction?.prefill?.country_code
        ? [{ code: String(addAction.prefill.country_code), name: String(addAction.prefill.country_code) }]
        : [];
  const countrySelectValue = selectedCountry;

  function pickName(row: TaxRule): string {
    return lang === 'he' ? row.name_he || row.name_en || '' : row.name_en || row.name_he || '';
  }

  function pickDescription(row: TaxRule): string {
    return lang === 'he'
      ? row.description_he || row.description_en || ''
      : row.description_en || row.description_he || '';
  }

  function openAction(action: TaxAction, extra?: UnknownRecord, size?: CommandModalState['size']) {
    setModal({
      command: String(action.action_key ?? ''),
      actionMeta: action,
      prefilled: { ...(action.prefill ?? {}), ...extra },
      size,
    });
  }

  function openRateChange(row: TaxRule, action: TaxAction) {
    openAction(
      { ...action, button_label: text.change_rate || action.button_label },
      {
        name_he: row.name_he,
        name_en: row.name_en,
        description_he: row.description_he,
        description_en: row.description_en,
      },
      'compact',
    );
  }

  function actionOf(row: TaxRule, key: string): TaxAction | undefined {
    return (row.actions ?? []).find((item) => item.action_key === key);
  }

  return (
    <div
      className="nx-glass-page nx-glass-page--wide nx-settings nx-settings-deep-ocean nx-office-ocean nx-owner-taxes"
      dir={direction}
      lang={aggregate?.ui?.locale ?? 'en'}
      data-testid="nx-owner-taxes"
    >
      <div className="nx-owner-taxes__toolbar">
        <h1 className="nx-glass-title">{text.title ?? 'Taxes'}</h1>
        <label className="nx-glass-label">
          {text.country}
          <select
            className="nx-glass-input"
            data-testid="nx-owner-taxes-country"
            value={countrySelectValue}
            onChange={(e) => setCountryFilter(e.target.value)}
          >
            {countryOptions.length > 1 ? <option value="all">{text.all_countries}</option> : null}
            {countryOptions.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {addAction && addAction.enabled !== false ? (
          <button
            type="button"
            className="nx-glass-btn nx-glass-btn--purple"
            data-testid="nx-owner-taxes-add"
            disabled={busy}
            onClick={() =>
              openAction(
                addAction,
                selectedCountry !== 'all' ? { country_code: selectedCountry } : {},
                'wide',
              )
            }
          >
            {addAction.button_label || chromeLabel(text, 'add_tax_type', lang, 'הוספת מס', 'Add tax')}
          </button>
        ) : null}
      </div>

      {text.lead ? <p className="nx-glass-subtitle nx-owner-taxes__lead">{text.lead}</p> : null}

      {loading && !aggregate ? (
        <div className="nx-owner-taxes__list" data-testid="nx-owner-taxes-skeleton" aria-busy="true">
          <section className="nx-glass-card nx-owner-taxes__card nx-owner-taxes__skeleton" />
          <section className="nx-glass-card nx-owner-taxes__card nx-owner-taxes__skeleton" />
        </div>
      ) : null}

      {error ? (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {aggregate?.platform_seller_vat?.message ? (
        <div
          className={
            aggregate.platform_seller_vat.authoritative
              ? 'nx-glass-alert nx-glass-alert--ok'
              : 'nx-glass-alert nx-glass-alert--warn'
          }
          role={aggregate.platform_seller_vat.authoritative ? 'status' : 'alert'}
          data-testid="nx-owner-taxes-vat-reason"
        >
          {aggregate.platform_seller_vat.message}
        </div>
      ) : null}

      <div className="nx-owner-taxes__list" data-testid="nx-owner-taxes-list">
        {visibleRules.map((row) => {
          const id = String(row.row_id ?? row.value_key ?? '');
          const expanded = openRule === id;
          const schedule = actionOf(row, 'schedule_tax_rate_change');
          const future = actionOf(row, 'create_legal_value_version');
          const activate = actionOf(row, 'activate_legal_value_version');
          const editMeta = actionOf(row, 'update_legal_value_metadata');
          return (
            <section className="nx-glass-card nx-settings-pair-card nx-owner-taxes__card" key={id} data-testid="nx-owner-taxes-card">
              <div className="nx-owner-taxes__card-head">
                <div className="nx-owner-taxes__card-main">
                  <h2>{pickName(row)}</h2>
                  <p className="nx-settings-muted">{row.scope}</p>
                  <p className="nx-owner-taxes__meta">
                    <span>{row.rate_label || text.none}</span>
                    <span>{displayDate(row.effective_from) || text.none}</span>
                    <span>{row.status || text.none}</span>
                  </p>
                </div>
                <button
                  type="button"
                  className="nx-glass-btn nx-glass-btn--secondary"
                  data-testid="nx-owner-taxes-settings"
                  disabled={busy}
                  onClick={() => setOpenRule((cur) => (cur === id ? null : id))}
                >
                  {chromeLabel(text, 'settings', lang, 'הגדרות', 'Settings')}
                </button>
              </div>
              {expanded ? (
                <div className="nx-owner-taxes__detail">
                  <dl className="nx-settings-identity-table">
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.name_he}</dt>
                      <dd className="nx-settings-readonly">{row.name_he || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.name_en}</dt>
                      <dd className="nx-settings-readonly">{row.name_en || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.description_he}</dt>
                      <dd className="nx-settings-readonly">{row.description_he || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.description_en}</dt>
                      <dd className="nx-settings-readonly">{row.description_en || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.calculation_type}</dt>
                      <dd className="nx-settings-readonly">{row.calculation_type || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.scope}</dt>
                      <dd className="nx-settings-readonly">{row.scope || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.conditions}</dt>
                      <dd className="nx-settings-readonly">{row.conditions_label || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.rate}</dt>
                      <dd className="nx-settings-readonly">{row.rate_label || text.none}</dd>
                    </div>
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.effective_from}</dt>
                      <dd className="nx-settings-readonly">{displayDate(row.effective_from) || text.none}</dd>
                    </div>
                    {row.effective_to ? (
                      <div className="nx-settings-identity-table__row">
                        <dt>{text.effective_to}</dt>
                        <dd className="nx-settings-readonly">{displayDate(row.effective_to)}</dd>
                      </div>
                    ) : null}
                    <div className="nx-settings-identity-table__row">
                      <dt>{text.status}</dt>
                      <dd className="nx-settings-readonly">{row.status || text.none}</dd>
                    </div>
                  </dl>
                  {pickDescription(row) ? <p className="nx-settings-muted">{pickDescription(row)}</p> : null}
                  <div className="nx-owner-taxes__actions">
                    {schedule && schedule.enabled !== false ? (
                      <button
                        type="button"
                        className="nx-glass-btn nx-glass-btn--purple"
                        disabled={busy}
                        onClick={() => openRateChange(row, schedule)}
                      >
                        {chromeLabel(text, 'change_rate', lang, 'שינוי שיעור', 'Change rate') ||
                          schedule.button_label}
                      </button>
                    ) : null}
                    {future && future.enabled !== false ? (
                      <button
                        type="button"
                        className="nx-glass-btn nx-glass-btn--secondary"
                        disabled={busy}
                        onClick={() =>
                          openAction(
                            future,
                            {
                              name_he: row.name_he,
                              name_en: row.name_en,
                              description_he: row.description_he,
                              description_en: row.description_en,
                            },
                            'compact',
                          )
                        }
                      >
                        {future.button_label ||
                          chromeLabel(text, 'new_future_version', lang, 'גרסה עתידית', 'Future version')}
                      </button>
                    ) : null}
                    {activate ? (
                      <button
                        type="button"
                        className="nx-glass-btn nx-glass-btn--secondary"
                        disabled={busy || activate.enabled === false}
                        title={activate.disabled_reason ?? undefined}
                        onClick={() => {
                          if (activate.enabled === false) return;
                          void run(String(activate.action_key), { ...(activate.prefill ?? {}) }).catch((e) =>
                            setError(userFacingApiMessage(e)),
                          );
                        }}
                      >
                        {activate.button_label ||
                          chromeLabel(text, 'activate_version', lang, 'הפעלת גרסה', 'Activate version')}
                      </button>
                    ) : null}
                    {editMeta && editMeta.enabled !== false ? (
                      <button
                        type="button"
                        className="nx-glass-btn nx-glass-btn--secondary"
                        disabled={busy}
                        onClick={() => openAction(editMeta, {}, 'wide')}
                      >
                        {editMeta.button_label ||
                          chromeLabel(text, 'edit_metadata', lang, 'עריכת תוויות', 'Edit labels')}
                      </button>
                    ) : null}
                  </div>
                  {activate?.enabled === false && activate.disabled_reason ? (
                    <p className="nx-settings-muted">{activate.disabled_reason}</p>
                  ) : null}
                  <div className="nx-owner-taxes__history">
                    <h3>{chromeLabel(text, 'version_history', lang, 'היסטוריית גרסאות', 'Version history')}</h3>
                    <ul className="nx-owner-taxes__history-list">
                      {(row.history ?? []).map((ver) => (
                        <li key={ver.version_id}>
                          <span>{ver.rate_label || text.none}</span>
                          <span>{displayDate(ver.effective_from) || text.none}</span>
                          {ver.effective_to ? <span>{displayDate(ver.effective_to)}</span> : null}
                          <span>{ver.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {!loading && (aggregate?.empty || !visibleRules.length) ? (
        <p className="nx-settings-muted">{text.empty || chromeLabel(text, 'empty', lang, 'אין עדיין כללי מס.', 'No tax rules yet.')}</p>
      ) : null}

      {aggregate ? (
        <details className="nx-glass-card nx-owner-taxes__audit" data-testid="nx-owner-taxes-audit">
          <summary>{chromeLabel(text, 'change_history', lang, 'היסטוריית שינויים', 'Change history')}</summary>
          <ul className="nx-owner-taxes__audit-list">
            {(aggregate.audit ?? []).map((row, index) => (
              <li key={row.id ?? String(index)}>
                <span>{row.action}</span>
                <span>{displayDate(row.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <TaxesCommandModal
        open={Boolean(modal)}
        state={modal}
        busy={busy}
        text={text}
        direction={direction}
        locale={aggregate?.ui?.locale ?? 'en'}
        onClose={() => setModal(null)}
        onSubmit={run}
      />
    </div>
  );
}
