import type { IncomeDraftLineRecord } from './income-document-draft-lines.pure.js';
import type { IncomeDraftLineCurrency } from './income-draft-exchange-rate.pure.js';
import {
  buildDraftExchangeRateResolution,
  type DraftExchangeRateResolution,
} from './income-draft-exchange-rate.pure.js';
import type { BoiOfficialRate } from './income-boi-exchange-rate.pure.js';
import {
  resolveOfficialBoiRatesForCurrencies,
} from './income-exchange-rate.service.js';
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
  fx: DraftExchangeRateResolution,
): ComputedDraftLineAmounts {
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

export async function resolveFxMapForDraftLines(
  lines: IncomeDraftLineRecord[],
  documentDate: string,
): Promise<Map<IncomeDraftLineCurrency, BoiOfficialRate | null>> {
  const currencies = lines.map((l) => l.currency);
  const official = await resolveOfficialBoiRatesForCurrencies(currencies, documentDate);
  const map = new Map<IncomeDraftLineCurrency, BoiOfficialRate | null>();
  for (const c of currencies) {
    map.set(c, c === 'ILS' ? null : (official.get(c) ?? null));
  }
  return map;
}

export function resolveLineFx(
  line: IncomeDraftLineRecord,
  documentDate: string,
  officialByCurrency: Map<IncomeDraftLineCurrency, BoiOfficialRate | null>,
): DraftExchangeRateResolution | null {
  const official = officialByCurrency.get(line.currency) ?? null;
  return buildDraftExchangeRateResolution(
    line.currency,
    documentDate,
    official,
    line.exchange_rate_to_ils_override,
  );
}

export async function recomputeDraftLineAmounts(
  lines: IncomeDraftLineRecord[],
  settings: IncomeDocumentSettings,
  vatResolution: IncomeDraftVatResolution,
  documentDate: string,
): Promise<IncomeDraftLineRecord[]> {
  const officialByCurrency = await resolveFxMapForDraftLines(lines, documentDate);
  return lines.map((line) => {
    const fx = resolveLineFx(line, documentDate, officialByCurrency);
    if (!fx) {
      return { ...line, amount_reference: null };
    }
    const amounts = computeDraftLineAmounts(line, settings, vatResolution, fx);
    return {
      ...line,
      amount_reference: amounts.line_total_ils,
    };
  });
}
