/**
 * INV-13B — Builder-only editable zones chrome (never injected into preview/PDF/issued HTML).
 * Geometry is derived from structured layout_definition for Owner visual editor overlays.
 */
import { OWNER_INVOICE_LAYOUT_COMMANDS } from './owner-invoice-document-layout.types.js';
/** Fallback labels — prefer registry/section_model labels passed by caller (INV-13C). */
const DEFAULT_ZONE_LABELS = {
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
function zoneActions(params) {
    if (!params.editable)
        return [];
    const actions = [];
    if (!params.is_logo) {
        actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.move_section);
        if (params.resize_allowed)
            actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.resize_section);
        actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.set_section_lock);
    }
    actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.place_field);
    actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.move_field);
    actions.push(OWNER_INVOICE_LAYOUT_COMMANDS.set_field_visibility);
    return actions;
}
/**
 * Build builder-only zone overlays from structured layout.
 * Does not alter renderer HTML.
 */
export function buildOwnerInvoiceBuilderZones(params) {
    const definition = params.definition;
    const labels = { ...DEFAULT_ZONE_LABELS, ...(params.section_labels ?? {}) };
    const pageW = definition.grid.page.width_px;
    const colW = pageW / definition.grid.columns;
    const sections = [...definition.sections].sort((a, b) => a.order - b.order);
    const bands = [];
    let cursorY = 0;
    let i = 0;
    while (i < sections.length) {
        const s = sections[i];
        if (s.zone === 'upper') {
            const bandSections = [s];
            let bandH = s.height_px;
            let j = i + 1;
            while (j < sections.length && sections[j].zone === 'upper') {
                bandSections.push(sections[j]);
                bandH = Math.max(bandH, sections[j].height_px);
                j += 1;
            }
            bands.push({ top: cursorY, height: bandH, sections: bandSections });
            cursorY += bandH;
            i = j;
            continue;
        }
        bands.push({ top: cursorY, height: s.height_px, sections: [s] });
        cursorY += s.height_px;
        i += 1;
    }
    const zones = [];
    let logoPlaced = false;
    for (const band of bands) {
        for (const section of band.sections) {
            const left = (section.col_start - 1) * colW;
            const width = section.col_span * colW;
            const fieldKeys = definition.fields
                .filter((f) => f.section_key === section.key)
                .sort((a, b) => a.order - b.order)
                .map((f) => f.field_key);
            if (section.key === 'issuer_branding' && !logoPlaced) {
                const logoField = definition.fields.find((f) => f.field_key === 'logo');
                const logoH = Math.min(80, Math.max(56, Math.round(band.height * 0.4)));
                zones.push({
                    zone_key: 'logo',
                    section_key: 'issuer_branding',
                    label: labels.logo ?? 'Logo',
                    order: section.order,
                    left_px: left + 8,
                    top_px: band.top + 8,
                    width_px: Math.min(width - 16, 320),
                    height_px: logoH,
                    col_start: section.col_start,
                    col_span: Math.min(section.col_span, 6),
                    owner_locked: Boolean(logoField?.owner_locked),
                    accept_field_drop: false,
                    resize_allowed: false,
                    reorder_allowed: false,
                    lock_toggle_allowed: params.editable,
                    allowed_actions: zoneActions({
                        editable: params.editable,
                        owner_locked: Boolean(logoField?.owner_locked),
                        resize_allowed: false,
                        is_logo: true,
                    }),
                    logo_placeholder: {
                        show: Boolean(logoField?.visible !== false) && !params.sample_logo_present,
                        // INV-13D — controlled config UX; sample preview only (no Owner upload).
                        label: 'Logo zone (sample preview)',
                    },
                    field_keys: ['logo'],
                });
                logoPlaced = true;
            }
            zones.push({
                zone_key: section.key,
                section_key: section.key,
                label: labels[section.key] ?? section.key,
                order: section.order,
                left_px: left,
                top_px: band.top,
                width_px: width,
                height_px: band.sections.length > 1 ? band.height : section.height_px,
                col_start: section.col_start,
                col_span: section.col_span,
                owner_locked: section.owner_locked,
                accept_field_drop: true,
                resize_allowed: !section.owner_locked,
                reorder_allowed: true,
                lock_toggle_allowed: params.editable,
                allowed_actions: zoneActions({
                    editable: params.editable,
                    owner_locked: section.owner_locked,
                    resize_allowed: !section.owner_locked,
                    is_logo: false,
                }),
                field_keys: fieldKeys,
            });
        }
    }
    return {
        chrome: {
            mode: 'visual_editor',
            page: {
                width_px: definition.grid.page.width_px,
                height_px: definition.grid.page.height_px,
            },
            grid: {
                columns: 12,
                snap_px: definition.grid.snap_px,
                show_columns: true,
                show_rulers: true,
                show_guides: true,
            },
            zones_builder_only: true,
            note: 'Builder zones are Owner chrome only — never rendered in Preview/PDF/issued documents.',
        },
        zones,
    };
}
