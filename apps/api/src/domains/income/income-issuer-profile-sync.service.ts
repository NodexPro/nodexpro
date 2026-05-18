/**
 * INC-3.5 — Sync income_issuer_profiles projection from Core org business profile.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { isOrgBusinessProfileCompleteForIncome } from './income-org-business-profile.mapping.js';
import { loadOrgBusinessProfileForIncome } from './income-org-business-profile.js';

export interface IncomeIssuerProfileRow {
  id: string;
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  normalized_income_business_type: string | null;
  country_code: string | null;
  vat_registration_status: string | null;
  default_currency: string | null;
  default_language: string | null;
  business_type_source: string | null;
}

export async function syncIncomeIssuerProfileFromOrganization(
  orgId: string,
  opts?: { actorUserId?: string | null; audit?: boolean },
): Promise<IncomeIssuerProfileRow> {
  const core = await loadOrgBusinessProfileForIncome(orgId);
  const displayName = core.legal_business_name ?? core.legal_name ?? 'Office';

  const row = {
    organization_id: orgId,
    display_name: displayName,
    legal_name: core.legal_name ?? core.legal_business_name,
    tax_id: core.tax_id,
    normalized_income_business_type: core.normalized_business_type,
    country_code: core.country_code,
    vat_registration_status: core.vat_registration_status,
    default_currency: core.default_currency,
    default_language: core.default_document_language,
    business_type_source: core.legal_entity_type,
  };

  const { data, error } = await supabaseAdmin
    .from('income_issuer_profiles')
    .upsert(row, { onConflict: 'organization_id' })
    .select(
      'id, organization_id, display_name, legal_name, tax_id, normalized_income_business_type, country_code, vat_registration_status, default_currency, default_language, business_type_source',
    )
    .single();

  if (error || !data) throw error ?? new Error('Failed to sync income issuer profile');

  if (opts?.audit !== false && opts?.actorUserId) {
    await writeAudit({
      organizationId: orgId,
      actorUserId: opts.actorUserId,
      moduleCode: 'income',
      entityType: 'income_issuer_profile',
      entityId: (data as IncomeIssuerProfileRow).id,
      action: AUDIT_ACTIONS.INCOME_ISSUER_PROFILE_SYNCED,
      payload: {
        normalized_income_business_type: core.normalized_business_type,
        legal_entity_type: core.legal_entity_type,
        profile_complete: isOrgBusinessProfileCompleteForIncome(core),
      },
    });
  }

  return data as IncomeIssuerProfileRow;
}

export async function loadIncomeIssuerProfileProjection(
  orgId: string,
): Promise<IncomeIssuerProfileRow | null> {
  const { data } = await supabaseAdmin
    .from('income_issuer_profiles')
    .select(
      'id, organization_id, display_name, legal_name, tax_id, normalized_income_business_type, country_code, vat_registration_status, default_currency, default_language, business_type_source',
    )
    .eq('organization_id', orgId)
    .maybeSingle();
  return (data as IncomeIssuerProfileRow | null) ?? null;
}

export async function isIncomeOnboardingComplete(orgId: string): Promise<boolean> {
  const core = await loadOrgBusinessProfileForIncome(orgId);
  return isOrgBusinessProfileCompleteForIncome(core);
}
