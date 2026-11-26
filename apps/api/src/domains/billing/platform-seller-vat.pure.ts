/**
 * NodexPro platform-sale VAT — Country Pack / Owner Legal Values for the seller,
 * never the buying office's income/VAT profile.
 */

export const PLATFORM_SELLER_COUNTRY = 'IL';
export const PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY = 'il_standard_vat_rate';

export type PlatformSellerVatUnresolvedReason =
  | 'country_pack_ruleset_missing'
  | 'legal_value_missing'
  | 'active_version_missing'
  | 'rate_unparseable';

export type PlatformSellerVatResolution = {
  seller_country: string;
  seller_context: 'nodexpro_platform';
  standard_rate: number;
  standard_rate_percent_label: string;
  source: 'country_pack' | 'unresolved';
  authoritative: boolean;
  legal_value_key: string | null;
  legal_value_version_id: string | null;
  unresolved_reason: PlatformSellerVatUnresolvedReason | null;
};

export function unresolvedPlatformSellerVat(
  reason: PlatformSellerVatUnresolvedReason = 'active_version_missing',
): PlatformSellerVatResolution {
  return {
    seller_country: PLATFORM_SELLER_COUNTRY,
    seller_context: 'nodexpro_platform',
    standard_rate: 0,
    standard_rate_percent_label: '',
    source: 'unresolved',
    authoritative: false,
    legal_value_key: PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY,
    legal_value_version_id: null,
    unresolved_reason: reason,
  };
}

export function parseLegalVatRate(payload: unknown): number | null {
  if (payload == null) return null;
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    return payload > 1 ? payload / 100 : payload;
  }
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.rate ?? o.value ?? o.percent ?? o.percentage;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw > 1 ? raw / 100 : raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const n = Number(raw.replace('%', '').trim());
      if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

export function platformSellerVatFromCountryPackRate(
  rate: number,
  versionId?: string | null,
): PlatformSellerVatResolution {
  const pct = Math.round(rate * 100);
  return {
    seller_country: PLATFORM_SELLER_COUNTRY,
    seller_context: 'nodexpro_platform',
    standard_rate: rate,
    standard_rate_percent_label: `${pct}%`,
    source: 'country_pack',
    authoritative: true,
    legal_value_key: PLATFORM_SELLER_VAT_LEGAL_VALUE_KEY,
    legal_value_version_id: versionId ?? null,
    unresolved_reason: null,
  };
}

export function applyAuthoritativeSellerVat(vat: PlatformSellerVatResolution): {
  vatRate: number;
  vatPercentLabel: string;
} {
  if (!vat.authoritative || vat.source !== 'country_pack') {
    return { vatRate: 0, vatPercentLabel: '' };
  }
  return { vatRate: vat.standard_rate, vatPercentLabel: vat.standard_rate_percent_label };
}
