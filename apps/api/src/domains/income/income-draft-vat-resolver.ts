/**
 * Income wizard draft VAT — resolved from Country Pack legal values with IL fallback.
 * TEMPORARY_COUNTRY_PACK_PENDING: not Accounting Base financial truth; draft preview only.
 */

import { resolveCountryContext } from '../country-pack/country-pack-resolver.service.js';
import { resolveLegalValue } from '../country-pack/legal-value.service.js';
import {
  IL_DRAFT_VAT_FALLBACK_RATE,
  incomeDraftVatFallbackResolution,
  type IncomeDraftVatResolution,
} from './income-draft-vat-fallback.pure.js';

export { IL_DRAFT_VAT_FALLBACK_RATE, incomeDraftVatFallbackResolution, type IncomeDraftVatResolution };

/** Canonical IL legal value key for standard VAT rate (percentage in payload). */
export const IL_STANDARD_VAT_LEGAL_VALUE_KEY = 'il_standard_vat_rate';

function formatPercentLabel(rate: number): string {
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

function parseRateFromLegalPayload(payload: unknown): number | null {
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

function resolutionFromRate(rate: number, source: IncomeDraftVatResolution['source'], key: string | null): IncomeDraftVatResolution {
  const pctLabel = formatPercentLabel(rate);
  return {
    standard_rate: rate,
    standard_rate_percent_label: pctLabel,
    standard_vat_mode_option_label: `מע״מ רגיל (${pctLabel})`,
    source,
    legal_value_key: key,
  };
}

export async function resolveIncomeDraftVatForOrg(
  orgId: string,
  countryCode: string,
  documentDate: string,
): Promise<IncomeDraftVatResolution> {
  const cc = countryCode.trim().toUpperCase() || 'IL';
  const date = documentDate.trim() || new Date().toISOString().slice(0, 10);

  try {
    const ctx = await resolveCountryContext(orgId, date);
    if (ctx.ruleset_id) {
      const version = await resolveLegalValue(cc, IL_STANDARD_VAT_LEGAL_VALUE_KEY, date, ctx.ruleset_id);
      const rate = parseRateFromLegalPayload(version?.value_payload_json);
      if (rate != null && rate >= 0 && rate <= 1) {
        return resolutionFromRate(rate, 'country_pack', IL_STANDARD_VAT_LEGAL_VALUE_KEY);
      }

      const fromMap = ctx.resolved_values_map[IL_STANDARD_VAT_LEGAL_VALUE_KEY];
      const mapRate = parseRateFromLegalPayload(fromMap);
      if (mapRate != null && mapRate >= 0 && mapRate <= 1) {
        return resolutionFromRate(mapRate, 'country_pack', IL_STANDARD_VAT_LEGAL_VALUE_KEY);
      }
    }
  } catch {
    /* fall through to IL fallback */
  }

  if (cc === 'IL') {
    return resolutionFromRate(IL_DRAFT_VAT_FALLBACK_RATE, 'fallback_il', null);
  }

  return resolutionFromRate(IL_DRAFT_VAT_FALLBACK_RATE, 'fallback_il', null);
}
