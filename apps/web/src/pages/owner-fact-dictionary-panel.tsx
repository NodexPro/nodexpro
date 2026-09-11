import * as React from 'react';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { ActionToolbar, btnCompactMuted, labelFromActionKey, type AggregateAction } from './owner-legal-control-panel-actions';
import { asArray, ownerLegalControlStatusBadgeLabel } from './owner-legal-control-render-safety';
import {
  emptyFactDictionaryAggregate,
  type OwnerFactDictionaryAggregate,
  type OwnerTaxFactDefinition,
  type OwnerTaxFactDefinitionVersion,
  type OwnerTaxFactDictionaryAllowedAction,
  type OwnerTaxFactEnumOption,
  type OwnerTaxFactPresentation,
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asLabelMap(value: unknown): UnknownRecord {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: UnknownRecord = {};
  for (const [key, label] of Object.entries(rec)) {
    if (typeof label === 'string') out[key] = label;
  }
  return out;
}

export function parseAllowedActions(raw: unknown): OwnerTaxFactDictionaryAllowedAction[] {
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
    })
    .filter((row) => Boolean(row.action_key));
}

export function parseEnumOption(row: UnknownRecord): OwnerTaxFactEnumOption {
  return {
    id: asString(row.id),
    tax_fact_definition_version_id: asString(row.tax_fact_definition_version_id),
    code: asString(row.code),
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
    created_at: asString(row.created_at),
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

export function parsePresentation(row: UnknownRecord): OwnerTaxFactPresentation {
  return {
    id: asString(row.id),
    tax_fact_definition_id: asString(row.tax_fact_definition_id),
    country_code: asNullableString(row.country_code),
    locale: asString(row.locale),
    label: asString(row.label),
    professional_question: asString(row.professional_question),
    client_question: asNullableString(row.client_question),
    help_text: asNullableString(row.help_text),
    aliases: asStringArray(row.aliases),
    enum_option_labels: asLabelMap(row.enum_option_labels),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

export function parseVersion(row: UnknownRecord): OwnerTaxFactDefinitionVersion {
  return {
    id: asString(row.id),
    tax_fact_definition_id: asString(row.tax_fact_definition_id),
    country_code: asNullableString(row.country_code),
    version_no: typeof row.version_no === 'number' ? row.version_no : Number(row.version_no) || 0,
    status: asString(row.status),
    value_type: asString(row.value_type),
    unit_code: asNullableString(row.unit_code),
    currency_policy: asRecord(row.currency_policy),
    validation_json: asRecord(row.validation_json) ?? {},
    definition_checksum: asString(row.definition_checksum),
    checksum_matches: row.checksum_matches === true,
    effective_from: asString(row.effective_from),
    effective_to: asNullableString(row.effective_to),
    activated_at: asNullableString(row.activated_at),
    retired_at: asNullableString(row.retired_at),
    retired_reason: asNullableString(row.retired_reason),
    created_at: asString(row.created_at),
    enum_options: asArray<UnknownRecord>(row.enum_options).map(parseEnumOption),
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

export function parseDefinition(row: UnknownRecord, defaultLocale?: string | null): OwnerTaxFactDefinition {
  const presentations = asArray<UnknownRecord>(row.presentations).map(parsePresentation);
  const semanticTitle = asString(row.semantic_title);
  const explicitLabel = asString(row.display_label);
  const loc = (defaultLocale ?? asString(row.display_locale)).trim().toLowerCase();
  const lang = loc.slice(0, 2);
  const matched =
    presentations.find((item) => item.locale === loc) ??
    (lang ? presentations.find((item) => item.locale === lang || item.locale.startsWith(`${lang}-`)) : undefined) ??
    (presentations.length === 1 ? presentations[0] : undefined);
  return {
    id: asString(row.id),
    fact_key: asString(row.fact_key),
    country_code: asNullableString(row.country_code),
    scope: asString(row.scope) === 'country' ? 'country' : 'global',
    status: asString(row.status),
    semantic_title: semanticTitle,
    display_label: explicitLabel || matched?.label || semanticTitle,
    display_locale: asNullableString(row.display_locale) ?? matched?.locale ?? null,
    owner_note: asNullableString(row.owner_note),
    retired_at: asNullableString(row.retired_at),
    retired_reason: asNullableString(row.retired_reason),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    versions: asArray<UnknownRecord>(row.versions).map(parseVersion),
    presentations,
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

export function parseFactDictionaryAggregate(raw: unknown): OwnerFactDictionaryAggregate {
  const rec = asRecord(raw);
  if (!rec) return emptyFactDictionaryAggregate();
  const selectedScope = asString(rec.selected_scope) === 'country' ? 'country' : 'global';
  const locRaw = asRecord(rec.country_localization);
  const countryLocalization = {
    country_code: asNullableString(locRaw?.country_code) ?? asNullableString(rec.selected_country_code),
    default_locale: asNullableString(locRaw?.default_locale),
    supported_locales: asStringArray(locRaw?.supported_locales),
  };
  const definitions = asArray<UnknownRecord>(rec.definitions).map((row) =>
    parseDefinition(row, countryLocalization.default_locale),
  );
  const definitionVersions = definitions.flatMap((definition) => definition.versions);
  const enumOptions = definitionVersions.flatMap((version) => version.enum_options);
  const presentations = definitions.flatMap((definition) => definition.presentations);
  return {
    selected_country_code: asNullableString(rec.selected_country_code),
    selected_scope: selectedScope,
    country_localization: countryLocalization,
    countries: asArray<UnknownRecord>(rec.countries).map((row) => ({
      code: asString(row.code),
      name: asString(row.name),
      status: asString(row.status),
      default_locale: asNullableString(row.default_locale),
      supported_locales: asStringArray(row.supported_locales),
    })),
    definitions,
    definition_versions: definitionVersions.length
      ? definitionVersions
      : asArray<UnknownRecord>(rec.definition_versions).map(parseVersion),
    enum_options: enumOptions.length ? enumOptions : asArray<UnknownRecord>(rec.enum_options).map(parseEnumOption),
    presentations: presentations.length
      ? presentations
      : asArray<UnknownRecord>(rec.presentations).map(parsePresentation),
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

export function ownerFactDictionaryCommandPrefill(input: {
  actionKey: string;
  selectedCountryCode: string | null;
  definition?: OwnerTaxFactDefinition;
  version?: OwnerTaxFactDefinitionVersion;
  enumOption?: OwnerTaxFactEnumOption;
  presentation?: OwnerTaxFactPresentation;
}): UnknownRecord {
  const prefilled: UnknownRecord = {};
  if (input.selectedCountryCode) prefilled.selected_country_code = input.selectedCountryCode;
  if (input.definition) {
    prefilled.tax_fact_definition_id = input.definition.id;
    if (input.actionKey === 'update_tax_fact_definition_metadata') {
      prefilled.semantic_title = input.definition.semantic_title;
      prefilled.owner_note = input.definition.owner_note ?? '';
    }
  }
  if (input.version) {
    prefilled.tax_fact_definition_version_id = input.version.id;
    if (input.actionKey === 'update_tax_fact_definition_version_draft') {
      prefilled.value_type = input.version.value_type;
      prefilled.unit_code = input.version.unit_code ?? '';
      prefilled.currency_policy = input.version.currency_policy;
      prefilled.validation_json = input.version.validation_json;
      prefilled.effective_from = input.version.effective_from;
      prefilled.effective_to = input.version.effective_to ?? '';
    }
  }
  if (input.enumOption) {
    prefilled.tax_fact_enum_option_id = input.enumOption.id;
    if (input.actionKey === 'update_tax_fact_enum_option') {
      prefilled.code = input.enumOption.code;
      prefilled.sort_order = input.enumOption.sort_order;
    }
  }
  if (input.presentation) {
    prefilled.tax_fact_presentation_id = input.presentation.id;
    if (input.actionKey === 'update_tax_fact_presentation') {
      prefilled.country_code = input.presentation.country_code ?? '';
      prefilled.locale = input.presentation.locale;
      prefilled.label = input.presentation.label;
      prefilled.professional_question = input.presentation.professional_question;
      prefilled.client_question = input.presentation.client_question ?? '';
      prefilled.help_text = input.presentation.help_text ?? '';
      prefilled.aliases = input.presentation.aliases;
      prefilled.enum_option_labels = input.presentation.enum_option_labels;
    }
  }
  return prefilled;
}

function displayText(value: string | null | undefined, empty = '—'): string {
  const next = typeof value === 'string' ? value.trim() : '';
  return next || empty;
}

function currencyPolicyText(policy: UnknownRecord | null): string {
  if (!policy) return '—';
  const required = policy.required === true ? 'required' : policy.required === false ? 'optional' : '';
  const currencies = Array.isArray(policy.allowed_currencies)
    ? policy.allowed_currencies.filter((item): item is string => typeof item === 'string').join(', ')
    : '';
  if (required && currencies) return `${required}; ${currencies}`;
  if (required) return required;
  if (currencies) return currencies;
  return '—';
}

function validationKeysText(validation: UnknownRecord): string {
  const keys = Object.keys(validation);
  return keys.length ? keys.join(', ') : 'none';
}

function presentationLabelText(labels: UnknownRecord): string {
  const entries = Object.entries(labels).filter(([, label]) => typeof label === 'string') as Array<[string, string]>;
  if (!entries.length) return '—';
  return entries.map(([code, label]) => `${code}: ${label}`).join('; ');
}

function FactDictionaryActions({
  actions,
  busy,
  onOpen,
}: {
  actions: OwnerTaxFactDictionaryAllowedAction[];
  busy: boolean;
  onOpen: (action: OwnerTaxFactDictionaryAllowedAction) => void;
}) {
  return (
    <div className="nx-bsai-action-row">
      {actions.map((action) => (
        <button
          key={action.action_key}
          type="button"
          disabled={busy || action.enabled === false}
          style={btnCompactMuted}
          data-action-key={action.action_key}
          onClick={() => onOpen(action)}
        >
          {labelFromActionKey(action.action_key)}
        </button>
      ))}
    </div>
  );
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
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState<string | null>(null);
  const selectedDefinition =
    factDictionary.definitions.find((row) => row.id === selectedDefinitionId) ?? factDictionary.definitions[0] ?? null;

  function openAction(
    action: OwnerTaxFactDictionaryAllowedAction,
    context: {
      definition?: OwnerTaxFactDefinition;
      version?: OwnerTaxFactDefinitionVersion;
      enumOption?: OwnerTaxFactEnumOption;
      presentation?: OwnerTaxFactPresentation;
    },
  ): void {
    onOpenCommand(
      action.action_key,
      toAggregateAction(action),
      ownerFactDictionaryCommandPrefill({
        actionKey: action.action_key,
        selectedCountryCode,
        ...context,
      }),
    );
  }

  return (
    <section className="nx-bsai-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Fact Dictionary</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Canonical client facts from the owner aggregate. Human labels follow the country default locale.
          </p>
        </div>
        <ActionToolbar
          actions={catalogActions}
          disabled={busy}
          onPick={(cmd, meta, pre) =>
            onOpenCommand(cmd, meta, {
              ...pre,
              ...(selectedCountryCode ? { selected_country_code: selectedCountryCode } : {}),
            })
          }
        />
      </div>

      {factDictionary.value_type_options.length ? (
        <p className="nx-bsai-muted" style={{ marginTop: 10 }}>
          Value types from aggregate:{' '}
          {factDictionary.value_type_options.map((row) => row.label || row.value).join(', ')}
        </p>
      ) : null}

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
        <div>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, marginTop: 12 }}>
            <table className="nx-bsai-table">
              <thead>
                <tr>
                  {['Label', 'Fact key', 'Scope', 'Country', 'Status', 'Versions', 'Actions'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factDictionary.definitions.map((row) => (
                  <tr key={row.id} className={selectedDefinition?.id === row.id ? 'is-selected' : undefined}>
                    <td>
                      <button type="button" className="nx-bsai-select-btn" onClick={() => setSelectedDefinitionId(row.id)}>
                        {row.display_label || row.semantic_title}
                      </button>
                    </td>
                    <td className="nx-bsai-muted">{row.fact_key}</td>
                    <td>{row.scope}</td>
                    <td>{row.country_code ?? 'global'}</td>
                    <td>{ownerLegalControlStatusBadgeLabel(row)}</td>
                    <td>{asArray(row.versions).length}</td>
                    <td>
                      <FactDictionaryActions
                        actions={row.allowed_actions}
                        busy={busy}
                        onOpen={(action) => openAction(action, { definition: row })}
                      />
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

          {selectedDefinition ? (
            <div className="nx-bsai-detail">
              <h3>
                {selectedDefinition.display_label || selectedDefinition.semantic_title}
              </h3>
              <p className="nx-bsai-muted">
                Canonical key: {selectedDefinition.fact_key}
                {selectedDefinition.display_locale ? ` · locale ${selectedDefinition.display_locale}` : ''}
                {selectedDefinition.semantic_title ? ` · ${selectedDefinition.semantic_title}` : ''}. Identity status:{' '}
                {ownerLegalControlStatusBadgeLabel(selectedDefinition)}. Scope:{' '}
                {selectedDefinition.scope}. Country: {selectedDefinition.country_code ?? 'global'}.
              </p>

              <h4>Versions</h4>
              {selectedDefinition.versions.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="nx-bsai-subtable">
                    <thead>
                      <tr>
                        {[
                          'Version',
                          'Status',
                          'Effective from',
                          'Effective to',
                          'Value type',
                          'Unit / currency',
                          'Checksum',
                          'Actions',
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDefinition.versions.map((version) => (
                        <tr key={version.id}>
                          <td>{version.version_no}</td>
                          <td>{ownerLegalControlStatusBadgeLabel(version)}</td>
                          <td>{displayText(version.effective_from)}</td>
                          <td>{displayText(version.effective_to)}</td>
                          <td>{displayText(version.value_type)}</td>
                          <td>
                            {displayText(version.unit_code)}
                            {version.value_type === 'money' ? ` / ${currencyPolicyText(version.currency_policy)}` : ''}
                          </td>
                          <td>
                            {displayText(version.definition_checksum)}
                            {version.definition_checksum
                              ? ` (${version.checksum_matches ? 'matches' : 'mismatch'})`
                              : ''}
                          </td>
                          <td>
                            <FactDictionaryActions
                              actions={version.allowed_actions}
                              busy={busy}
                              onOpen={(action) =>
                                openAction(action, { definition: selectedDefinition, version })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No versions"
                  description="This definition has no versions in the owner legal-control aggregate."
                />
              )}

              {selectedDefinition.versions.map((version) =>
                version.value_type === 'enum' || version.enum_options.length ? (
                  <div key={`enum-${version.id}`}>
                    <h4>
                      Enum options — version {version.version_no} (machine codes)
                    </h4>
                    <p className="nx-bsai-muted">
                      Engine identity is the option code. Translated labels belong on presentations.
                    </p>
                    {version.enum_options.length ? (
                      <table className="nx-bsai-subtable">
                        <thead>
                          <tr>
                            {['Code', 'Sort order', 'Actions'].map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {version.enum_options.map((option) => (
                            <tr key={option.id}>
                              <td>{option.code}</td>
                              <td>{option.sort_order}</td>
                              <td>
                                <FactDictionaryActions
                                  actions={option.allowed_actions}
                                  busy={busy}
                                  onOpen={(action) =>
                                    openAction(action, {
                                      definition: selectedDefinition,
                                      version,
                                      enumOption: option,
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <EmptyState
                        title="No enum options"
                        description="This enum version has no options in the owner legal-control aggregate."
                      />
                    )}
                  </div>
                ) : null,
              )}

              <h4>Presentations</h4>
              {selectedDefinition.presentations.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="nx-bsai-subtable">
                    <thead>
                      <tr>
                        {['Locale', 'Label', 'Professional question', 'Client question', 'Enum labels', 'Actions'].map(
                          (h) => (
                            <th key={h}>{h}</th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDefinition.presentations.map((presentation) => (
                        <tr key={presentation.id}>
                          <td>{displayText(presentation.locale)}</td>
                          <td>{displayText(presentation.label)}</td>
                          <td>{displayText(presentation.professional_question)}</td>
                          <td>{displayText(presentation.client_question)}</td>
                          <td>{presentationLabelText(presentation.enum_option_labels)}</td>
                          <td>
                            <FactDictionaryActions
                              actions={presentation.allowed_actions}
                              busy={busy}
                              onOpen={(action) =>
                                openAction(action, { definition: selectedDefinition, presentation })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No presentations"
                  description="This definition has no presentations in the owner legal-control aggregate."
                />
              )}

              {selectedDefinition.versions.some((version) => Object.keys(version.validation_json).length) ? (
                <p className="nx-bsai-muted" style={{ marginTop: 12 }}>
                  Validation keys from aggregate:{' '}
                  {selectedDefinition.versions
                    .map((version) => `v${version.version_no}: ${validationKeysText(version.validation_json)}`)
                    .join('; ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
