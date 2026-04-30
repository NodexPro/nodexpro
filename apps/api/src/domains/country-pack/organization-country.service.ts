import { supabaseAdmin } from '../../db/client.js';
import { conflict, notFound } from '../../shared/errors.js';
import type { OrganizationCountrySettings } from './country-pack.types.js';
import { getCountryPack } from './country-pack.service.js';
import { getRulesetById, resolveActiveRulesetByDate } from './ruleset.service.js';

/**
 * Internal-only organization country-binding resolvers.
 */
export async function getOrganizationCountrySettings(organizationId: string): Promise<OrganizationCountrySettings | null> {
  const { data, error } = await supabaseAdmin
    .from('organization_country_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrganizationCountrySettings | null) ?? null;
}

export async function assertOrganizationCountry(organizationId: string, countryCode: string): Promise<OrganizationCountrySettings> {
  const row = await getOrganizationCountrySettings(organizationId);
  if (!row) throw notFound('Organization country settings not found');
  if (row.country_code !== countryCode) {
    throw conflict('Organization country does not match expected country');
  }
  return row;
}

export async function resolveOrganizationActiveRuleset(
  organizationId: string,
  date: string
): Promise<{ country_code: string; country_pack_id: string | null; ruleset_id: string | null; warning: string | null }> {
  const row = await getOrganizationCountrySettings(organizationId);
  if (!row) {
    // Fallback for orgs without explicit settings: if exactly one enabled pack exists
    // for organization country and it has an active ruleset for the date, resolve it.
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('country_code')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    const orgCountry = (org?.country_code ?? '').trim().toUpperCase();
    if (orgCountry) {
      const { data: packs, error: packsErr } = await supabaseAdmin
        .from('country_packs')
        .select('id')
        .eq('country_code', orgCountry)
        .eq('status', 'enabled');
      if (packsErr) throw packsErr;
      if ((packs ?? []).length === 1) {
        const packId = String(packs![0].id);
        const resolvedForDate = await resolveActiveRulesetByDate(packId, date);
        if (resolvedForDate) {
          return {
            country_code: orgCountry,
            country_pack_id: packId,
            ruleset_id: resolvedForDate.id,
            warning: 'organization_country_settings_auto_fallback_single_pack',
          };
        }
      }
    }
    return {
      country_code: '',
      country_pack_id: null,
      ruleset_id: null,
      warning: 'organization_country_settings_not_configured',
    };
  }

  if (!row.active_country_pack_id) {
    return {
      country_code: row.country_code,
      country_pack_id: null,
      ruleset_id: null,
      warning: 'active_country_pack_not_configured',
    };
  }

  const pack = await getCountryPack(row.active_country_pack_id);
  if (!pack) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'active_country_pack_not_found',
    };
  }

  if (pack.country_code !== row.country_code) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'active_country_pack_country_mismatch',
    };
  }

  if (!row.active_ruleset_id) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'active_ruleset_not_configured',
    };
  }

  const activeRuleset = await getRulesetById(row.active_ruleset_id);
  if (!activeRuleset || activeRuleset.country_pack_id !== row.active_country_pack_id) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'active_ruleset_not_found_or_pack_mismatch',
    };
  }

  if (activeRuleset.status !== 'active') {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'active_ruleset_not_active',
    };
  }

  const resolvedForDate = await resolveActiveRulesetByDate(row.active_country_pack_id, date);
  if (!resolvedForDate) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'no_active_ruleset_for_date',
    };
  }

  if (resolvedForDate.id !== activeRuleset.id) {
    return {
      country_code: row.country_code,
      country_pack_id: row.active_country_pack_id,
      ruleset_id: null,
      warning: 'configured_active_ruleset_not_effective_for_date',
    };
  }

  return {
    country_code: row.country_code,
    country_pack_id: row.active_country_pack_id,
    ruleset_id: activeRuleset.id,
    warning: null,
  };
}

