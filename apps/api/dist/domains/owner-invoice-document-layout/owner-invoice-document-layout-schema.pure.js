/**
 * INV-13A — Safe structured layout schema_version=1 validation.
 */
import { badRequest } from '../../shared/errors.js';
import { fieldHideRejectedReason, isOwnerInvoiceCatalogFieldKey, layoutJsonContainsForbiddenVatRateKeys, } from './owner-invoice-document-field-catalog.pure.js';
const SECTION_KEYS = new Set([
    'issuer_branding',
    'document_identity',
    'customer',
    'lines',
    'totals',
    'notes',
    'payments',
    'legal_footer',
]);
const FORBIDDEN_STRING_PATTERNS = [/<[a-z]/i, /<\/[a-z]/i, /javascript:/i, /<script/i, /expression\s*\(/i];
function reject(message) {
    throw badRequest(message, 'OWNER_INVOICE_LAYOUT_SCHEMA_INVALID');
}
function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject(`${label} must be an object`);
    }
}
function assertOnlyKeys(obj, allowed, label) {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key))
            reject(`${label} has unknown key: ${key}`);
    }
}
function assertNoMarkup(value, path) {
    if (typeof value === 'string') {
        for (const re of FORBIDDEN_STRING_PATTERNS) {
            if (re.test(value))
                reject(`${path} must not contain HTML/CSS/script`);
        }
        // Heuristic: block inline CSS property lists / blocks
        if (/[a-z-]+\s*:\s*[^;]+;/.test(value) && /;/.test(value)) {
            reject(`${path} must not contain CSS`);
        }
    }
}
function walkRejectMarkup(value, path) {
    assertNoMarkup(value, path);
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        value.forEach((v, i) => walkRejectMarkup(v, `${path}[${i}]`));
        return;
    }
    for (const [k, v] of Object.entries(value)) {
        if (k === 'style' || k === 'css' || k === 'html' || k === 'innerHTML' || k === 'markup') {
            reject(`${path}.${k} is not allowed`);
        }
        walkRejectMarkup(v, `${path}.${k}`);
    }
}
function parseSection(raw, index) {
    assertPlainObject(raw, `sections[${index}]`);
    assertOnlyKeys(raw, [
        'key',
        'order',
        'zone',
        'col_start',
        'col_span',
        'min_height_px',
        'max_height_px',
        'height_px',
        'alignment',
        'visible',
        'owner_locked',
    ], `sections[${index}]`);
    const key = String(raw.key ?? '');
    if (!SECTION_KEYS.has(key))
        reject(`sections[${index}].key is invalid`);
    const order = Number(raw.order);
    const col_start = Number(raw.col_start);
    const col_span = Number(raw.col_span);
    const min_height_px = Number(raw.min_height_px);
    const max_height_px = Number(raw.max_height_px);
    const height_px = Number(raw.height_px);
    if (!Number.isInteger(order) || order < 0)
        reject(`sections[${index}].order invalid`);
    if (!Number.isInteger(col_start) || col_start < 1 || col_start > 12) {
        reject(`sections[${index}].col_start out of bounds`);
    }
    if (!Number.isInteger(col_span) || col_span < 1 || col_start + col_span - 1 > 12) {
        reject(`sections[${index}].col_span out of bounds`);
    }
    if (!Number.isFinite(min_height_px) || min_height_px < 0)
        reject(`sections[${index}].min_height_px invalid`);
    if (!Number.isFinite(max_height_px) || max_height_px < min_height_px) {
        reject(`sections[${index}].max_height_px invalid`);
    }
    if (!Number.isFinite(height_px) || height_px < min_height_px || height_px > max_height_px) {
        reject(`sections[${index}].height_px out of constraints`);
    }
    const zone = String(raw.zone ?? '');
    if (zone !== 'upper' && zone !== 'body' && zone !== 'lower')
        reject(`sections[${index}].zone invalid`);
    const alignment = String(raw.alignment ?? 'stretch');
    if (!['start', 'center', 'end', 'stretch'].includes(alignment)) {
        reject(`sections[${index}].alignment invalid`);
    }
    return {
        key,
        order,
        zone: zone,
        col_start,
        col_span,
        min_height_px,
        max_height_px,
        height_px,
        alignment: alignment,
        visible: Boolean(raw.visible !== false),
        owner_locked: Boolean(raw.owner_locked),
    };
}
function parseField(raw, index) {
    assertPlainObject(raw, `fields[${index}]`);
    assertOnlyKeys(raw, [
        'field_key',
        'section_key',
        'order',
        'visible',
        'width_span',
        'display_variant',
        'owner_locked',
    ], `fields[${index}]`);
    const field_key = String(raw.field_key ?? '').trim();
    if (!isOwnerInvoiceCatalogFieldKey(field_key))
        reject(`fields[${index}].field_key unknown: ${field_key}`);
    const section_key = String(raw.section_key ?? '');
    if (!SECTION_KEYS.has(section_key))
        reject(`fields[${index}].section_key invalid`);
    const order = Number(raw.order);
    const width_span = Number(raw.width_span ?? 12);
    if (!Number.isInteger(order) || order < 0)
        reject(`fields[${index}].order invalid`);
    if (!Number.isInteger(width_span) || width_span < 1 || width_span > 12) {
        reject(`fields[${index}].width_span out of bounds`);
    }
    const visible = Boolean(raw.visible !== false);
    if (!visible) {
        const reason = fieldHideRejectedReason(field_key);
        if (reason)
            reject(reason);
    }
    return {
        field_key,
        section_key,
        order,
        visible,
        width_span,
        display_variant: String(raw.display_variant ?? 'default'),
        owner_locked: Boolean(raw.owner_locked),
    };
}
function parseTableColumn(raw, index) {
    assertPlainObject(raw, `table.columns[${index}]`);
    assertOnlyKeys(raw, ['key', 'order', 'visible', 'width_px', 'align', 'owner_locked'], `table.columns[${index}]`);
    const key = String(raw.key ?? '').trim();
    if (!key)
        reject(`table.columns[${index}].key required`);
    const order = Number(raw.order);
    if (!Number.isInteger(order) || order < 0)
        reject(`table.columns[${index}].order invalid`);
    const widthRaw = raw.width_px;
    const width_px = widthRaw == null || widthRaw === ''
        ? null
        : Number(widthRaw);
    if (width_px != null && (!Number.isFinite(width_px) || width_px < 0 || width_px > 756)) {
        reject(`table.columns[${index}].width_px out of bounds`);
    }
    const align = String(raw.align ?? 'start');
    if (!['start', 'center', 'end'].includes(align))
        reject(`table.columns[${index}].align invalid`);
    return {
        key,
        order,
        visible: Boolean(raw.visible !== false),
        width_px,
        align: align,
        owner_locked: Boolean(raw.owner_locked),
    };
}
export function parseAndValidateOwnerInvoiceLayoutDefinition(raw) {
    if (layoutJsonContainsForbiddenVatRateKeys(raw)) {
        reject('VAT rate / legal rate values are not allowed in layout definition');
    }
    assertPlainObject(raw, 'layout_definition');
    assertOnlyKeys(raw, ['schema_version', 'grid', 'sections', 'fields', 'table', 'user_branding_bounds'], 'layout_definition');
    walkRejectMarkup(raw, 'layout_definition');
    if (Number(raw.schema_version) !== 1)
        reject('schema_version must be 1');
    assertPlainObject(raw.grid, 'grid');
    assertOnlyKeys(raw.grid, ['columns', 'page', 'snap_px'], 'grid');
    assertPlainObject(raw.grid.page, 'grid.page');
    assertOnlyKeys(raw.grid.page, ['width_px', 'height_px'], 'grid.page');
    if (Number(raw.grid.columns) !== 12)
        reject('grid.columns must be 12');
    const width_px = Number(raw.grid.page.width_px);
    const height_px = Number(raw.grid.page.height_px);
    const snap_px = Number(raw.grid.snap_px);
    if (width_px !== 794 || height_px !== 1123)
        reject('grid.page must be A4 794×1123');
    if (!Number.isInteger(snap_px) || snap_px < 1 || snap_px > 64)
        reject('grid.snap_px invalid');
    if (!Array.isArray(raw.sections) || raw.sections.length === 0)
        reject('sections required');
    if (!Array.isArray(raw.fields) || raw.fields.length === 0)
        reject('fields required');
    assertPlainObject(raw.table, 'table');
    assertOnlyKeys(raw.table, ['columns'], 'table');
    if (!Array.isArray(raw.table.columns) || raw.table.columns.length === 0) {
        reject('table.columns required');
    }
    assertPlainObject(raw.user_branding_bounds, 'user_branding_bounds');
    assertOnlyKeys(raw.user_branding_bounds, ['logo_size_keys_allowed', 'color_theme_keys_allowed'], 'user_branding_bounds');
    const sections = raw.sections.map((s, i) => parseSection(s, i));
    const fields = raw.fields.map((f, i) => parseField(f, i));
    const columns = raw.table.columns.map((c, i) => parseTableColumn(c, i));
    const sectionKeys = new Set(sections.map((s) => s.key));
    for (const f of fields) {
        if (!sectionKeys.has(f.section_key)) {
            reject(`field ${f.field_key} references missing section ${f.section_key}`);
        }
    }
    const logoSizes = raw.user_branding_bounds.logo_size_keys_allowed;
    const themes = raw.user_branding_bounds.color_theme_keys_allowed;
    if (!Array.isArray(logoSizes) || logoSizes.length === 0) {
        reject('user_branding_bounds.logo_size_keys_allowed required');
    }
    if (!Array.isArray(themes) || themes.length === 0) {
        reject('user_branding_bounds.color_theme_keys_allowed required');
    }
    return {
        schema_version: 1,
        grid: {
            columns: 12,
            page: { width_px, height_px },
            snap_px,
        },
        sections,
        fields,
        table: { columns },
        user_branding_bounds: {
            logo_size_keys_allowed: logoSizes.map((x) => String(x)),
            color_theme_keys_allowed: themes.map((x) => String(x)),
        },
    };
}
export function assertSectionResizeWithinBounds(params) {
    const height = params.height_px ?? params.section.height_px;
    const col_span = params.col_span ?? params.section.col_span;
    const col_start = params.col_start ?? params.section.col_start;
    if (height < params.section.min_height_px || height > params.section.max_height_px) {
        reject('section height outside min/max constraints');
    }
    if (col_start < 1 || col_span < 1 || col_start + col_span - 1 > 12) {
        reject('section grid position out of bounds');
    }
    if (height % 8 !== 0) {
        reject('section height must snap to 8px grid');
    }
}
