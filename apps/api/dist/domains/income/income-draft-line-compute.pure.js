import { resolveDraftExchangeRateToIls } from './income-draft-exchange-rate.pure.js';
function round2(n) {
    return Math.round(n * 100) / 100;
}
function effectiveVatRate(lineVatCode, settings, vatResolution) {
    const code = lineVatCode === 'exempt' || settings.vat_mode === 'exempt' ? 'exempt' : lineVatCode;
    if (code === 'exempt')
        return 0;
    if (settings.vat_mode === 'zero')
        return 0;
    return vatResolution.standard_rate;
}
export function computeDraftLineAmounts(line, settings, vatResolution, documentDate) {
    const fx = resolveDraftExchangeRateToIls(line.currency, documentDate, line.exchange_rate_to_ils_override);
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
export function recomputeDraftLineAmounts(lines, settings, vatResolution, documentDate) {
    return lines.map((line) => {
        const amounts = computeDraftLineAmounts(line, settings, vatResolution, documentDate);
        return {
            ...line,
            amount_reference: amounts.line_total_ils,
        };
    });
}
