/**
 * F2B1 Tax Advisory workspace — one aggregate GET, named commands only.
 * Does not evaluate tax. Does not stitch Client Operations reads.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { taxAdvisoryClientWorkspace, taxAdvisoryCommands } from '../api/endpoints';

type AllowedAction = {
  action_key: string;
  enabled: boolean;
  reason: string | null;
};

type FactRow = {
  fact_definition_id: string;
  fact_key: string;
  value_type: string;
  answered: boolean;
  value: unknown;
  fact_definition_version_id: string | null;
  pinned_version_not_current: boolean;
  enum_codes: string[];
  presentation: {
    label: string;
    professional_question: string;
    help_text: string | null;
    enum_option_labels: Record<string, string>;
  } | null;
};

type TaxAdvisoryCaseAggregate = {
  aggregate_key: 'tax_advisory_case_aggregate';
  client: { id: string; display_name: string | null; tax_id: string | null };
  country: {
    legal_engine_country_code: string | null;
    case_country_code: string | null;
    client_country_code: string | null;
  };
  current_case: {
    id: string;
    lifecycle_state: string;
    as_of: string;
    workflow_type: string;
    country_code: string;
  } | null;
  allowed_actions: AllowedAction[];
  facts: FactRow[];
  counts: { answered: number; unanswered_available: number };
  evaluation_notice: { message: string };
  warnings: string[];
  errors: string[];
};

type CommandResponse = {
  ok: true;
  command: string;
  refreshed: { aggregate_key: string; aggregate: TaxAdvisoryCaseAggregate };
};

function actionEnabled(aggregate: TaxAdvisoryCaseAggregate | null, key: string): boolean {
  return Boolean(aggregate?.allowed_actions.some((row) => row.action_key === key && row.enabled));
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

export function TaxAdvisoryClientPage() {
  const { clientId } = useParams();
  const [aggregate, setAggregate] = useState<TaxAdvisoryCaseAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiJson<TaxAdvisoryCaseAggregate>(taxAdvisoryClientWorkspace(clientId));
      setAggregate(data);
    } catch (e) {
      setError(userFacingApiMessage(e));
      setAggregate(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCommand = async (command: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const out = await apiJson<CommandResponse>(taxAdvisoryCommands(), {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      });
      setAggregate(out.refreshed.aggregate);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const parseDraftValue = (fact: FactRow, raw: string): unknown => {
    if (fact.value_type === 'boolean') {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return raw;
    }
    if (fact.value_type === 'integer') {
      if (raw.trim() === '') return raw;
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw;
    }
    if (fact.value_type === 'decimal' || fact.value_type === 'percentage') {
      if (raw.trim() === '') return raw;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (fact.value_type === 'money') {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    }
    return raw;
  };

  if (!clientId) return <p>Missing client.</p>;
  if (loading) return <p>Loading Business Setup…</p>;

  return (
    <div style={{ direction: 'rtl', padding: 16, maxWidth: 880 }}>
      <p style={{ marginTop: 0 }}>
        <Link to={`/m/client-operations/clients/${clientId}`}>חזרה לתיק הלקוח</Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Business Setup</h1>
      <p style={{ color: '#4b5563' }}>
        {aggregate?.client.display_name ?? 'Client'} {aggregate?.client.tax_id ? `· ${aggregate.client.tax_id}` : ''}
      </p>
      <p role="status" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: 10, borderRadius: 6 }}>
        {aggregate?.evaluation_notice.message ?? 'No tax evaluation has been run yet'}
      </p>
      {error ? (
        <p role="alert" style={{ color: '#b91c1c', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
      {(aggregate?.warnings ?? []).length ? (
        <ul>
          {aggregate!.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {!aggregate?.current_case ? (
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !actionEnabled(aggregate, 'create_tax_advisory_case')}
          onClick={() =>
            void runCommand('create_tax_advisory_case', {
              client_id: clientId,
              workflow_type: 'business_setup',
            })
          }
        >
          Create Business Setup case
        </button>
      ) : (
        <p>
          Case {aggregate.current_case.lifecycle_state} · {aggregate.current_case.country_code} · as of{' '}
          {aggregate.current_case.as_of}
        </p>
      )}

      <p>
        Answered {aggregate?.counts.answered ?? 0} / available unanswered {aggregate?.counts.unanswered_available ?? 0}
      </p>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {(aggregate?.facts ?? []).map((fact) => {
          const draft = drafts[fact.fact_definition_id] ?? (fact.answered ? formatValue(fact.value) : '');
          return (
            <li
              key={fact.fact_definition_id}
              style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 10 }}
            >
              <div style={{ fontWeight: 700 }}>{fact.presentation?.label || fact.fact_key}</div>
              <div style={{ fontSize: 13, color: '#4b5563' }}>{fact.presentation?.professional_question}</div>
              {fact.pinned_version_not_current ? (
                <div style={{ fontSize: 12, color: '#b45309' }}>Pinned fact version is no longer current</div>
              ) : null}
              {fact.value_type === 'boolean' ? (
                <select
                  value={draft}
                  disabled={busy || !actionEnabled(aggregate, 'set_tax_advisory_case_fact')}
                  onChange={(e) => setDrafts((s) => ({ ...s, [fact.fact_definition_id]: e.target.value }))}
                >
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : fact.value_type === 'enum' ? (
                <select
                  value={draft}
                  disabled={busy || !actionEnabled(aggregate, 'set_tax_advisory_case_fact')}
                  onChange={(e) => setDrafts((s) => ({ ...s, [fact.fact_definition_id]: e.target.value }))}
                >
                  <option value="">—</option>
                  {fact.enum_codes.map((code) => (
                    <option key={code} value={code}>
                      {fact.presentation?.enum_option_labels[code] || code}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft}
                  disabled={busy || !actionEnabled(aggregate, 'set_tax_advisory_case_fact')}
                  onChange={(e) => setDrafts((s) => ({ ...s, [fact.fact_definition_id]: e.target.value }))}
                  placeholder={fact.value_type === 'money' ? '{"amount":0,"currency":"ILS"}' : fact.value_type}
                />
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || !actionEnabled(aggregate, 'set_tax_advisory_case_fact')}
                  onClick={() =>
                    void runCommand('set_tax_advisory_case_fact', {
                      case_id: aggregate?.current_case?.id,
                      fact_definition_id: fact.fact_definition_id,
                      value: parseDraftValue(fact, draft),
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || !fact.answered || !actionEnabled(aggregate, 'clear_tax_advisory_case_fact')}
                  onClick={() =>
                    void runCommand('clear_tax_advisory_case_fact', {
                      case_id: aggregate?.current_case?.id,
                      fact_definition_id: fact.fact_definition_id,
                    })
                  }
                >
                  Clear
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {aggregate?.current_case ? (
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !actionEnabled(aggregate, 'archive_tax_advisory_case')}
          onClick={() =>
            void runCommand('archive_tax_advisory_case', { case_id: aggregate.current_case?.id })
          }
        >
          Archive case
        </button>
      ) : null}
    </div>
  );
}
