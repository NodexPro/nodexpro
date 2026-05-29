import { buildDraftExchangeRateResolution, } from './income-draft-exchange-rate.pure.js';
import { resolveOfficialBoiRatesForCurrencies, } from './income-exchange-rate.service.js';
function round2(n) {
    return Math.round(n * 100) / 100;
}
export function effectiveLineVatRate(lineVatCode, settings, vatResolution) {
    const code = lineVatCode === 'exempt' || settings.vat_mode === 'exempt' ? 'exempt' : lineVatCode;
    if (code === 'exempt')
        return 0;
    if (settings.vat_mode === 'zero')
        return 0;
    return vatResolution.standard_rate;
}
export function computeDraftLineAmounts(line, settings, vatResolution, fx) {
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
    const rate = effectiveLineVatRate(line.vat_rate_code, settings, vatResolution);
    let net;
    let vat;
    if (rate <= 0) {
        net = gross;
        vat = 0;
    }
    else if (line.price_includes_vat) {
        net = round2(gross / (1 + rate));
        vat = round2(gross - net);
    }
    else {
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
export async function resolveFxMapForDraftLines(lines, documentDate) {
    const currencies = lines.map((l) => l.currency);
    const official = await resolveOfficialBoiRatesForCurrencies(currencies, documentDate);
    const map = new Map();
    for (const c of currencies) {
        map.set(c, c === 'ILS' ? null : (official.get(c) ?? null));
    }
    return map;
}
export function resolveLineFx(line, documentDate, officialByCurrency) {
    const official = officialByCurrency.get(line.currency) ?? null;
    return buildDraftExchangeRateResolution(line.currency, documentDate, official, line.exchange_rate_to_ils_override);
}
export async function recomputeDraftLineAmounts(lines, settings, vatResolution, documentDate) {
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
