/**
 * INC-6 — Immutable render snapshot from issued income document facts.
 */
import { documentTypeLabel, resolveIncomePdfTemplate } from './income-pdf-template.resolver.js';
function parseAddressLines(addressJson) {
    if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson))
        return [];
    const a = addressJson;
    const lines = [];
    for (const key of ['line1', 'line_1', 'address_line_1', 'street']) {
        if (a[key])
            lines.push(String(a[key]).trim());
    }
    const city = [a.city, a.postal_code ?? a.postalCode].filter(Boolean).join(' ');
    if (city.trim())
        lines.push(city.trim());
    return lines.filter(Boolean);
}
function parseLineRow(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { description: '', quantity: null, unit_price_reference: null, amount_reference: null };
    }
    const o = raw;
    const qty = Number(o.quantity);
    const unit = Number(o.unit_price_reference ?? o.unit_price);
    const amount = Number(o.amount_reference ?? o.amount);
    return {
        description: String(o.description ?? o.name ?? o.title ?? '').trim(),
        quantity: Number.isFinite(qty) ? qty : null,
        unit_price_reference: Number.isFinite(unit) ? unit : null,
        amount_reference: Number.isFinite(amount) ? amount : null,
    };
}
export function buildIncomeDocumentRenderSnapshot(input) {
    const language = input.language === 'en' ? 'en' : 'he';
    const template = resolveIncomePdfTemplate({
        document_type: input.document_type,
        language,
        country_code: String(input.legal_snapshot_json?.country_code ?? 'IL'),
    });
    const issuer = input.issuer_snapshot_json ?? {};
    const customer = input.customer_snapshot_json ?? {};
    const lines = (Array.isArray(input.lines_snapshot_json) ? input.lines_snapshot_json : []).map(parseLineRow);
    const subtotal = typeof input.totals_snapshot_json?.subtotal_reference === 'number'
        ? input.totals_snapshot_json.subtotal_reference
        : lines.reduce((sum, l) => sum + (l.amount_reference ?? 0), 0) || null;
    const footer = input.organization_footer_note?.trim() ||
        (language === 'he'
            ? 'מסמך הונפק במערכת NodexPro — עותק להמחאה בלבד'
            : 'Issued via NodexPro — for reference only');
    return {
        captured_at: new Date().toISOString(),
        issuer: {
            legal_name: String(issuer.legal_name ?? issuer.display_name ?? '').trim() || 'Issuer',
            display_name: String(issuer.display_name ?? issuer.legal_name ?? '').trim() || 'Issuer',
            tax_id: issuer.tax_id != null ? String(issuer.tax_id).trim() || null : null,
            address_lines: parseAddressLines(issuer.address_json),
        },
        customer: {
            display_name: String(customer.display_name ?? '').trim() || (language === 'he' ? 'לקוח' : 'Customer'),
            tax_id: customer.tax_id != null ? String(customer.tax_id).trim() || null : null,
            phone: customer.phone != null ? String(customer.phone).trim() || null : null,
            email: customer.email != null ? String(customer.email).trim() || null : null,
            address_lines: parseAddressLines(customer.address_json),
        },
        document: {
            document_type: input.document_type,
            document_type_label: documentTypeLabel(input.document_type, language),
            document_number: input.document_number,
            issue_date: input.issue_date,
            currency: input.currency,
            language,
        },
        lines,
        totals: {
            currency: input.currency,
            subtotal_reference: subtotal,
            totals_label: language === 'he' ? 'סה״כ' : 'Total',
            not_financial_truth: true,
        },
        notes: input.notes?.trim() || null,
        footer_text: footer,
        legal: {
            ...(input.legal_snapshot_json ?? {}),
            vat_label: language === 'he' ? 'מע״מ לפי דין' : 'VAT per applicable law',
        },
        template: {
            template_key: template.template_key,
            template_version: template.template_version,
            language: template.language,
            rtl: template.rtl,
            country_code: template.country_code,
        },
    };
}
