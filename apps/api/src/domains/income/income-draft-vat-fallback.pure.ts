/** IL fallback when Country Pack has no active legal value (current statutory rate). */
export const IL_DRAFT_VAT_FALLBACK_RATE = 0.18;

export type IncomeDraftVatResolution = {
  standard_rate: number;
  standard_rate_percent_label: string;
  standard_vat_mode_option_label: string;
  source: 'country_pack' | 'fallback_il';
  legal_value_key: string | null;
};

function formatPercentLabel(rate: number): string {
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

function resolutionFromRate(
  rate: number,
  source: IncomeDraftVatResolution['source'],
  key: string | null,
): IncomeDraftVatResolution {
  const pctLabel = formatPercentLabel(rate);
  return {
    standard_rate: rate,
    standard_rate_percent_label: pctLabel,
    standard_vat_mode_option_label: `מע״מ רגיל (${pctLabel})`,
    source,
    legal_value_key: key,
  };
}

/** Synchronous IL fallback when org/ruleset resolution is not available. */
export function incomeDraftVatFallbackResolution(): IncomeDraftVatResolution {
  return resolutionFromRate(IL_DRAFT_VAT_FALLBACK_RATE, 'fallback_il', null);
}
