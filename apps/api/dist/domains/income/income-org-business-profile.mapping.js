/**
 * Pure Core → Income business profile mapping (no I/O).
 */
import { normalizeIssuerBusinessType } from './income-document-types.fallback.js';
export function mapLegalEntityTypeToIncomeBusinessType(legalEntityType) {
    const code = String(legalEntityType ?? '').trim().toLowerCase();
    if (code === 'exempt_dealer')
        return 'osek_patur';
    if (code === 'registered_dealer')
        return 'osek_murshe';
    if (code === 'company' || code === 'other_corporation')
        return 'company';
    if (code === 'other')
        return 'nonprofit';
    return normalizeIssuerBusinessType(legalEntityType);
}
export function isOrgBusinessProfileCompleteForIncome(profile) {
    const hasName = Boolean(profile.legal_business_name?.trim() || profile.legal_name?.trim());
    const hasEntityType = Boolean(profile.legal_entity_type?.trim());
    const hasCountry = Boolean(profile.country_code?.trim());
    return hasName && hasEntityType && hasCountry && profile.normalized_business_type !== 'unknown';
}
