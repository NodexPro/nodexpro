/**
 * INC-8.5 — Issuer snapshot for income documents (self org vs office client).
 */
import { notFound } from '../../shared/errors.js';
import { buildClientOperationsAddressJson, clientOperationsBusinessTypeDisplayHe, loadClientOperationsCoreClient, mapClientOperationsBusinessTypeForIncomeIssuer, } from '../client-operations/client-operations-client-core.read.js';
import { ensureOrgIncomeIssuerProfile } from './income-issuer-context.service.js';
import { loadIncomeIssuerProfileProjection } from './income-issuer-profile-sync.service.js';
import { supabaseAdmin } from '../../db/client.js';
function incomeOrgBusinessTypeLabelHe(code) {
    if (!code)
        return null;
    const map = {
        osek_patur: 'עוסק פטור',
        osek_murshe: 'עוסק מורשה',
        company: 'חברה',
        nonprofit: 'עמותה',
    };
    return map[code] ?? code;
}
export async function buildIncomeIssuerSnapshotForScope(scope) {
    if (scope.acting_mode === 'office_representative' && scope.represented_client_id) {
        const core = await loadClientOperationsCoreClient(scope.org_id, scope.represented_client_id);
        if (!core)
            throw notFound('Client not found for issuer snapshot');
        const businessTypeNorm = mapClientOperationsBusinessTypeForIncomeIssuer(core.business_type);
        return {
            source: 'client_operations_core',
            acting_mode: scope.acting_mode,
            issuer_business_id: scope.issuer_business_id,
            represented_client_id: scope.represented_client_id,
            display_name: core.display_name,
            legal_name: null,
            tax_id: core.tax_id,
            business_type: businessTypeNorm,
            business_type_label: clientOperationsBusinessTypeDisplayHe(core.business_type),
            address_json: buildClientOperationsAddressJson(core.address, core.city),
            phone: core.phone,
            email: core.email,
            country_code: 'IL',
            vat_registration_status: null,
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
            email: null,
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
        business_type_label: incomeOrgBusinessTypeLabelHe(profile.normalized_income_business_type),
        address_json,
        phone: s?.phone ?? null,
        email: null,
        country_code: profile.country_code ?? 'IL',
        vat_registration_status: profile.vat_registration_status,
    };
}
