export function normalizeOwnerCountryCode(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

/** Explicit Owner country from the existing Legal Control query params. */
export function ownerCountryCodeFromSearch(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const tax = normalizeOwnerCountryCode(params.get('tax_knowledge_country_code'));
  const strategy = normalizeOwnerCountryCode(params.get('strategy_engine_country_code'));
  return tax || strategy;
}

export function replaceOwnerLegalControlCountrySearch(search: string, countryCode: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const code = normalizeOwnerCountryCode(countryCode);
  if (code) {
    params.set('tax_knowledge_country_code', code);
    params.set('strategy_engine_country_code', code);
  } else {
    params.delete('tax_knowledge_country_code');
    params.delete('strategy_engine_country_code');
  }
  const next = params.toString();
  return next ? `?${next}` : '';
}

/**
 * Owner selection truth: pending / explicit URL query, then an existing backend
 * selected or default country. Never invents countryOptions[0].
 */
export function resolveOwnerSelectedCountryCode(input: {
  pendingCountryCode?: string | null;
  explicitCountryCode?: string | null;
  backendSelectedCountryCode?: string | null;
  backendDefaultCountryCode?: string | null;
}): string {
  return (
    normalizeOwnerCountryCode(input.pendingCountryCode) ||
    normalizeOwnerCountryCode(input.explicitCountryCode) ||
    normalizeOwnerCountryCode(input.backendSelectedCountryCode) ||
    normalizeOwnerCountryCode(input.backendDefaultCountryCode) ||
    ''
  );
}

export function shouldApplyOwnerLegalControlPanelResponse(input: {
  requestSeq: number;
  latestSeq: number;
  aborted?: boolean;
  requestedCountryCode: string;
  explicitCountryCode: string;
}): boolean {
  if (input.aborted) return false;
  if (input.requestSeq !== input.latestSeq) return false;
  const requested = normalizeOwnerCountryCode(input.requestedCountryCode);
  const explicit = normalizeOwnerCountryCode(input.explicitCountryCode);
  if (explicit && requested && explicit !== requested) return false;
  return true;
}
