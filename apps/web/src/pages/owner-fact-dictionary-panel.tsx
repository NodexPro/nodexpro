import { EmptyState } from '../templates/template-1/components/EmptyState';
import { ActionToolbar, btnCompactMuted, labelFromActionKey, type AggregateAction } from './owner-legal-control-panel-actions';
import { asArray, ownerLegalControlStatusBadgeLabel } from './owner-legal-control-render-safety';
import {
  emptyFactDictionaryAggregate,
  type OwnerFactDictionaryAggregate,
  type OwnerTaxFactDefinition,
  type OwnerTaxFactDictionaryAllowedAction,
  type UnknownRecord,
} from './owner-legal-control-types';

const SCHEMA_NOT_APPLIED = 'fact_dictionary_schema_not_applied';

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

function parseAllowedActions(raw: unknown): OwnerTaxFactDictionaryAllowedAction[] {
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

function parseDefinition(row: UnknownRecord): OwnerTaxFactDefinition {
  return {
    id: asString(row.id),
    fact_key: asString(row.fact_key),
    country_code: asNullableString(row.country_code),
    scope: asString(row.scope) === 'country' ? 'country' : 'global',
    status: asString(row.status),
    semantic_title: asString(row.semantic_title),
    owner_note: asNullableString(row.owner_note),
    retired_at: asNullableString(row.retired_at),
    retired_reason: asNullableString(row.retired_reason),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    versions: asArray<UnknownRecord>(row.versions).map((version) => ({
      id: asString(version.id),
      tax_fact_definition_id: asString(version.tax_fact_definition_id),
      country_code: asNullableString(version.country_code),
      version_no: typeof version.version_no === 'number' ? version.version_no : Number(version.version_no) || 0,
      status: asString(version.status),
      value_type: asString(version.value_type),
      unit_code: asNullableString(version.unit_code),
      currency_policy: asRecord(version.currency_policy),
      validation_json: asRecord(version.validation_json) ?? {},
      definition_checksum: asString(version.definition_checksum),
      checksum_matches: version.checksum_matches !== false,
      effective_from: asString(version.effective_from),
      effective_to: asNullableString(version.effective_to),
      activated_at: asNullableString(version.activated_at),
      retired_at: asNullableString(version.retired_at),
      retired_reason: asNullableString(version.retired_reason),
      created_at: asString(version.created_at),
      enum_options: [],
      allowed_actions: parseAllowedActions(version.allowed_actions),
    })),
    presentations: [],
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

export function parseFactDictionaryAggregate(raw: unknown): OwnerFactDictionaryAggregate {
  const rec = asRecord(raw);
  if (!rec) return emptyFactDictionaryAggregate();
  const selectedScope = asString(rec.selected_scope) === 'country' ? 'country' : 'global';
  return {
    selected_country_code: asNullableString(rec.selected_country_code),
    selected_scope: selectedScope,
    countries: asArray<UnknownRecord>(rec.countries).map((row) => ({
      code: asString(row.code),
      name: asString(row.name),
      status: asString(row.status),
    })),
    definitions: asArray<UnknownRecord>(rec.definitions).map(parseDefinition),
    definition_versions: [],
    enum_options: [],
    presentations: [],
    allowed_actions: parseAllowedActions(rec.allowed_actions),
    implemented_commands: asArray(rec.implemented_commands).filter((item): item is string => typeof item === 'string'),
    value_type_options: asArray<UnknownRecord>(rec.value_type_options).map((row) => ({
      value: asString(row.value),
      label: asString(row.label) || asString(row.value),
    })),
    warnings: asArray(rec.warnings).filter((item): item is string => typeof item === 'string'),
  };
}

function toAggregateAction(action: OwnerTaxFactDictionaryAllowedAction): AggregateAction {
  return {
    action_key: action.action_key,
    enabled: action.enabled,
    payload: action.payload,
  };
}

export function OwnerFactDictionaryPanel({
  factDictionary,
  busy,
  onOpenCommand,
}: {
  factDictionary: OwnerFactDictionaryAggregate;
  busy: boolean;
  onOpenCommand: (command: string, meta: AggregateAction, prefilled: UnknownRecord) => void;
}) {
  const selectedCountryCode = factDictionary.selected_country_code;
  const schemaNotApplied = factDictionary.warnings.includes(SCHEMA_NOT_APPLIED);
  const catalogActions = factDictionary.allowed_actions.map(toAggregateAction);

  return (
    <section className="nx-bsai-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Fact Dictionary</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Canonical fact definitions. Country follows the owner country context. Commands only.
          </p>
        </div>
        <ActionToolbar
          actions={catalogActions}
          disabled={busy}
          onPick={(cmd, meta, pre) => onOpenCommand(cmd, meta, pre)}
        />
      </div>

      {!selectedCountryCode ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No country selected"
            description="Select a country in the owner toolbar to load Fact Dictionary definitions from the owner legal-control aggregate."
          />
        </div>
      ) : null}

      {selectedCountryCode && schemaNotApplied ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="Fact Dictionary schema is not applied" description={SCHEMA_NOT_APPLIED} />
        </div>
      ) : null}

      {selectedCountryCode && !schemaNotApplied ? (
        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Fact key', 'Title', 'Scope', 'Country', 'Status', 'Versions', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {factDictionary.definitions.map((row) => (
                <tr key={row.id}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.fact_key}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.semantic_title}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.scope}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.country_code ?? 'global'}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{asArray(row.versions).length}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {row.allowed_actions.map((action) => {
                        if (!action.action_key || action.enabled === false) return null;
                        return (
                          <button
                            key={`${row.id}:${action.action_key}`}
                            type="button"
                            disabled={busy}
                            style={btnCompactMuted}
                            onClick={() =>
                              onOpenCommand(action.action_key, toAggregateAction(action), {
                                tax_fact_definition_id: row.id,
                                selected_country_code: selectedCountryCode,
                              })
                            }
                          >
                            {labelFromActionKey(action.action_key)}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
              {!factDictionary.definitions.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16 }}>
                    <EmptyState
                      title="No fact definitions"
                      description="The owner legal-control aggregate returned no Fact Dictionary definitions for this country."
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
