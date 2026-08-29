import { useEffect, useState, type CSSProperties } from 'react';
import { userFacingApiMessage } from '../api/client';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import type {
  TaxKnowledgeAggregate,
  TaxKnowledgeAllowedAction,
  TaxKnowledgeCountry,
  TaxKnowledgeRule,
  TaxKnowledgeSource,
  UnknownRecord,
} from './owner-legal-control-types';
import { emptyTaxKnowledgeAggregate } from './owner-legal-control-types';
import '../styles/nx-modal.css';
import '../templates/template-1/tokens.css';

const SCHEMA_NOT_APPLIED = 'tax_knowledge_schema_not_applied';

const TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '8px 10px',
  color: '#6b7280',
  fontWeight: 600,
  fontSize: 12,
};

const TD_STYLE: CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
  padding: '8px 10px',
  color: '#111827',
  verticalAlign: 'top',
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

function parseAllowedActions(raw: unknown): TaxKnowledgeAllowedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => {
      const payloadRaw = asRecord(row.payload);
      const payload: Record<string, string> = {};
      if (payloadRaw) {
        for (const [key, val] of Object.entries(payloadRaw)) {
          if (typeof val === 'string') payload[key] = val;
        }
      }
      return {
        action_key: asString(row.action_key),
        enabled: row.enabled !== false,
        payload,
      };
    });
}

function parseCountries(raw: unknown): TaxKnowledgeCountry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.code).trim() !== '')
    .map((row) => ({
      code: asString(row.code),
      name: asString(row.name) || asString(row.code),
      status: asString(row.status),
    }));
}

function parseSources(raw: unknown): TaxKnowledgeSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      source_code: asString(row.source_code),
      title: asString(row.title),
      provenance_type: asString(row.provenance_type),
      issuer: asNullableString(row.issuer),
      citation_ref: asNullableString(row.citation_ref),
      source_url: asNullableString(row.source_url),
      published_on: asNullableString(row.published_on),
      status: asString(row.status),
      owner_note: asNullableString(row.owner_note),
      retired_at: asNullableString(row.retired_at),
      retired_reason: asNullableString(row.retired_reason),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseRules(raw: unknown): TaxKnowledgeRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => {
      const versionsRaw = Array.isArray(row.versions) ? row.versions : [];
      return {
        id: asString(row.id),
        country_code: asString(row.country_code),
        rule_code: asString(row.rule_code),
        title: asString(row.title),
        rule_kind: asString(row.rule_kind),
        status: asString(row.status),
        usage_hint: asNullableString(row.usage_hint),
        owner_note: asNullableString(row.owner_note),
        created_at: asString(row.created_at),
        updated_at: asString(row.updated_at),
        versions: versionsRaw.map(() => ({
          id: '',
          tax_rule_id: '',
          country_code: '',
          version_no: 0,
          status: '',
          country_pack_id: '',
          country_pack_ruleset_id: '',
          effective_from: '',
          effective_to: null,
          payload_json: {},
          payload_checksum: '',
          supersedes_version_id: null,
          created_at: '',
          sources: [],
          legal_value_bindings: [],
          relationships: [],
          allowed_actions: [],
        })),
        allowed_actions: parseAllowedActions(row.allowed_actions),
      };
    });
}

