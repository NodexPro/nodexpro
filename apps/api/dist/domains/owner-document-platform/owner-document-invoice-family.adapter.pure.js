/**
 * INV-13C — Invoice template family adapter.
 * Maps existing invoice layout v1 + field catalog → universal section/widget models.
 * Does not redesign invoice layout or touch the renderer.
 */
import { getOwnerInvoiceFieldCatalog } from '../owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
export const INVOICE_TEMPLATE_FAMILY = 'invoice';
export const INVOICE_SECTION_LABELS = {
    logo: 'Logo',
    issuer_branding: 'Issuer',
    document_identity: 'Document Header',
    customer: 'Customer',
    lines: 'Line Items',
    totals: 'Totals',
    payments: 'Payment Information',
    notes: 'Notes',
    legal_footer: 'Footer',
};
const GROUP_LABELS = {
    issuer: 'Issuer',
    document: 'Document',
    customer: 'Customer',
    lines: 'Lines',
    totals: 'Totals',
    legal: 'Legal',
};
function widgetTypeForField(field) {
    if (field.field_key === 'logo')
        return 'logo';
    if (field.display_variants.includes('table_column'))
        return 'table';
    if (field.field_key === 'signature_block' || field.field_key === 'stamp')
        return 'signature';
    if (field.field_key === 'legal_wording' || field.field_key === 'platform_footer')
        return 'legal_block';
    if (field.group === 'totals')
        return 'totals_block';
    if (field.field_key.includes('address'))
        return 'address_block';
    if (field.field_key.includes('phone') ||
        field.field_key.includes('email') ||
        field.field_key === 'customer_contact') {
        return 'contact_block';
    }
    if (field.group === 'document' && field.field_key.includes('payment'))
        return 'payment_block';
    return 'text';
}
/**
 * Build universal widget catalog from invoice field catalog (backend-owned only).
 */
export function buildInvoiceFamilyWidgetCatalog() {
    return getOwnerInvoiceFieldCatalog().map((field) => ({
        widget_key: `invoice.${field.field_key}`,
        widget_type: widgetTypeForField(field),
        label: field.label,
        group_key: field.group,
        group_label: GROUP_LABELS[field.group] ?? field.group,
        allowed_section_keys: [...field.allowed_sections],
        fields: [
            {
                field_key: field.field_key,
                label: field.label,
                requiredness: field.requiredness,
                display_variants: [...field.display_variants],
                move_allowed: field.move_allowed,
                hide_allowed: field.hide_allowed,
            },
        ],
        primary_field_key: field.field_key,
    }));
}
/**
 * Build universal section model from invoice layout definition + registry labels.
 */
export function buildInvoiceFamilySectionModel(definition, sectionLabels = INVOICE_SECTION_LABELS) {
    const widgets = buildInvoiceFamilyWidgetCatalog();
    return [...definition.sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => {
        const allowed_widget_keys = widgets
            .filter((w) => w.allowed_section_keys.includes(section.key))
            .map((w) => w.widget_key);
        return {
            section_key: section.key,
            label: sectionLabels[section.key] ?? section.key,
            type: section.zone,
            allowed_widget_keys,
            constraints: {
                min_height_px: section.min_height_px,
                max_height_px: section.max_height_px,
                col_start: section.col_start,
                col_span: section.col_span,
                resize_allowed: !section.owner_locked,
                reorder_allowed: true,
                move_allowed: !section.owner_locked,
                owner_locked: section.owner_locked,
            },
            order: section.order,
            visible: section.visible,
        };
    });
}
/** Dynamic catalog groups for FE — no hardcoded invoice group order in UI. */
export function buildInvoiceWidgetCatalogGroups(widgets) {
    const order = [];
    const map = new Map();
    for (const w of widgets) {
        if (!map.has(w.group_key)) {
            map.set(w.group_key, []);
            order.push(w.group_key);
        }
        map.get(w.group_key).push(w);
    }
    return order.map((group_key) => ({
        group_key,
        group_label: map.get(group_key)?.[0]?.group_label ?? group_key,
        widgets: map.get(group_key) ?? [],
    }));
}
