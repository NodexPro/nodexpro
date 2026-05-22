import { randomUUID } from 'node:crypto';
import { badRequest } from '../../shared/errors.js';
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
        const amountRaw = Number(o.amount_reference);
        let amount_reference = Number.isFinite(amountRaw) ? amountRaw : null;
        if (amount_reference == null && unit_price_reference != null) {
            amount_reference = Math.round(quantity * unit_price_reference * 100) / 100;
        }
        lines.push({
            line_id,
            sort_index: Number.isFinite(Number(o.sort_index)) ? Number(o.sort_index) : index,
            description,
            quantity,
            unit_price_reference,
            amount_reference,
        });
    });
    return lines.sort((a, b) => a.sort_index - b.sort_index).map((l, i) => ({ ...l, sort_index: i }));
}
export function serializeDraftLines(lines) {
    return lines.map((l) => ({
        line_id: l.line_id,
        sort_index: l.sort_index,
        description: l.description,
        quantity: l.quantity,
        unit_price_reference: l.unit_price_reference,
        amount_reference: l.amount_reference,
    }));
}
export function createEmptyDraftLine(sortIndex) {
    return {
        line_id: randomUUID(),
        sort_index: sortIndex,
        description: '',
        quantity: 1,
        unit_price_reference: null,
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
    let amount_reference = current.amount_reference;
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
    if (patch.amount_reference !== undefined) {
        const v = patch.amount_reference;
        if (v === null || v === '') {
            amount_reference = null;
        }
        else {
            const n = Number(v);
            if (!Number.isFinite(n))
                throw badRequest('amount_reference must be numeric');
            amount_reference = n;
        }
    }
    if (patch.amount_reference === undefined && patch.unit_price_reference !== undefined && unit_price_reference != null) {
        amount_reference = Math.round(quantity * unit_price_reference * 100) / 100;
    }
    if (patch.amount_reference === undefined && patch.quantity !== undefined && unit_price_reference != null) {
        amount_reference = Math.round(quantity * unit_price_reference * 100) / 100;
    }
    const next = [...lines];
    next[idx] = {
        ...current,
        description,
        quantity,
        unit_price_reference,
        amount_reference,
    };
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
    const symbol = currency === 'ILS' ? '₪' : currency;
    const formatted = amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${symbol}${formatted}`;
}
