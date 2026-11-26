/**
 * VAT for NodexPro → office sales (staff licenses, platform catalog).
 * Source of truth: Country Pack Framework owner legal values for the seller country.
 * Does not use the buying office's Country Pack / income draft VAT.
 */

import {
  getLegalValueByKey,
  resolveLegalValue,
  resolveOwnerLegalValueRulesetContextForCountry,
} from '../country-pack/legal-value.service.js';
import {
  applyAuthoritativeSellerVat,
  parseLegalVatRate,
  PLATFORM_SELLER_COUNTRY,
  PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY,
  platformSellerVatFromCountryPackRate,
  unresolvedPlatformSellerVat,
  type PlatformSellerVatResolution,
} from './platform-seller-vat.pure.js';

export { applyAuthoritativeSellerVat };

export async function resolvePlatformSellerVat(asOfDate: string): Promise<PlatformSellerVatResolution> {
  const date = asOfDate.trim() || new Date().toISOString().slice(0, 10);
  let rulesetId: string | null = null;
  try {
    const ruleset = await resolveOwnerLegalValueRulesetContextForCountry({
      countryCode: PLATFORM_SELLER_COUNTRY,
      effectiveDate: date,
    });
    rulesetId = ruleset.active_ruleset_id;
  } catch {
    return unresolvedPlatformSellerVat('country_pack_ruleset_missing');
  }
  try {
    const version = await resolveLegalValue(
      PLATFORM_SELLER_COUNTRY,
      PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY,
      date,
      rulesetId,
    );
    const rate = parseLegalVatRate(version?.value_payload_json);
    if (version && rate != null && rate >= 0 && rate <= 1) {
      return platformSellerVatFromCountryPackRate(rate, version.id);
    }
    if (version) return unresolvedPlatformSellerVat('rate_unparseable');
    const legal = await getLegalValueByKey(PLATFORM_SELLER_COUNTRY, PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY);
    return unresolvedPlatformSellerVat(legal ? 'active_version_missing' : 'legal_value_missing');
  } catch {
    return unresolvedPlatformSellerVat('active_version_missing');
  }
}
