export const TAX_FACT_DICTIONARY_COMMANDS = [
  'create_tax_fact_definition',
  'update_tax_fact_definition_metadata',
  'activate_tax_fact_definition',
  'retire_tax_fact_definition',
  'create_tax_fact_definition_version',
  'update_tax_fact_definition_version_draft',
  'activate_tax_fact_definition_version',
  'retire_tax_fact_definition_version',
  'close_tax_fact_definition_version_effective_to',
  'add_tax_fact_enum_option',
  'update_tax_fact_enum_option',
  'remove_tax_fact_enum_option',
  'create_tax_fact_presentation',
  'update_tax_fact_presentation',
  'delete_tax_fact_presentation',
] as const;

export type TaxFactDictionaryCommandName = (typeof TAX_FACT_DICTIONARY_COMMANDS)[number];

export function isTaxFactDictionaryCommand(command: string): command is TaxFactDictionaryCommandName {
  return (TAX_FACT_DICTIONARY_COMMANDS as readonly string[]).includes(command);
}

export type TaxFactDictionaryCommandResponse = {
  ok: true;
  command: TaxFactDictionaryCommandName;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate';
    aggregate: Record<string, unknown>;
  };
};

export const FACT_DICTIONARY_SLICE_KEY = 'fact_dictionary' as const;

export const TAX_FACT_VALUE_TYPES = [
  'boolean',
  'integer',
  'decimal',
  'money',
  'percentage',
  'date',
  'enum',
  'string',
] as const;

export type TaxFactValueType = (typeof TAX_FACT_VALUE_TYPES)[number];

export const RESERVED_FACT_KEY = 'evaluation_as_of';

export const FACT_KEY_SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export type OwnerTaxFactDictionaryAllowedAction = {
  action_key: TaxFactDictionaryCommandName;
  enabled: boolean;
  payload: Record<string, string>;
};
