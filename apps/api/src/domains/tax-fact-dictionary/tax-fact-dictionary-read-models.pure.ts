import { taxFactDefinitionChecksum } from './tax-fact-dictionary-checksum.pure.js';
import { pickPresentationForLocale } from '../country-pack/country-localization.pure.js';
import {
  FACT_DICTIONARY_SLICE_KEY,
  TAX_FACT_DICTIONARY_COMMANDS,
  TAX_FACT_VALUE_TYPES,
  type OwnerTaxFactDictionaryAllowedAction,
  type TaxFactDictionaryCommandName,
} from './tax-fact-dictionary.types.js';

export { FACT_DICTIONARY_SLICE_KEY };

export type OwnerFactDictionaryCountryDto = {
  code: string;
  name: string;
  status: string;
  default_locale: string | null;
  supported_locales: string[];
};

export type OwnerFactDictionaryLabeledOption = {
  value: string;
  label: string;
};

export type OwnerTaxFactEnumOptionDto = {
  id: string;
  tax_fact_definition_version_id: string;
  code: string;
  sort_order: number;
  created_at: string;
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactPresentationDto = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  locale: string;
  label: string;
  professional_question: string;
  client_question: string | null;
  help_text: string | null;
  aliases: string[];
  enum_option_labels: Record<string, string>;
  created_at: string;
  updated_at: string;
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactDefinitionVersionDto = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  version_no: number;
  status: string;
  value_type: string;
  unit_code: string | null;
  currency_policy: Record<string, unknown> | null;
  validation_json: Record<string, unknown>;
  definition_checksum: string;
  checksum_matches: boolean;
  effective_from: string;
  effective_to: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  enum_options: OwnerTaxFactEnumOptionDto[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactDefinitionDto = {
  id: string;
  fact_key: string;
  country_code: string | null;
  scope: 'global' | 'country';
  status: string;
  semantic_title: string;
  display_label: string;
  display_locale: string | null;
  owner_note: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  updated_at: string;
  versions: OwnerTaxFactDefinitionVersionDto[];
  presentations: OwnerTaxFactPresentationDto[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerFactDictionarySlice = {
  selected_country_code: string | null;
  selected_scope: 'global' | 'country';
  country_localization: {
    country_code: string | null;
    default_locale: string | null;
    supported_locales: string[];
  };
  countries: OwnerFactDictionaryCountryDto[];
  definitions: OwnerTaxFactDefinitionDto[];
  definition_versions: OwnerTaxFactDefinitionVersionDto[];
  enum_options: OwnerTaxFactEnumOptionDto[];
  presentations: OwnerTaxFactPresentationDto[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
  implemented_commands: readonly TaxFactDictionaryCommandName[];
  value_type_options: OwnerFactDictionaryLabeledOption[];
  warnings: string[];
};

function action(
  actionKey: TaxFactDictionaryCommandName,
  enabled: boolean,
  payload: Record<string, string>,
): OwnerTaxFactDictionaryAllowedAction {
  return { action_key: actionKey, enabled, payload };
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeSliceCountry(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Global facts plus the selected Owner country. Other countries are excluded. */
export function ownerFactDictionaryIncludesDefinitionCountry(
  definitionCountryCode: string | null | undefined,
  selectedCountryCode: string | null | undefined,
): boolean {
  const definition = normalizeSliceCountry(definitionCountryCode ?? null);
  const selected = normalizeSliceCountry(selectedCountryCode ?? null);
  if (!selected) return definition == null;
  return definition == null || definition === selected;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asLabelMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
    if (typeof label === 'string') out[key] = label;
  }
  return out;
}

export function factDictionaryCatalogAllowedActions(): OwnerTaxFactDictionaryAllowedAction[] {
  return [
    action('create_tax_fact_definition', true, {
      fact_key: 'snake_case engine key',
      country_code: 'optional ISO-2 or null for global',
      semantic_title: 'string',
      owner_note: 'optional string',
      selected_country_code: 'optional ISO-2 refresh context',
    }),
  ];
}

export function definitionAllowedActions(status: string): OwnerTaxFactDictionaryAllowedAction[] {
  if (status === 'retired') return [];
  const actions: OwnerTaxFactDictionaryAllowedAction[] = [
    action('update_tax_fact_definition_metadata', true, {
      tax_fact_definition_id: 'uuid',
      semantic_title: 'optional string',
      owner_note: 'optional string or null',
    }),
    action('create_tax_fact_definition_version', true, {
      tax_fact_definition_id: 'uuid',
      value_type: TAX_FACT_VALUE_TYPES.join('|'),
      unit_code: 'optional snake_case',
      currency_policy: 'required for money; null otherwise',
      validation_json: 'optional object',
      effective_from: 'YYYY-MM-DD',
      effective_to: 'optional YYYY-MM-DD',
    }),
    action('create_tax_fact_presentation', true, {
      tax_fact_definition_id: 'uuid',
      country_code: 'optional ISO-2 or null',
      locale: 'xx or xx-yy',
      label: 'string',
      professional_question: 'string',
      client_question: 'optional string',
      help_text: 'optional string',
      aliases: 'optional string[]',
      enum_option_labels: 'optional code→label object',
    }),
  ];
  if (status === 'draft') {
    actions.push(
      action('activate_tax_fact_definition', true, {
        tax_fact_definition_id: 'uuid',
      }),
    );
  }
  actions.push(
    action('retire_tax_fact_definition', true, {
      tax_fact_definition_id: 'uuid',
      retired_reason: 'optional string',
    }),
  );
  return actions;
}

export function versionAllowedActions(input: {
  status: string;
  identity_status: string;
  value_type: string;
  enum_option_count: number;
  effective_from: string;
  effective_to: string | null;
}): OwnerTaxFactDictionaryAllowedAction[] {
  if (input.status === 'retired') return [];
  const actions: OwnerTaxFactDictionaryAllowedAction[] = [];
  if (input.status === 'draft') {
    actions.push(
      action('update_tax_fact_definition_version_draft', true, {
        tax_fact_definition_version_id: 'uuid',
        value_type: `optional ${TAX_FACT_VALUE_TYPES.join('|')}`,
        unit_code: 'optional snake_case or null',
        currency_policy: 'optional money object or null',
        validation_json: 'optional object',
        effective_from: 'optional YYYY-MM-DD',
        effective_to: 'optional YYYY-MM-DD or null',
      }),
    );
    if (input.value_type === 'enum') {
      actions.push(
        action('add_tax_fact_enum_option', true, {
          tax_fact_definition_version_id: 'uuid',
          code: 'snake_case',
          sort_order: 'integer >= 0',
        }),
      );
    }
    const enumReady = input.value_type !== 'enum' || input.enum_option_count >= 1;
    actions.push(
      action('activate_tax_fact_definition_version', input.identity_status === 'active' && enumReady, {
        tax_fact_definition_version_id: 'uuid',
      }),
      action('retire_tax_fact_definition_version', true, {
        tax_fact_definition_version_id: 'uuid',
        retired_reason: 'optional string',
      }),
    );
  }
  if (input.status === 'active') {
    const canClose =
      Boolean(input.effective_from) &&
      (input.effective_to == null || input.effective_to === '' || input.effective_to > input.effective_from);
    if (canClose) {
      actions.push(
        action('close_tax_fact_definition_version_effective_to', true, {
          tax_fact_definition_version_id: 'uuid',
          effective_to: 'YYYY-MM-DD',
        }),
      );
    }
    actions.push(
      action('retire_tax_fact_definition_version', true, {
        tax_fact_definition_version_id: 'uuid',
        retired_reason: 'optional string',
      }),
    );
  }
  return actions;
}

export function enumOptionAllowedActions(parentDraft: boolean): OwnerTaxFactDictionaryAllowedAction[] {
  if (!parentDraft) return [];
  return [
    action('update_tax_fact_enum_option', true, {
      tax_fact_enum_option_id: 'uuid',
      code: 'optional snake_case',
      sort_order: 'optional integer >= 0',
    }),
    action('remove_tax_fact_enum_option', true, {
      tax_fact_enum_option_id: 'uuid',
    }),
  ];
}

export function presentationAllowedActions(): OwnerTaxFactDictionaryAllowedAction[] {
  return [
    action('update_tax_fact_presentation', true, {
      tax_fact_presentation_id: 'uuid',
      country_code: 'optional ISO-2 or null',
      locale: 'optional xx or xx-yy',
      label: 'optional string',
      professional_question: 'optional string',
      client_question: 'optional string or null',
      help_text: 'optional string or null',
      aliases: 'optional string[]',
      enum_option_labels: 'optional code→label object',
    }),
    action('delete_tax_fact_presentation', true, {
      tax_fact_presentation_id: 'uuid',
    }),
  ];
}

export function mapEnumOption(row: Record<string, unknown>, parentDraft: boolean): OwnerTaxFactEnumOptionDto {
  return {
    id: String(row.id),
    tax_fact_definition_version_id: String(row.tax_fact_definition_version_id),
    code: String(row.code),
    sort_order: Number(row.sort_order),
    created_at: String(row.created_at),
    allowed_actions: enumOptionAllowedActions(parentDraft),
  };
}

export function mapPresentation(row: Record<string, unknown>): OwnerTaxFactPresentationDto {
  return {
    id: String(row.id),
    tax_fact_definition_id: String(row.tax_fact_definition_id),
    country_code: asOptionalString(row.country_code),
    locale: String(row.locale),
    label: String(row.label),
    professional_question: String(row.professional_question),
    client_question: asOptionalString(row.client_question),
    help_text: asOptionalString(row.help_text),
    aliases: asStringArray(row.aliases),
    enum_option_labels: asLabelMap(row.enum_option_labels),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    allowed_actions: presentationAllowedActions(),
  };
}

export function mapVersion(
  row: Record<string, unknown>,
  identity: { fact_key: string; country_code: string | null; status: string },
  enumOptions: OwnerTaxFactEnumOptionDto[],
): OwnerTaxFactDefinitionVersionDto {
  const valueType = String(row.value_type);
  const unitCode = asOptionalString(row.unit_code);
  const currencyPolicy =
    row.currency_policy && typeof row.currency_policy === 'object' && !Array.isArray(row.currency_policy)
      ? (row.currency_policy as Record<string, unknown>)
      : null;
  const validationJson = asObject(row.validation_json);
  const computed = taxFactDefinitionChecksum({
    fact_key: identity.fact_key,
    country_code: identity.country_code,
    value_type: valueType,
    unit_code: unitCode,
    currency_policy: currencyPolicy,
    validation_json: validationJson,
    enum_codes: enumOptions.map((option) => option.code),
  });
  const stored = String(row.definition_checksum ?? '');
  return {
    id: String(row.id),
    tax_fact_definition_id: String(row.tax_fact_definition_id),
    country_code: asOptionalString(row.country_code),
    version_no: Number(row.version_no),
    status: String(row.status),
    value_type: valueType,
    unit_code: unitCode,
    currency_policy: currencyPolicy,
    validation_json: validationJson,
    definition_checksum: stored,
    checksum_matches: stored === computed,
    effective_from: String(row.effective_from ?? ''),
    effective_to: asOptionalString(row.effective_to),
    activated_at: asOptionalString(row.activated_at),
    retired_at: asOptionalString(row.retired_at),
    retired_reason: asOptionalString(row.retired_reason),
    created_at: String(row.created_at),
    enum_options: enumOptions,
    allowed_actions: versionAllowedActions({
      status: String(row.status),
      identity_status: identity.status,
      value_type: valueType,
      enum_option_count: enumOptions.length,
      effective_from: String(row.effective_from ?? ''),
      effective_to: asOptionalString(row.effective_to),
    }),
  };
}

export function mapDefinition(
  row: Record<string, unknown>,
  versions: OwnerTaxFactDefinitionVersionDto[],
  presentations: OwnerTaxFactPresentationDto[],
  defaultLocale?: string | null,
): OwnerTaxFactDefinitionDto {
  const countryCode = asOptionalString(row.country_code);
  const semanticTitle = String(row.semantic_title);
  const display = pickPresentationForLocale(presentations, defaultLocale ?? null);
  return {
    id: String(row.id),
    fact_key: String(row.fact_key),
    country_code: countryCode,
    scope: countryCode ? 'country' : 'global',
    status: String(row.status),
    semantic_title: semanticTitle,
    display_label: display?.label ?? semanticTitle,
    display_locale: display?.locale ?? null,
    owner_note: asOptionalString(row.owner_note),
    retired_at: asOptionalString(row.retired_at),
    retired_reason: asOptionalString(row.retired_reason),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    versions,
    presentations,
    allowed_actions: definitionAllowedActions(String(row.status)),
  };
}

export function assembleFactDictionarySlice(input: {
  selected_country_code: string | null;
  countries: OwnerFactDictionaryCountryDto[];
  definitions: OwnerTaxFactDefinitionDto[];
  warnings: string[];
}): OwnerFactDictionarySlice {
  const selected = input.countries.find((row) => row.code === input.selected_country_code) ?? null;
  const definitionVersions = input.definitions.flatMap((definition) => definition.versions);
  return {
    selected_country_code: input.selected_country_code,
    selected_scope: input.selected_country_code ? 'country' : 'global',
    country_localization: {
      country_code: input.selected_country_code,
      default_locale: selected?.default_locale ?? null,
      supported_locales: selected?.supported_locales ?? [],
    },
    countries: input.countries,
    definitions: input.definitions,
    definition_versions: definitionVersions,
    enum_options: definitionVersions.flatMap((version) => version.enum_options),
    presentations: input.definitions.flatMap((definition) => definition.presentations),
    allowed_actions: factDictionaryCatalogAllowedActions(),
    implemented_commands: TAX_FACT_DICTIONARY_COMMANDS,
    value_type_options: TAX_FACT_VALUE_TYPES.map((value) => ({ value, label: value })),
    warnings: input.warnings,
  };
}
