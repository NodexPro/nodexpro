/**
 * VAT for NodexPro → office sales (staff licenses, platform catalog).
 * Source of truth: Country Pack Framework owner legal values for the seller country.
 * Does not use the buying office's Country Pack / income draft VAT.
 */

import {
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
  try {
    const ruleset = await resolveOwnerLegalValueRulesetContextForCountry({
      countryCode: PLATFORM_SELLER_COUNTRY,
      effectiveDate: date,
    });
    const version = await resolveLegalValue(
      PLATFORM_SELLER_COUNTRY,
      PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY,
      date,
      ruleset.active_ruleset_id,
    );
    const rate = parseLegalVatRate(version?.value_payload_json);
    if (rate != null && rate >= 0 && rate <= 1) {
      return platformSellerVatFromCountryPackRate(rate);
    }
  } catch {
    /* Country Pack / owner legal value not confirmed — never invent a statutory rate. */
  }
  return unresolvedPlatformSellerVat();
}
