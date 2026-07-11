/**
 * Tax allocation number policy — Country Pack legal value with IL fallback.
 * TEMPORARY_COUNTRY_PACK_PENDING until owner seeds `il_income_tax_allocation_number_policy`.
 */

import { resolveCountryContext } from '../country-pack/country-pack-resolver.service.js';
import { resolveLegalValue } from '../country-pack/legal-value.service.js';
import {
  defaultIncomeTaxAllocationNumberPolicy,
  IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY,
  parseIncomeTaxAllocationNumberPolicy,
  type IncomeTaxAllocationNumberPolicy,
} from './income-document-allocation-number.pure.js';

export type IncomeTaxAllocationNumberPolicyResolution = IncomeTaxAllocationNumberPolicy & {
  source: 'country_pack' | 'fallback';
  legal_value_key: string;
};

export async function resolveIncomeTaxAllocationNumberPolicyForOrg(
  orgId: string,
  countryCode: string,
  date: string,
): Promise<IncomeTaxAllocationNumberPolicyResolution> {
  const cc = countryCode.trim().toUpperCase() || 'IL';
  const day = date.trim() || new Date().toISOString().slice(0, 10);

  try {
    const ctx = await resolveCountryContext(orgId, day);
    if (ctx.ruleset_id) {
      const version = await resolveLegalValue(
        cc,
        IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY,
        day,
        ctx.ruleset_id,
      );
      const fromVersion = parseIncomeTaxAllocationNumberPolicy(version?.value_payload_json);
      if (version?.value_payload_json) {
        return {
          ...fromVersion,
          source: 'country_pack',
          legal_value_key: IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY,
        };
      }

      const fromMap = parseIncomeTaxAllocationNumberPolicy(
        ctx.resolved_values_map[IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY],
      );
      if (ctx.resolved_values_map[IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY]) {
        return {
          ...fromMap,
          source: 'country_pack',
          legal_value_key: IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY,
        };
      }
    }
  } catch {
    /* fall through */
  }

  return {
    ...defaultIncomeTaxAllocationNumberPolicy(),
    source: 'fallback',
    legal_value_key: IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY,
  };
}
