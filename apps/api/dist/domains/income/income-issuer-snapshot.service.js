/**
 * INC-8.5 — Issuer snapshot for income documents (self org vs office client).
 */
import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import { ensureOrgIncomeIssuerProfile } from './income-issuer-context.service.js';
import { loadIncomeIssuerProfileProjection } from './income-issuer-profile-sync.service.js';
import { normalizeIssuerBusinessType } from './income-document-types.fallback.js';
function businessTypeLabelHe(raw) {
    if (!raw)
        return null;
    const map = {
        osek_patur: 'עוסק פטור',
        osek_murshe: 'עוסק מורשה',
        company: 'חברה',
        nonprofit: 'עמותה',
        unknown: 'לא מוגדר',
    };
    return map[raw] ?? raw;
}
export async function buildIncomeIssuerSnapshotForScope(scope) {
    if (scope.acting_mode === 'office_representative' && scope.represented_client_id) {
        const { data: client, error: cErr } = await supabaseAdmin
            .from('clients')
            .select('id, display_name, legal_name, tax_id, phone, address_json, country_code')
            .eq('organization_id', scope.org_id)
            .eq('id', scope.represented_client_id)
            .maybeSingle();
        if (cErr)
            throw cErr;
        if (!client)
            throw notFound('Client not found for issuer snapshot');
        const { data: profile } = await supabaseAdmin
            .from('client_operational_profiles')
            .select('business_type, vat_registered_flag')
            .eq('organization_id', scope.org_id)
            .eq('client_id', scope.represented_client_id)
            .maybeSingle();
        const businessType = normalizeIssuerBusinessType(profile?.business_type ?? null);
        const vatFlag = profile?.vat_registered_flag;
        const row = client;
        return {
            source: 'core_client_operational',
            acting_mode: scope.acting_mode,
            issuer_business_id: scope.issuer_business_id,
            represented_client_id: scope.represented_client_id,
            display_name: row.legal_name?.trim() || row.display_name,
            legal_name: row.legal_name,
            tax_id: row.tax_id,
            business_type: businessType,
            business_type_label: businessTypeLabelHe(businessType),
            address_json: row.address_json,
            phone: row.phone,
            country_code: row.country_code ?? 'IL',
            vat_registration_status: vatFlag === true ? 'registered' : vatFlag === false ? 'not_registered' : null,
        };
    }
    await ensureOrgIncomeIssuerProfile(scope.org_id);
    const profile = await loadIncomeIssuerProfileProjection(scope.org_id);
    if (!profile) {
        return {
            source: 'income_issuer_profile',
            acting_mode: scope.acting_mode,
            issuer_business_id: scope.issuer_business_id,
            represented_client_id: null,
            display_name: scope.issuer_label,
            legal_name: null,
            tax_id: null,
            business_type: null,
            business_type_label: null,
            address_json: null,
            phone: null,
            country_code: 'IL',
            vat_registration_status: null,
            incomplete: true,
        };
    }
    const { data: settingsRow } = await supabaseAdmin
        .from('organization_settings')
        .select('phone, address_json, address_line_1, city, postal_code')
        .eq('organization_id', scope.org_id)
        .maybeSingle();
    const s = settingsRow;
    const address_json = s?.address_json ??
        (s?.address_line_1 || s?.city
            ? {
                line1: s.address_line_1 ?? undefined,
                city: s.city ?? undefined,
                postal_code: s.postal_code ?? undefined,
            }
            : null);
    return {
        source: 'income_issuer_profile',
        acting_mode: scope.acting_mode,
        issuer_business_id: profile.id,
        represented_client_id: null,
        display_name: profile.display_name,
        legal_name: profile.legal_name,
        tax_id: profile.tax_id,
        business_type: profile.normalized_income_business_type,
        business_type_label: businessTypeLabelHe(profile.normalized_income_business_type),
        address_json,
        phone: s?.phone ?? null,
        country_code: profile.country_code ?? 'IL',
        vat_registration_status: profile.vat_registration_status,
    };
}
