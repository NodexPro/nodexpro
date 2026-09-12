import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import {
  normalizeOwnerLegalCountryCode,
  uniqueCountryCodes,
} from './owner-country-legal-access.pure.js';
import { OWNER_LEGAL_ACCESS_ERROR_CODES } from './owner-country-legal-access.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalUuid(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const id = value.trim();
  return UUID_RE.test(id) ? id : null;
}

async function loadCountryFromRow(
  table: string,
  id: string,
  notFoundMessage: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from(table).select('id, country_code').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound(notFoundMessage);
  const code = typeof data.country_code === 'string' ? data.country_code.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

async function loadCountryViaParent(
  table: string,
  id: string,
  parentIdField: string,
  parentTable: string,
  notFoundMessage: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from(table).select(`id, ${parentIdField}`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound(notFoundMessage);
  const row = data as unknown as Record<string, unknown>;
  const parentId = typeof row[parentIdField] === 'string' ? String(row[parentIdField]) : '';
  if (!parentId) throw notFound(notFoundMessage);
  return loadCountryFromRow(parentTable, parentId, notFoundMessage);
}

function assertPayloadCountryAgrees(entityCountry: string | null, payload: Record<string, unknown>): string | null {
  const payloadCountry = normalizeOwnerLegalCountryCode(payload.country_code);
  if (entityCountry && payloadCountry && entityCountry !== payloadCountry) {
    throw forbidden('Country on payload does not match the target entity', OWNER_LEGAL_ACCESS_ERROR_CODES.COUNTRY_MISMATCH);
  }
  return entityCountry ?? payloadCountry;
}

/**
 * Entity-first country resolution. Payload country_code is never trusted when an id is present.
 */
export async function resolveCountryForOwnerLegalCommand(
  command: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (
    command === 'create_tax_source' ||
    command === 'create_tax_rule' ||
    command === 'create_tax_domain' ||
    command === 'create_tax_legal_node_kind'
  ) {
    return normalizeOwnerLegalCountryCode(payload.country_code);
  }
  if (command === 'update_tax_domain_metadata') {
    const id = optionalUuid(payload.tax_domain_id);
    if (!id) throw badRequest('tax_domain_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_domains', id, 'Tax domain not found'), payload);
  }
  if (command === 'create_tax_legal_node') {
    const id = optionalUuid(payload.tax_source_id);
    if (!id) throw badRequest('tax_source_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_sources', id, 'Tax source not found'), payload);
  }
  if (command === 'update_tax_legal_node_metadata') {
    const id = optionalUuid(payload.tax_legal_node_id);
    if (!id) throw badRequest('tax_legal_node_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_legal_nodes', id, 'Legal node not found'), payload);
  }
  if (command === 'link_tax_rule_legal_node') {
    const id = optionalUuid(payload.tax_rule_id);
    if (!id) throw badRequest('tax_rule_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rules', id, 'Tax rule not found'), payload);
  }
  if (command === 'unlink_tax_rule_legal_node') {
    const id = optionalUuid(payload.tax_rule_legal_node_id);
    if (!id) throw badRequest('tax_rule_legal_node_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_rule_legal_nodes', id, 'Tax rule legal node link not found'),
      payload,
    );
  }
  if (command === 'create_tax_rule_version') {
    const id = optionalUuid(payload.tax_rule_id);
    if (!id) throw badRequest('tax_rule_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rules', id, 'Tax rule not found'), payload);
  }
  if (
    command === 'update_tax_rule_version_draft' ||
    command === 'pin_tax_rule_version_source' ||
    command === 'bind_tax_rule_version_legal_value' ||
    command === 'activate_tax_rule_version' ||
    command === 'retire_tax_rule_version' ||
    command === 'close_tax_rule_version_effective_to'
  ) {
    const id = optionalUuid(payload.tax_rule_version_id);
    if (!id) throw badRequest('tax_rule_version_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rule_versions', id, 'Tax rule version not found'), payload);
  }
  if (command === 'supersede_tax_rule_version') {
    const id = optionalUuid(payload.new_tax_rule_version_id) ?? optionalUuid(payload.old_tax_rule_version_id);
    if (!id) throw badRequest('new_tax_rule_version_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rule_versions', id, 'Tax rule version not found'), payload);
  }
  if (command === 'activate_tax_source' || command === 'retire_tax_source' || command === 'update_tax_source_metadata') {
    const id = optionalUuid(payload.tax_source_id);
    if (!id) throw badRequest('tax_source_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_sources', id, 'Tax source not found'), payload);
  }
  if (command === 'update_tax_rule_metadata') {
    const id = optionalUuid(payload.tax_rule_id);
    if (!id) throw badRequest('tax_rule_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rules', id, 'Tax rule not found'), payload);
  }
  if (command === 'unpin_tax_rule_version_source') {
    const id = optionalUuid(payload.tax_rule_version_source_id);
    if (!id) throw badRequest('tax_rule_version_source_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_rule_version_sources', id, 'Tax source citation not found'),
      payload,
    );
  }
  if (command === 'unbind_tax_rule_version_legal_value') {
    const id = optionalUuid(payload.tax_rule_version_legal_value_id);
    if (!id) throw badRequest('tax_rule_version_legal_value_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_rule_version_legal_values', id, 'Legal value binding not found'),
      payload,
    );
  }
  if (command === 'create_tax_rule_relationship' || command === 'create_tax_rule_unresolved_legal_reference') {
    const id = optionalUuid(payload.from_tax_rule_version_id) ?? optionalUuid(payload.tax_rule_version_id);
    if (!id) throw badRequest('tax_rule_version_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_rule_versions', id, 'Tax rule version not found'), payload);
  }
  if (command === 'delete_tax_rule_relationship') {
    const id = optionalUuid(payload.tax_rule_relationship_id);
    if (!id) throw badRequest('tax_rule_relationship_id is required');
    const { data, error } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id, from_tax_rule_version_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Tax rule relationship not found');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_rule_versions', String(data.from_tax_rule_version_id), 'Tax rule version not found'),
      payload,
    );
  }
  if (
    command === 'update_tax_rule_unresolved_legal_reference' ||
    command === 'accept_tax_rule_unresolved_legal_reference' ||
    command === 'discard_tax_rule_unresolved_legal_reference' ||
    command === 'resolve_tax_rule_unresolved_legal_reference'
  ) {
    const id = optionalUuid(payload.tax_rule_unresolved_legal_reference_id);
    if (!id) throw badRequest('tax_rule_unresolved_legal_reference_id is required');
    const { data, error } = await supabaseAdmin
      .from('tax_rule_unresolved_legal_references')
      .select('id, from_tax_rule_version_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Unresolved legal reference not found');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_rule_versions', String(data.from_tax_rule_version_id), 'Tax rule version not found'),
      payload,
    );
  }

  if (command === 'create_tax_fact_definition') {
    return normalizeOwnerLegalCountryCode(payload.country_code);
  }
  if (
    command === 'update_tax_fact_definition_metadata' ||
    command === 'activate_tax_fact_definition' ||
    command === 'retire_tax_fact_definition' ||
    command === 'create_tax_fact_definition_version' ||
    command === 'create_tax_fact_presentation'
  ) {
    const id = optionalUuid(payload.tax_fact_definition_id);
    if (!id) throw badRequest('tax_fact_definition_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_fact_definitions', id, 'Fact definition not found'), payload);
  }
  if (
    command === 'update_tax_fact_definition_version_draft' ||
    command === 'activate_tax_fact_definition_version' ||
    command === 'retire_tax_fact_definition_version' ||
    command === 'close_tax_fact_definition_version_effective_to' ||
    command === 'add_tax_fact_enum_option'
  ) {
    const id = optionalUuid(payload.tax_fact_definition_version_id);
    if (!id) throw badRequest('tax_fact_definition_version_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_fact_definition_versions', id, 'Fact definition version not found'),
      payload,
    );
  }
  if (command === 'update_tax_fact_enum_option' || command === 'remove_tax_fact_enum_option') {
    const id = optionalUuid(payload.tax_fact_enum_option_id);
    if (!id) throw badRequest('tax_fact_enum_option_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryViaParent(
        'tax_fact_enum_options',
        id,
        'tax_fact_definition_version_id',
        'tax_fact_definition_versions',
        'Fact enum option not found',
      ),
      payload,
    );
  }
  if (command === 'update_tax_fact_presentation' || command === 'delete_tax_fact_presentation') {
    const id = optionalUuid(payload.tax_fact_presentation_id);
    if (!id) throw badRequest('tax_fact_presentation_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_fact_presentations', id, 'Fact presentation not found'),
      payload,
    );
  }

  if (command === 'create_tax_strategy' || command === 'create_tax_strategy_exclusive_group') {
    return normalizeOwnerLegalCountryCode(payload.country_code);
  }
  if (command === 'update_tax_strategy_metadata' || command === 'create_tax_strategy_version') {
    const id = optionalUuid(payload.tax_strategy_id);
    if (!id) throw badRequest('tax_strategy_id is required');
    return assertPayloadCountryAgrees(await loadCountryFromRow('tax_strategies', id, 'Tax strategy not found'), payload);
  }
  if (command === 'update_tax_strategy_exclusive_group') {
    const id = optionalUuid(payload.tax_strategy_exclusive_group_id);
    if (!id) throw badRequest('tax_strategy_exclusive_group_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_strategy_exclusive_groups', id, 'Strategy exclusive group not found'),
      payload,
    );
  }
  if (
    command === 'update_tax_strategy_version_draft' ||
    command === 'activate_tax_strategy_version' ||
    command === 'retire_tax_strategy_version' ||
    command === 'close_tax_strategy_version_effective_to' ||
    command === 'pin_tax_strategy_rule' ||
    command === 'pin_tax_strategy_calculation'
  ) {
    const id = optionalUuid(payload.tax_strategy_version_id);
    if (!id) throw badRequest('tax_strategy_version_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_strategy_versions', id, 'Tax strategy version not found'),
      payload,
    );
  }
  if (command === 'supersede_tax_strategy_version') {
    const id = optionalUuid(payload.new_tax_strategy_version_id) ?? optionalUuid(payload.old_tax_strategy_version_id);
    if (!id) throw badRequest('new_tax_strategy_version_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('tax_strategy_versions', id, 'Tax strategy version not found'),
      payload,
    );
  }
  if (command === 'unpin_tax_strategy_rule') {
    const id = optionalUuid(payload.tax_strategy_version_rule_pin_id);
    if (!id) throw badRequest('tax_strategy_version_rule_pin_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryViaParent(
        'tax_strategy_version_rule_pins',
        id,
        'tax_strategy_version_id',
        'tax_strategy_versions',
        'Strategy rule pin not found',
      ),
      payload,
    );
  }
  if (command === 'unpin_tax_strategy_calculation') {
    const id = optionalUuid(payload.tax_strategy_version_calculation_pin_id);
    if (!id) throw badRequest('tax_strategy_version_calculation_pin_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryViaParent(
        'tax_strategy_version_calculation_pins',
        id,
        'tax_strategy_version_id',
        'tax_strategy_versions',
        'Strategy calculation pin not found',
      ),
      payload,
    );
  }

  if (
    command === 'create_legal_value' ||
    command === 'author_country_legal_value' ||
    command === 'update_legal_value_metadata' ||
    command === 'create_legal_value_version' ||
    command === 'update_owner_note' ||
    command === 'update_usage_hint'
  ) {
    return normalizeOwnerLegalCountryCode(payload.country_code);
  }
  if (command === 'pin_legal_value_version_authority') {
    const id = optionalUuid(payload.legal_value_version_id);
    if (!id) throw badRequest('legal_value_version_id is required');
    const { data, error } = await supabaseAdmin
      .from('country_legal_value_versions')
      .select('id, legal_value_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Legal value version not found');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('country_legal_values', String(data.legal_value_id), 'Legal value not found'),
      payload,
    );
  }
  if (command === 'unpin_legal_value_version_authority') {
    const id = optionalUuid(payload.country_legal_value_version_authority_id);
    if (!id) throw badRequest('country_legal_value_version_authority_id is required');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow(
        'country_legal_value_version_authorities',
        id,
        'Legal value version authority not found',
      ),
      payload,
    );
  }
  if (command === 'update_legal_value_version' || command === 'activate_legal_value_version' || command === 'deactivate_legal_value_version') {
    const id = optionalUuid(payload.legal_value_version_id);
    if (!id) throw badRequest('legal_value_version_id is required');
    const { data, error } = await supabaseAdmin
      .from('country_legal_value_versions')
      .select('id, legal_value_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Legal value version not found');
    return assertPayloadCountryAgrees(
      await loadCountryFromRow('country_legal_values', String(data.legal_value_id), 'Legal value not found'),
      payload,
    );
  }

  if (command === 'create_country') {
    return normalizeOwnerLegalCountryCode(payload.code);
  }
  if (command === 'disable_country' || command === 'enable_country' || command === 'update_country_localization') {
    return normalizeOwnerLegalCountryCode(payload.country_code ?? payload.code);
  }

  return normalizeOwnerLegalCountryCode(payload.country_code);
}

export function requestedCountriesFromPayload(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.requested_country_codes)) return uniqueCountryCodes(payload.requested_country_codes);
  if (Array.isArray(payload.country_codes)) return uniqueCountryCodes(payload.country_codes);
  const single = normalizeOwnerLegalCountryCode(payload.country_code);
  return single ? [single] : [];
}
