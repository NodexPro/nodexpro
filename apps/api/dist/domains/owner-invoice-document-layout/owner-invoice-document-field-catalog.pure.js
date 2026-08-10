/**
 * INV-13A/B — Backend-owned field catalog for Owner Invoice Document Builder.
 * No VAT percentage values — rates live in Country Pack / Owner Legal Control.
 */
const SECTION = {
    issuer: 'issuer_branding',
    doc: 'document_identity',
    customer: 'customer',
    lines: 'lines',
    totals: 'totals',
    notes: 'notes',
    payments: 'payments',
    legal: 'legal_footer',
};
function entry(partial) {
    return partial;
}
export const OWNER_INVOICE_DOCUMENT_FIELD_CATALOG = [
    // Issuer
    entry({
        field_key: 'logo',
        group: 'issuer',
        label: 'Logo',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: true,
    }),
    entry({
        field_key: 'issuer_name',
        group: 'issuer',
        label: 'Company Name',
        requiredness: 'required',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'tax_id',
        group: 'issuer',
        label: 'Tax ID',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'registration_number',
        group: 'issuer',
        label: 'Registration Number',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'address',
        group: 'issuer',
        label: 'Address',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'city',
        group: 'issuer',
        label: 'City',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'phone',
        group: 'issuer',
        label: 'Phone',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'email',
        group: 'issuer',
        label: 'Email',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'website',
        group: 'issuer',
        label: 'Website',
        requiredness: 'optional',
        allowed_sections: [SECTION.issuer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    // Document
    entry({
        field_key: 'document_type',
        group: 'document',
        label: 'Document Type',
        requiredness: 'required',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'document_number',
        group: 'document',
        label: 'Document Number',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.doc],
        display_variants: ['number_bar'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'tax_allocation_number',
        group: 'document',
        label: 'Allocation Number',
        requiredness: 'country_required',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'issue_date',
        group: 'document',
        label: 'Issue Date',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'due_date',
        group: 'document',
        label: 'Due Date',
        requiredness: 'optional',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'payment_terms',
        group: 'document',
        label: 'Payment Terms',
        requiredness: 'optional',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'currency',
        group: 'document',
        label: 'Currency',
        requiredness: 'optional',
        allowed_sections: [SECTION.doc],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    // Customer
    entry({
        field_key: 'customer_name',
        group: 'customer',
        label: 'Name',
        requiredness: 'required',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'customer_contact',
        group: 'customer',
        label: 'Contact',
        requiredness: 'optional',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'customer_address',
        group: 'customer',
        label: 'Address',
        requiredness: 'optional',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'customer_email',
        group: 'customer',
        label: 'Email',
        requiredness: 'optional',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'customer_phone',
        group: 'customer',
        label: 'Phone',
        requiredness: 'optional',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'customer_tax_id',
        group: 'customer',
        label: 'VAT Number',
        requiredness: 'optional',
        allowed_sections: [SECTION.customer],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    // Lines (table-backed)
    entry({
        field_key: 'line_description',
        group: 'lines',
        label: 'Description',
        requiredness: 'required',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'line_quantity',
        group: 'lines',
        label: 'Quantity',
        requiredness: 'required',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'line_unit_price',
        group: 'lines',
        label: 'Unit Price',
        requiredness: 'required',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'line_currency',
        group: 'lines',
        label: 'Line Currency',
        requiredness: 'optional',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'line_vat',
        group: 'lines',
        label: 'VAT',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'line_total',
        group: 'lines',
        label: 'Line Total',
        requiredness: 'required',
        allowed_sections: [SECTION.lines],
        display_variants: ['table_column'],
        move_allowed: false,
        hide_allowed: false,
    }),
    // Totals — placement/visibility only; values remain Income truth
    entry({
        field_key: 'discount',
        group: 'totals',
        label: 'Discount',
        requiredness: 'optional',
        allowed_sections: [SECTION.totals],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'subtotal',
        group: 'totals',
        label: 'Total Before VAT',
        requiredness: 'required',
        allowed_sections: [SECTION.totals],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'vat_total',
        group: 'totals',
        label: 'VAT Amount',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.totals],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'grand_total',
        group: 'totals',
        label: 'Grand Total',
        requiredness: 'required',
        allowed_sections: [SECTION.totals],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'balance',
        group: 'totals',
        label: 'Balance',
        requiredness: 'optional',
        allowed_sections: [SECTION.totals],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    // Legal
    entry({
        field_key: 'signature_block',
        group: 'legal',
        label: 'Signature',
        requiredness: 'optional',
        allowed_sections: [SECTION.legal, SECTION.payments],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'stamp',
        group: 'legal',
        label: 'Stamp',
        requiredness: 'optional',
        allowed_sections: [SECTION.legal, SECTION.payments],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'notes',
        group: 'legal',
        label: 'Notes',
        requiredness: 'optional',
        allowed_sections: [SECTION.notes, SECTION.legal],
        display_variants: ['default'],
        move_allowed: true,
        hide_allowed: true,
    }),
    entry({
        field_key: 'legal_wording',
        group: 'legal',
        label: 'Legal Text',
        requiredness: 'legal_required',
        allowed_sections: [SECTION.legal],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: false,
    }),
    entry({
        field_key: 'platform_footer',
        group: 'legal',
        label: 'Platform Footer',
        requiredness: 'optional',
        allowed_sections: [SECTION.legal],
        display_variants: ['default'],
        move_allowed: false,
        hide_allowed: true,
    }),
];
const FORBIDDEN_LAYOUT_VALUE_KEYS = [
    'vat_rate',
    'vat_percent',
    'vat_percentage',
    'effective_vat_rate',
    'legal_vat_rate',
];
export function getOwnerInvoiceFieldCatalog() {
    return OWNER_INVOICE_DOCUMENT_FIELD_CATALOG.map((e) => ({ ...e }));
}
export function findOwnerInvoiceFieldCatalogEntry(fieldKey) {
    const key = String(fieldKey ?? '').trim();
    return OWNER_INVOICE_DOCUMENT_FIELD_CATALOG.find((e) => e.field_key === key) ?? null;
}
export function isOwnerInvoiceCatalogFieldKey(fieldKey) {
    return findOwnerInvoiceFieldCatalogEntry(fieldKey) != null;
}
export function assertSectionAllowedForField(fieldKey, sectionKey) {
    const entry = findOwnerInvoiceFieldCatalogEntry(fieldKey);
    if (!entry)
        throw new Error(`Unknown field_key: ${fieldKey}`);
    if (!entry.allowed_sections.includes(sectionKey)) {
        throw new Error(`Field ${fieldKey} not allowed in section ${sectionKey}`);
    }
}
export function fieldHideRejectedReason(fieldKey) {
    const entry = findOwnerInvoiceFieldCatalogEntry(fieldKey);
    if (!entry)
        return `Unknown field_key: ${fieldKey}`;
    if (!entry.hide_allowed) {
        return `Field ${fieldKey} is ${entry.requiredness} and cannot be hidden`;
    }
    if (entry.requiredness === 'required' ||
        entry.requiredness === 'legal_required' ||
        entry.requiredness === 'country_required') {
        return `Field ${fieldKey} is ${entry.requiredness} and cannot be hidden`;
    }
    return null;
}
/** Reject VAT rate / legal rate smuggling into layout JSON. */
export function layoutJsonContainsForbiddenVatRateKeys(value) {
    const stack = [value];
    while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object')
            continue;
        if (Array.isArray(cur)) {
            for (const item of cur)
                stack.push(item);
            continue;
        }
        for (const [k, v] of Object.entries(cur)) {
            const key = k.toLowerCase();
            if (FORBIDDEN_LAYOUT_VALUE_KEYS.some((f) => key === f || key.includes(f))) {
                return true;
            }
            if (v && typeof v === 'object')
                stack.push(v);
        }
    }
    return false;
}
