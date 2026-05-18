/**
 * Pure Core → Income business profile mapping (no I/O).
 */

import type { IncomeIssuerBusinessType } from './income-document-types.fallback.js';
import { normalizeIssuerBusinessType } from './income-document-types.fallback.js';

export interface OrgBusinessProfileForIncome {
  organization_id: string;
  legal_business_name: string | null;
  legal_name: string | null;
  legal_entity_type: string | null;
  tax_id: string | null;
  country_code: string;
  vat_registration_status: string | null;
  default_currency: string;
  default_document_language: string;
  normalized_business_type: IncomeIssuerBusinessType;
}

export function mapLegalEntityTypeToIncomeBusinessType(
  legalEntityType: string | null | undefined,
): IncomeIssuerBusinessType {
  const code = String(legalEntityType ?? '').trim().toLowerCase();
  if (code === 'exempt_dealer') return 'osek_patur';
  if (code === 'registered_dealer') return 'osek_murshe';
  if (code === 'company' || code === 'other_corporation') return 'company';
  if (code === 'other') return 'nonprofit';
  return normalizeIssuerBusinessType(legalEntityType);
}

export function isOrgBusinessProfileCompleteForIncome(profile: OrgBusinessProfileForIncome): boolean {
  const hasName = Boolean(profile.legal_business_name?.trim() || profile.legal_name?.trim());
  const hasEntityType = Boolean(profile.legal_entity_type?.trim());
  const hasCountry = Boolean(profile.country_code?.trim());
  return hasName && hasEntityType && hasCountry && profile.normalized_business_type !== 'unknown';
}
