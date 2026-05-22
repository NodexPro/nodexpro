/**
 * INC-3.5 — Sync income_issuer_profiles projection from Core org business profile.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { isOrgBusinessProfileCompleteForIncome } from './income-org-business-profile.mapping.js';
import { loadOrgBusinessProfileForIncome } from './income-org-business-profile.js';
export async function syncIncomeIssuerProfileFromOrganization(orgId, opts) {
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
        .select('id, organization_id, display_name, legal_name, tax_id, normalized_income_business_type, country_code, vat_registration_status, default_currency, default_language, business_type_source')
        .single();
    throwIfSupabaseError(error, 'syncIncomeIssuerProfile');
    if (!data) {
        throw new AppError(502, 'Failed to sync income issuer profile', 'INCOME_ISSUER_PROFILE_SYNC_FAILED');
    }
    if (opts?.audit !== false && opts?.actorUserId) {
        await writeAudit({
            organizationId: orgId,
            actorUserId: opts.actorUserId,
            moduleCode: 'income',
            entityType: 'income_issuer_profile',
            entityId: data.id,
            action: AUDIT_ACTIONS.INCOME_ISSUER_PROFILE_SYNCED,
            payload: {
                normalized_income_business_type: core.normalized_business_type,
                legal_entity_type: core.legal_entity_type,
                profile_complete: isOrgBusinessProfileCompleteForIncome(core),
            },
        });
    }
    return data;
}
export async function loadIncomeIssuerProfileProjection(orgId) {
    const { data } = await supabaseAdmin
        .from('income_issuer_profiles')
        .select('id, organization_id, display_name, legal_name, tax_id, normalized_income_business_type, country_code, vat_registration_status, default_currency, default_language, business_type_source')
        .eq('organization_id', orgId)
        .maybeSingle();
    return data ?? null;
}
export async function isIncomeOnboardingComplete(orgId) {
    const core = await loadOrgBusinessProfileForIncome(orgId);
    return isOrgBusinessProfileCompleteForIncome(core);
}
