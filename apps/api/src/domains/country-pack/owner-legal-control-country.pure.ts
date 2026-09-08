import { badRequest } from '../../shared/errors.js';

/**
 * Canonical Owner Legal Control country for country-scoped Owner slices.
 * Reuses the existing Tax Knowledge / Strategy request country — not a second selector.
 */
export function normalizeOwnerLegalControlCountryCode(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function resolveOwnerLegalControlSelectedCountry(input: {
  tax_knowledge_country_code?: string | null;
  strategy_engine_country_code?: string | null;
}): string | null {
  const taxKnowledge = normalizeOwnerLegalControlCountryCode(input.tax_knowledge_country_code);
  const strategyEngine = normalizeOwnerLegalControlCountryCode(input.strategy_engine_country_code);
  if (taxKnowledge && strategyEngine && taxKnowledge !== strategyEngine) {
    throw badRequest(
      'Owner Legal Control country must be coherent: tax_knowledge_country_code and strategy_engine_country_code must match',
    );
  }
  return taxKnowledge ?? strategyEngine;
}