export function parseTaxKnowledgeAggregate(raw: unknown): TaxKnowledgeAggregate {
  const rec = asRecord(raw);
  if (!rec) return emptyTaxKnowledgeAggregate();

  const selectedRaw = rec.selected_country_code;
  const selected =
    typeof selectedRaw === 'string' && /^[A-Za-z]{2}$/.test(selectedRaw.trim())
      ? selectedRaw.trim().toUpperCase()
      : null;

  return {
    selected_country_code: selected,
    countries: parseCountries(rec.countries),
    sources: parseSources(rec.sources),
    rules: parseRules(rec.rules),
    rule_versions: [],
    allowed_actions: parseAllowedActions(rec.allowed_actions),
    implemented_commands: Array.isArray(rec.implemented_commands)
      ? rec.implemented_commands.filter((item): item is string => typeof item === 'string')
      : [],
    warnings: Array.isArray(rec.warnings)
      ? rec.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function catalogAction(
  actions: TaxKnowledgeAllowedAction[],
  actionKey: 'create_tax_source' | 'create_tax_rule',
): TaxKnowledgeAllowedAction | null {
  return actions.find((action) => action.action_key === actionKey) ?? null;
}

function omitBlank(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

type CreateKind = 'create_tax_source' | 'create_tax_rule' | null;

export function OwnerTaxKnowledgePanel({
  taxKnowledge,
  pendingCountryCode,
  busy,
  onSelectCountry,
  onCommand,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  pendingCountryCode: string | null;
  busy: boolean;
  onSelectCountry: (countryCode: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const selectedCountryCode = taxKnowledge.selected_country_code;
  const selectValue = pendingCountryCode ?? selectedCountryCode ?? '';
  const schemaNotApplied = taxKnowledge.warnings.includes(SCHEMA_NOT_APPLIED);
  const createSourceAction = catalogAction(taxKnowledge.allowed_actions, 'create_tax_source');
  const createRuleAction = catalogAction(taxKnowledge.allowed_actions, 'create_tax_rule');
  const createSourceAllowed = createSourceAction?.enabled === true;
  const createRuleAllowed = createRuleAction?.enabled === true;

  const [createKind, setCreateKind] = useState(null as CreateKind);
  const [formError, setFormError] = useState('');
  const [sourceForm, setSourceForm] = useState({
    source_code: '',
    title: '',
    provenance_type: '',
    issuer: '',
    citation_ref: '',
    source_url: '',
    published_on: '',
    owner_note: '',
  });
  const [ruleForm, setRuleForm] = useState({
    rule_code: '',
    title: '',
    usage_hint: '',
    owner_note: '',
  });

  useEffect(() => {
    if (!createKind) return;
    setFormError('');
    setSourceForm({
      source_code: '',
      title: '',
      provenance_type: '',
      issuer: '',
      citation_ref: '',
      source_url: '',
      published_on: '',
      owner_note: '',
    });
    setRuleForm({ rule_code: '', title: '', usage_hint: '', owner_note: '' });
  }, [createKind]);

  async function submitCreate(): Promise<void> {
    if (!selectedCountryCode) {
      setFormError('Select a country first.');
      return;
    }
    setFormError('');
    try {
      if (createKind === 'create_tax_source') {
        if (!createSourceAction?.enabled) return;
        const required = omitBlank({
          country_code: selectedCountryCode,
          source_code: sourceForm.source_code,
          title: sourceForm.title,
          provenance_type: sourceForm.provenance_type,
        });
        if (!required.source_code || !required.title || !required.provenance_type) {
          setFormError('source_code, title, and provenance_type are required.');
          return;
        }
        await onCommand('create_tax_source', {
          ...required,
          ...omitBlank({
            issuer: sourceForm.issuer,
            citation_ref: sourceForm.citation_ref,
            source_url: sourceForm.source_url,
            published_on: sourceForm.published_on,
            owner_note: sourceForm.owner_note,
          }),
        });
      } else if (createKind === 'create_tax_rule') {
        if (!createRuleAction?.enabled) return;
        const required = omitBlank({
          country_code: selectedCountryCode,
          rule_code: ruleForm.rule_code,
          title: ruleForm.title,
        });
        if (!required.rule_code || !required.title) {
          setFormError('rule_code and title are required.');
          return;
        }
        await onCommand('create_tax_rule', {
          ...required,
          ...omitBlank({
            usage_hint: ruleForm.usage_hint,
            owner_note: ruleForm.owner_note,
          }),
        });
      } else {
        return;
      }
      setCreateKind(null);
    } catch (e) {
      setFormError(userFacingApiMessage(e));
    }
  }

  return (
    <SectionCard
      style={{
        marginTop: 18,
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Tax Knowledge</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Canonical legal sources and rules. Country-scoped. Commands only.
          </p>
        </div>
        <label className="nx-field" style={{ minWidth: 220 }}>
          <span className="nx-field-label">Country</span>
          <select
            className="nx-select"
            value={selectValue}
            disabled={busy}
            onChange={(e) => onSelectCountry(e.target.value)}
          >
            <option value="">Select country</option>
            {taxKnowledge.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.code} — {country.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedCountryCode ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#374151' }}>
          Selected country: <strong>{selectedCountryCode}</strong>
        </p>
      ) : null}

      {taxKnowledge.warnings.length ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: '#fff8e6',
            border: '1px solid #f0d090',
            color: '#92400e',
          }}
        >
          <strong>Tax Knowledge warnings</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {taxKnowledge.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !createSourceAllowed}
          onClick={() => setCreateKind('create_tax_source')}
        >
          Create tax source
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !createRuleAllowed}
          onClick={() => setCreateKind('create_tax_rule')}
        >
          Create tax rule
        </button>
      </div>

      {!selectedCountryCode ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No country selected"
            description="Select a country to load Tax Knowledge sources and rules from the owner legal-control aggregate."
          />
        </div>
      ) : null}

      {selectedCountryCode && schemaNotApplied ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="Tax Knowledge schema is not applied" description={SCHEMA_NOT_APPLIED} />
        </div>
      ) : null}

      {selectedCountryCode && !schemaNotApplied ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Sources</h3>
            {taxKnowledge.sources.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>source_code</th>
                      <th style={TH_STYLE}>title</th>
                      <th style={TH_STYLE}>provenance_type</th>
                      <th style={TH_STYLE}>status</th>
                      <th style={TH_STYLE}>issuer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxKnowledge.sources.map((row) => (
                      <tr key={row.id || row.source_code}>
                        <td style={TD_STYLE}>{row.source_code}</td>
                        <td style={TD_STYLE}>{row.title}</td>
                        <td style={TD_STYLE}>{row.provenance_type}</td>
                        <td style={TD_STYLE}>{row.status}</td>
                        <td style={TD_STYLE}>{row.issuer ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No sources" description="No tax sources for this country." />
            )}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Rules</h3>
            {taxKnowledge.rules.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>rule_code</th>
                      <th style={TH_STYLE}>title</th>
                      <th style={TH_STYLE}>rule_kind</th>
                      <th style={TH_STYLE}>status</th>
                      <th style={TH_STYLE}>versions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxKnowledge.rules.map((row) => (
                      <tr key={row.id || row.rule_code}>
                        <td style={TD_STYLE}>{row.rule_code}</td>
                        <td style={TD_STYLE}>{row.title}</td>
                        <td style={TD_STYLE}>{row.rule_kind}</td>
                        <td style={TD_STYLE}>{row.status}</td>
                        <td style={TD_STYLE}>{row.versions.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No rules" description="No tax rules for this country." />
            )}
          </div>
        </div>
      ) : null}

      {createKind ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setCreateKind(null);
          }}
        >
          <div
            className="nx-modal nx-accounting-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={createKind === 'create_tax_source' ? 'Create tax source' : 'Create tax rule'}
            style={{ direction: 'ltr', maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked" style={{ alignItems: 'flex-start' }}>
                <h2 className="nx-modal-title" style={{ fontSize: 18 }}>
                  {createKind === 'create_tax_source' ? 'Create tax source' : 'Create tax rule'}
                </h2>
                <span className="nx-modal-subtitle">
                  {createKind} · country {selectedCountryCode || '—'}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setCreateKind(null)}
                disabled={busy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="nx-modal-body" style={{ flex: '0 1 auto' }}>
              {formError ? <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 0 }}>{formError}</p> : null}
              {createKind === 'create_tax_source' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">source_code</span>
                    <input
                      className="nx-input"
                      value={sourceForm.source_code}
                      onChange={(e) => setSourceForm((s) => ({ ...s, source_code: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">title</span>
                    <input
                      className="nx-input"
                      value={sourceForm.title}
                      onChange={(e) => setSourceForm((s) => ({ ...s, title: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">provenance_type</span>
                    <input
                      className="nx-input"
                      value={sourceForm.provenance_type}
                      onChange={(e) => setSourceForm((s) => ({ ...s, provenance_type: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">issuer</span>
                    <input
                      className="nx-input"
                      value={sourceForm.issuer}
                      onChange={(e) => setSourceForm((s) => ({ ...s, issuer: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">citation_ref</span>
                    <input
                      className="nx-input"
                      value={sourceForm.citation_ref}
                      onChange={(e) => setSourceForm((s) => ({ ...s, citation_ref: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">source_url</span>
                    <input
                      className="nx-input"
                      value={sourceForm.source_url}
                      onChange={(e) => setSourceForm((s) => ({ ...s, source_url: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">published_on</span>
                    <input
                      className="nx-input"
                      type="date"
                      value={sourceForm.published_on}
                      onChange={(e) => setSourceForm((s) => ({ ...s, published_on: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">owner_note</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={sourceForm.owner_note}
                      onChange={(e) => setSourceForm((s) => ({ ...s, owner_note: e.target.value }))}
                    />
                  </label>
                </div>
              ) : (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">rule_code</span>
                    <input
                      className="nx-input"
                      value={ruleForm.rule_code}
                      onChange={(e) => setRuleForm((s) => ({ ...s, rule_code: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">title</span>
                    <input
                      className="nx-input"
                      value={ruleForm.title}
                      onChange={(e) => setRuleForm((s) => ({ ...s, title: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">usage_hint</span>
                    <input
                      className="nx-input"
                      value={ruleForm.usage_hint}
                      onChange={(e) => setRuleForm((s) => ({ ...s, usage_hint: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">owner_note</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={ruleForm.owner_note}
                      onChange={(e) => setRuleForm((s) => ({ ...s, owner_note: e.target.value }))}
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                disabled={busy}
                onClick={() => setCreateKind(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                disabled={busy}
                onClick={() => void submitCreate()}
              >
                {busy ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
