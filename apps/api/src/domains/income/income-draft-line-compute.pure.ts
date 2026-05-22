import type { IncomeDraftLineRecord } from './income-document-draft-lines.pure.js';
import type { IncomeDraftLineCurrency } from './income-draft-exchange-rate.pure.js';
import { resolveDraftExchangeRateToIls } from './income-draft-exchange-rate.pure.js';
import type { IncomeDraftVatResolution } from './income-draft-vat-fallback.pure.js';
import type { IncomeDocumentSettings } from './income-document-draft-totals.pure.js';

export type LineVatRateCode = 'standard' | 'exempt';

export type ComputedDraftLineAmounts = {
  line_subtotal_foreign: number | null;
  line_vat_foreign: number | null;
  line_total_foreign: number | null;
  line_net_ils: number | null;
  line_vat_ils: number | null;
  line_total_ils: number | null;
  exchange_rate_effective: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function effectiveVatRate(
  lineVatCode: LineVatRateCode,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
): number {
  const code = lineVatCode === 'exempt' || settings.vat_mode === 'exempt' ? 'exempt' : lineVatCode;
  if (code === 'exempt') return 0;
  if (settings.vat_mode === 'zero') return 0;
  return vatResolution.standard_rate;
}

export function computeDraftLineAmounts(
  line: IncomeDraftLineRecord,
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate: string,
): ComputedDraftLineAmounts {
  const fx = resolveDraftExchangeRateToIls(
    line.currency,
    documentDate,
    line.exchange_rate_to_ils_override,
  );
  const qty = line.quantity;
  const unit = line.unit_price_reference;
  if (unit == null || !Number.isFinite(unit) || qty <= 0) {
    return {
      line_subtotal_foreign: null,
      line_vat_foreign: null,
      line_total_foreign: null,
      line_net_ils: null,
      line_vat_ils: null,
      line_total_ils: null,
      exchange_rate_effective: fx.rate_to_ils,
    };
  }

  const gross = round2(qty * unit);
  const rate = effectiveVatRate(line.vat_rate_code, settings, vatResolution);

  let net: number;
  let vat: number;
  if (rate <= 0) {
    net = gross;
    vat = 0;
  } else if (line.price_includes_vat) {
    net = round2(gross / (1 + rate));
    vat = round2(gross - net);
  } else {
    net = gross;
    vat = round2(net * rate);
  }

  const totalForeign = round2(net + vat);
  const netIls = round2(net * fx.rate_to_ils);
  const vatIls = round2(vat * fx.rate_to_ils);
  const totalIls = round2(totalForeign * fx.rate_to_ils);

  return {
    line_subtotal_foreign: net,
    line_vat_foreign: vat,
    line_total_foreign: totalForeign,
    line_net_ils: netIls,
    line_vat_ils: vatIls,
    line_total_ils: totalIls,
    exchange_rate_effective: fx.rate_to_ils,
  };
}

export function recomputeDraftLineAmounts(
  lines: IncomeDraftLineRecord[],
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate: string,
): IncomeDraftLineRecord[] {
  return lines.map((line) => {
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, documentDate);
    return {
      ...line,
      amount_reference: amounts.line_total_ils,
    };
  });
}
