import { randomUUID } from 'node:crypto';
import { badRequest } from '../../shared/errors.js';
import { DRAFT_LINE_CURRENCY_INVALID_MESSAGE, DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE, parseDraftLineCurrency, parseDraftLineCurrencyFromPatch, parseDraftLineExchangeRateOverride, } from './income-draft-exchange-rate.pure.js';
function parseLineVatRateCode(raw) {
    return raw === 'exempt' ? 'exempt' : 'standard';
}
function parsePriceIncludesVat(raw) {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1')
        return true;
    return false;
}
function finalizeDraftLine(line) {
    const currency = parseDraftLineCurrency(line.currency);
    return {
        ...line,
        currency,
        exchange_rate_to_ils_override: currency === 'ILS' ? null : line.exchange_rate_to_ils_override,
    };
}
export function normalizeDraftLines(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const lines = [];
    arr.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return;
        const o = item;
        const line_id = String(o.line_id ?? '').trim() || randomUUID();
        const description = String(o.description ?? '').trim();
        const quantityRaw = Number(o.quantity);
        const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
        const unitRaw = Number(o.unit_price_reference);
        const unit_price_reference = Number.isFinite(unitRaw) ? unitRaw : null;
        const currency = parseDraftLineCurrency(o.currency);
        const overrideRaw = Number(o.exchange_rate_to_ils_override);
        let exchange_rate_to_ils_override = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : null;
        if (currency === 'ILS')
            exchange_rate_to_ils_override = null;
        const amountRaw = Number(o.amount_reference);
        const amount_reference = Number.isFinite(amountRaw) ? amountRaw : null;
        lines.push(finalizeDraftLine({
            line_id,
            sort_index: Number.isFinite(Number(o.sort_index)) ? Number(o.sort_index) : index,
            description,
            quantity,
            unit_price_reference,
            currency,
            exchange_rate_to_ils_override,
            price_includes_vat: parsePriceIncludesVat(o.price_includes_vat),
            vat_rate_code: parseLineVatRateCode(o.vat_rate_code),
            amount_reference,
        }));
    });
    return lines
        .sort((a, b) => a.sort_index - b.sort_index)
        .map((l, i) => finalizeDraftLine({ ...l, sort_index: i }));
}
export function serializeDraftLines(lines) {
    return lines.map((l) => ({
        line_id: l.line_id,
        sort_index: l.sort_index,
        description: l.description,
        quantity: l.quantity,
        unit_price_reference: l.unit_price_reference,
        currency: l.currency,
        exchange_rate_to_ils_override: l.exchange_rate_to_ils_override,
        price_includes_vat: l.price_includes_vat,
        vat_rate_code: l.vat_rate_code,
        amount_reference: l.amount_reference,
    }));
}
export function createEmptyDraftLine(sortIndex, defaults) {
    return {
        line_id: randomUUID(),
        sort_index: sortIndex,
        description: '',
        quantity: 1,
        unit_price_reference: null,
        currency: defaults?.currency ?? 'ILS',
        exchange_rate_to_ils_override: null,
        price_includes_vat: defaults?.price_includes_vat ?? false,
        vat_rate_code: defaults?.vat_rate_code ?? 'standard',
        amount_reference: null,
    };
}
export function applyLineFieldUpdate(lines, lineId, patch) {
    const idx = lines.findIndex((l) => l.line_id === lineId);
    if (idx < 0)
        throw badRequest('line_id not found');
    const current = lines[idx];
    let description = current.description;
    let quantity = current.quantity;
    let unit_price_reference = current.unit_price_reference;
    let currency = current.currency;
    let exchange_rate_to_ils_override = current.exchange_rate_to_ils_override;
    let price_includes_vat = current.price_includes_vat;
    let vat_rate_code = current.vat_rate_code;
    if (patch.description !== undefined) {
        description = String(patch.description ?? '').trim();
    }
    if (patch.quantity !== undefined) {
        const q = Number(patch.quantity);
        if (!Number.isFinite(q) || q <= 0)
            throw badRequest('quantity must be a positive number');
        quantity = q;
    }
    if (patch.unit_price_reference !== undefined) {
        const v = patch.unit_price_reference;
        if (v === null || v === '') {
            unit_price_reference = null;
        }
        else {
            const n = Number(v);
            if (!Number.isFinite(n))
                throw badRequest('unit_price_reference must be numeric');
            unit_price_reference = n;
        }
    }
    if (patch.currency !== undefined) {
        try {
            currency = parseDraftLineCurrencyFromPatch(patch.currency);
        }
        catch {
            throw badRequest(DRAFT_LINE_CURRENCY_INVALID_MESSAGE);
        }
        if (currency === 'ILS')
            exchange_rate_to_ils_override = null;
    }
    const hasExchangePatch = patch.exchange_rate_to_ils_override !== undefined || patch.exchange_rate_override !== undefined;
    if (currency !== 'ILS' && hasExchangePatch) {
        try {
            exchange_rate_to_ils_override = parseDraftLineExchangeRateOverride(currency, patch.exchange_rate_to_ils_override ?? patch.exchange_rate_override);
        }
        catch {
            throw badRequest(DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE);
        }
    }
    else if (currency === 'ILS') {
        exchange_rate_to_ils_override = null;
    }
    if (patch.price_includes_vat !== undefined) {
        price_includes_vat = parsePriceIncludesVat(patch.price_includes_vat);
    }
    if (patch.vat_rate_code !== undefined) {
        vat_rate_code = parseLineVatRateCode(patch.vat_rate_code);
    }
    const next = [...lines];
    next[idx] = finalizeDraftLine({
        ...current,
        description,
        quantity,
        unit_price_reference,
        currency,
        exchange_rate_to_ils_override,
        price_includes_vat,
        vat_rate_code,
        amount_reference: current.amount_reference,
    });
    return next;
}
export function reorderDraftLines(lines, orderedLineIds) {
    if (orderedLineIds.length !== lines.length) {
        throw badRequest('ordered_line_ids must include every line exactly once');
    }
    const byId = new Map(lines.map((l) => [l.line_id, l]));
    const reordered = [];
    for (const id of orderedLineIds) {
        const line = byId.get(id);
        if (!line)
            throw badRequest(`Unknown line_id in reorder: ${id}`);
        reordered.push(line);
    }
    return reordered.map((l, i) => ({ ...l, sort_index: i }));
}
export function deleteDraftLine(lines, lineId) {
    const filtered = lines.filter((l) => l.line_id !== lineId);
    if (filtered.length === lines.length)
        throw badRequest('line_id not found');
    return filtered.map((l, i) => ({ ...l, sort_index: i }));
}
export function formatMoneyReference(amount, currency) {
    if (amount == null || !Number.isFinite(amount))
        return '—';
    const symbol = currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
    const formatted = amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${symbol}${formatted}`;
}
