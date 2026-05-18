/**
 * INC-3 — Income document type availability (Country-Pack-ready; fallback IL rules).
 * TEMPORARY_COUNTRY_PACK_PENDING: legal eligibility via fallback_il until pack exposes income document rules.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import {
  buildAvailableDocumentTypesForBusiness,
  normalizeIssuerBusinessType,
  type IncomeIssuerBusinessType,
} from './income-document-types.fallback.js';
import { mapLegalEntityTypeToIncomeBusinessType } from './income-org-business-profile.mapping.js';
import { loadOrgBusinessProfileForIncome } from './income-org-business-profile.js';
import { loadIncomeIssuerProfileProjection } from './income-issuer-profile-sync.service.js';
import type { IncomeAvailableDocumentType, IncomeDocumentTypeSource, IncomeWorkspaceWarning } from './income.types.js';

export type { IncomeIssuerBusinessType } from './income-document-types.fallback.js';
export {
  assertDocumentTypeEnabled,
  buildAvailableDocumentTypesForBusiness,
  findAvailableDocumentType,
} from './income-document-types.fallback.js';

export async function resolveIssuerBusinessType(
  orgId: string,
  scope: ActiveIncomeIssuerScope,
): Promise<{ business_type: IncomeIssuerBusinessType; raw: string | null }> {
  if (scope.acting_mode === 'office_representative' && scope.represented_client_id) {
    const { data } = await supabaseAdmin
      .from('client_operational_profiles')
      .select('business_type')
      .eq('organization_id', orgId)
      .eq('client_id', scope.represented_client_id)
      .maybeSingle();
    const raw = (data as { business_type?: string | null } | null)?.business_type ?? null;
    return { business_type: normalizeIssuerBusinessType(raw), raw };
  }

  const projection = await loadIncomeIssuerProfileProjection(orgId);
  if (projection?.normalized_income_business_type) {
    const normalized = normalizeIssuerBusinessType(projection.normalized_income_business_type);
    if (normalized !== 'unknown') {
      return {
        business_type: normalized,
        raw: projection.business_type_source ?? projection.normalized_income_business_type,
      };
    }
  }

  const core = await loadOrgBusinessProfileForIncome(orgId);
  if (core.normalized_business_type !== 'unknown') {
    return { business_type: core.normalized_business_type, raw: core.legal_entity_type };
  }
  if (core.legal_entity_type) {
    return {
      business_type: mapLegalEntityTypeToIncomeBusinessType(core.legal_entity_type),
      raw: core.legal_entity_type,
    };
  }

  return { business_type: 'unknown', raw: null };
}

async function resolveOrgCountryCode(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('organizations').select('country_code').eq('id', orgId).single();
  return String((data as { country_code?: string } | null)?.country_code ?? 'IL')
    .trim()
    .toUpperCase() || 'IL';
}

async function tryCountryPackRulesetId(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organization_country_settings')
    .select('active_ruleset_id')
    .eq('organization_id', orgId)
    .maybeSingle();
  const rulesetId = (data as { active_ruleset_id?: string | null } | null)?.active_ruleset_id ?? null;
  return rulesetId && String(rulesetId).trim() ? String(rulesetId) : null;
}

export interface ResolveAvailableDocumentTypesResult {
  available_document_types: IncomeAvailableDocumentType[];
  warnings: IncomeWorkspaceWarning[];
  business_type: IncomeIssuerBusinessType;
  country_code: string;
}

export async function resolveAvailableDocumentTypes(
  orgId: string,
  scope: ActiveIncomeIssuerScope,
): Promise<ResolveAvailableDocumentTypesResult> {
  const country_code = await resolveOrgCountryCode(orgId);
  const ruleset_id = await tryCountryPackRulesetId(orgId);
  const { business_type, raw } = await resolveIssuerBusinessType(orgId, scope);

  const warnings: IncomeWorkspaceWarning[] = [];
  if (business_type === 'unknown') {
    warnings.push({
      code: 'income_business_type_unknown',
      message:
        scope.acting_mode === 'office_representative'
          ? 'Client business type is not set in operational profile. Only quote and deal invoice are enabled until configured.'
          : 'Organization business type is not configured for self issuing. Only quote and deal invoice are enabled until configured.',
    });
    if (!raw && scope.acting_mode === 'office_representative') {
      warnings.push({
        code: 'income_client_profile_incomplete',
        message: 'Set business type on the represented client operational profile to unlock tax documents.',
      });
    }
  }

  const source: IncomeDocumentTypeSource = 'fallback_il';

  const available_document_types = buildAvailableDocumentTypesForBusiness(
    business_type,
    country_code,
    ruleset_id,
    source,
  );

  if (country_code !== 'IL') {
    warnings.push({
      code: 'income_country_fallback',
      message: `Document types use Israel fallback rules until Country Pack defines types for ${country_code}.`,
    });
  }

  return { available_document_types, warnings, business_type, country_code };
}
