/**
 * INV-13A — Pure structural mutations on Owner layout definition (draft only).
 */
import { badRequest } from '../../shared/errors.js';
import { assertSectionAllowedForField, fieldHideRejectedReason, findOwnerInvoiceFieldCatalogEntry, } from './owner-invoice-document-field-catalog.pure.js';
import { assertSectionResizeWithinBounds, parseAndValidateOwnerInvoiceLayoutDefinition, } from './owner-invoice-document-layout-schema.pure.js';
export function assertOwnerInvoiceLayoutVersionMutable(status) {
    if (status !== 'draft') {
        throw badRequest(`Owner invoice layout version is ${status} and immutable`, 'OWNER_INVOICE_LAYOUT_IMMUTABLE');
    }
}
function cloneDefinition(definition) {
    return parseAndValidateOwnerInvoiceLayoutDefinition(JSON.parse(JSON.stringify(definition)));
}
export function moveOwnerInvoiceLayoutSection(definition, params) {
    const next = cloneDefinition(definition);
    const section = next.sections.find((s) => s.key === params.section_key);
    if (!section)
        throw badRequest(`Unknown section_key: ${params.section_key}`);
    if (section.owner_locked && params.col_start != null && params.col_start !== section.col_start) {
        throw badRequest(`Section ${section.key} is owner_locked for column moves`);
    }
    if (params.order != null) {
        if (!Number.isInteger(params.order) || params.order < 0) {
            throw badRequest('order invalid');
        }
        // INV-13D — swap with occupant so ↑/↓ controls keep unique orders.
        const occupant = next.sections.find((s) => s.key !== section.key && s.order === params.order);
        if (occupant) {
            const previous = section.order;
            section.order = params.order;
            occupant.order = previous;
        }
        else {
            section.order = params.order;
        }
    }
    if (params.col_start != null) {
        assertSectionResizeWithinBounds({ section, col_start: params.col_start });
        section.col_start = params.col_start;
    }
    next.sections.sort((a, b) => a.order - b.order);
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function resizeOwnerInvoiceLayoutSection(definition, params) {
    const next = cloneDefinition(definition);
    const section = next.sections.find((s) => s.key === params.section_key);
    if (!section)
        throw badRequest(`Unknown section_key: ${params.section_key}`);
    if (section.owner_locked) {
        throw badRequest(`Section ${section.key} is owner_locked and cannot be resized`);
    }
    const height_px = params.height_px ?? section.height_px;
    const col_span = params.col_span ?? section.col_span;
    assertSectionResizeWithinBounds({ section, height_px, col_span });
    section.height_px = height_px;
    section.col_span = col_span;
    if (params.alignment != null) {
        if (!['start', 'center', 'end', 'stretch'].includes(params.alignment)) {
            throw badRequest('alignment invalid');
        }
        section.alignment = params.alignment;
    }
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function moveOwnerInvoiceLayoutField(definition, params) {
    const next = cloneDefinition(definition);
    const field = next.fields.find((f) => f.field_key === params.field_key);
    if (!field)
        throw badRequest(`Unknown field_key: ${params.field_key}`);
    const catalog = findOwnerInvoiceFieldCatalogEntry(field.field_key);
    if (!catalog?.move_allowed || field.owner_locked) {
        throw badRequest(`Field ${field.field_key} cannot be moved`);
    }
    if (params.section_key != null) {
        const sectionKey = params.section_key;
        try {
            assertSectionAllowedForField(field.field_key, sectionKey);
        }
        catch (e) {
            throw badRequest(e instanceof Error ? e.message : 'Field section move rejected');
        }
        if (!next.sections.some((s) => s.key === sectionKey)) {
            throw badRequest(`Unknown section_key: ${params.section_key}`);
        }
        field.section_key = sectionKey;
    }
    if (params.order != null) {
        if (!Number.isInteger(params.order) || params.order < 0)
            throw badRequest('order invalid');
        // INV-13D — swap with same-section occupant for ↑/↓ field order.
        const sectionKey = field.section_key;
        const occupant = next.fields.find((f) => f.field_key !== field.field_key &&
            f.section_key === sectionKey &&
            f.order === params.order);
        if (occupant) {
            const previous = field.order;
            field.order = params.order;
            occupant.order = previous;
        }
        else {
            field.order = params.order;
        }
    }
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function setOwnerInvoiceFieldVisibility(definition, params) {
    const next = cloneDefinition(definition);
    const field = next.fields.find((f) => f.field_key === params.field_key);
    if (!field)
        throw badRequest(`Unknown field_key: ${params.field_key}`);
    if (!params.visible) {
        const reason = fieldHideRejectedReason(field.field_key);
        if (reason)
            throw badRequest(reason, 'OWNER_INVOICE_FIELD_HIDE_REJECTED');
    }
    field.visible = params.visible;
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function placeOwnerInvoiceLayoutField(definition, params) {
    const catalog = findOwnerInvoiceFieldCatalogEntry(params.field_key);
    if (!catalog)
        throw badRequest(`Unknown field_key: ${params.field_key}`);
    const sectionKey = params.section_key;
    try {
        assertSectionAllowedForField(params.field_key, sectionKey);
    }
    catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Field section place rejected');
    }
    const next = cloneDefinition(definition);
    if (!next.sections.some((s) => s.key === sectionKey)) {
        throw badRequest(`Unknown section_key: ${params.section_key}`);
    }
    const existing = next.fields.find((f) => f.field_key === params.field_key);
    const order = params.order != null
        ? Number(params.order)
        : Math.max(0, ...next.fields.filter((f) => f.section_key === sectionKey).map((f) => f.order)) + 1;
    if (!Number.isInteger(order) || order < 0)
        throw badRequest('order invalid');
    if (existing) {
        existing.section_key = sectionKey;
        existing.order = order;
        existing.visible = true;
    }
    else {
        if (catalog.requiredness === 'required' ||
            catalog.requiredness === 'legal_required' ||
            catalog.requiredness === 'country_required') {
            // Required fields must already exist in seed; do not invent placements ad hoc.
            throw badRequest(`Required field ${params.field_key} must already exist in layout`);
        }
        next.fields.push({
            field_key: params.field_key,
            section_key: sectionKey,
            order,
            visible: true,
            width_span: 12,
            display_variant: catalog.display_variants[0] ?? 'default',
            owner_locked: false,
        });
    }
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function setOwnerInvoiceSectionLock(definition, params) {
    const next = cloneDefinition(definition);
    const section = next.sections.find((s) => s.key === params.section_key);
    if (!section)
        throw badRequest(`Unknown section_key: ${params.section_key}`);
    section.owner_locked = Boolean(params.owner_locked);
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
export function setOwnerInvoiceTableColumn(definition, params) {
    const next = cloneDefinition(definition);
    const col = next.table.columns.find((c) => c.key === params.column_key);
    if (!col)
        throw badRequest(`Unknown table column: ${params.column_key}`);
    if (col.owner_locked) {
        throw badRequest(`Table column ${col.key} is owner_locked`);
    }
    if (params.visible != null)
        col.visible = params.visible;
    if (params.width_px !== undefined)
        col.width_px = params.width_px;
    if (params.order != null) {
        if (!Number.isInteger(params.order) || params.order < 0)
            throw badRequest('order invalid');
        // INV-13D — swap with occupant so table ↑/↓ keeps unique orders.
        const occupant = next.table.columns.find((c) => c.key !== col.key && c.order === params.order);
        if (occupant) {
            const previous = col.order;
            col.order = params.order;
            occupant.order = previous;
        }
        else {
            col.order = params.order;
        }
    }
    if (params.align != null)
        col.align = params.align;
    next.table.columns.sort((a, b) => a.order - b.order);
    return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}
/** Pure publish transition: archive previous published ids, mark target published. */
export function planPublishOwnerInvoiceLayoutVersion(params) {
    if (params.target_status !== 'draft') {
        throw badRequest('Only draft versions can be published', 'OWNER_INVOICE_LAYOUT_PUBLISH_INVALID');
    }
    const archive_ids = params.currently_published_ids.filter((id) => id !== params.target_id);
    return { archive_ids, publish_id: params.target_id };
}
