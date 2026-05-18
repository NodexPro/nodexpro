/**
 * Core org business profile → Income (read from store).
 */
import { supabaseAdmin } from '../../db/client.js';
import { mapLegalEntityTypeToIncomeBusinessType, } from './income-org-business-profile.mapping.js';
export { isOrgBusinessProfileCompleteForIncome, mapLegalEntityTypeToIncomeBusinessType, } from './income-org-business-profile.mapping.js';
export async function loadOrgBusinessProfileForIncome(orgId) {
    const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id, name, legal_name, country_code')
        .eq('id', orgId)
        .single();
    const { data: settings } = await supabaseAdmin
        .from('organization_settings')
        .select('organization_name, legal_entity_type, legal_id_number, vat_registration_status, default_currency, default_document_language, country')
        .eq('organization_id', orgId)
        .maybeSingle();
    const orgRow = org;
    const s = settings;
    const country_code = String(orgRow?.country_code ?? s?.country ?? 'IL')
        .trim()
        .toUpperCase() || 'IL';
    const legal_entity_type = s?.legal_entity_type ?? null;
    const legal_business_name = s?.organization_name?.trim() ||
        orgRow?.legal_name?.trim() ||
        orgRow?.name?.trim() ||
        null;
    return {
        organization_id: orgId,
        legal_business_name,
        legal_name: orgRow?.legal_name?.trim() || null,
        legal_entity_type,
        tax_id: s?.legal_id_number?.trim() || null,
        country_code,
        vat_registration_status: s?.vat_registration_status ?? null,
        default_currency: String(s?.default_currency ?? 'ILS').trim() || 'ILS',
        default_document_language: String(s?.default_document_language ?? 'he').trim() === 'en' ? 'en' : 'he',
        normalized_business_type: mapLegalEntityTypeToIncomeBusinessType(legal_entity_type),
    };
}
