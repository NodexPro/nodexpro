import type { ResolvedCountryContext } from './country-pack.types.js';
import { resolveOrganizationActiveRuleset } from './organization-country.service.js';
import { supabaseAdmin } from '../../db/client.js';

/**
 * Internal-only resolver orchestrator for backend command/read-model layers.
 * No UI exposure.
 */
export async function resolveCountryContext(organizationId: string, date: string): Promise<ResolvedCountryContext> {
  const base = await resolveOrganizationActiveRuleset(organizationId, date);
  const warnings: string[] = [];
  if (base.warning) warnings.push(base.warning);

  if (!base.country_code || !base.country_pack_id || !base.ruleset_id) {
    return {
      country_code: base.country_code,
      country_pack_id: base.country_pack_id,
      ruleset_id: base.ruleset_id,
      resolved_values_map: {},
      warnings,
    };
  }

  const { data, error } = await supabaseAdmin
    .from('country_legal_value_versions')
    .select('id, legal_value_id, value_payload_json, effective_from, effective_to, status, country_legal_values!inner(value_key, country_code)')
    .eq('country_pack_ruleset_id', base.ruleset_id)
    .eq('status', 'active')
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`);
  if (error) throw error;

  const resolvedValuesMap: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const legalValueJoined = Array.isArray(row.country_legal_values)
      ? row.country_legal_values[0]
      : row.country_legal_values;
    if (!legalValueJoined?.value_key) continue;
    if (legalValueJoined.country_code !== base.country_code) {
      warnings.push(`country_mismatch_for_value_${legalValueJoined.value_key}`);
      continue;
    }
    resolvedValuesMap[legalValueJoined.value_key] = row.value_payload_json;
  }

  return {
    country_code: base.country_code,
    country_pack_id: base.country_pack_id,
    ruleset_id: base.ruleset_id,
    resolved_values_map: resolvedValuesMap,
    warnings,
  };
}

