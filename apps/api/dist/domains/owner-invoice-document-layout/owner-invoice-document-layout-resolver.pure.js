/**
 * INV-13A — Layout source resolver + legacy bypass.
 *
 * Legacy (no owner layout version/snapshot):
 *   exact existing issued render path — do not load Owner DB layout.
 *
 * Layout-aware (snapshot or version present):
 *   structured definition → adapter metadata for canonical renderer.
 */
import { parseAndValidateOwnerInvoiceLayoutDefinition } from './owner-invoice-document-layout-schema.pure.js';
/**
 * Pure resolver — no DB. Used by issued HTML/PDF paths.
 */
export function resolveIssuedDocumentLayoutSource(doc) {
    const versionId = typeof doc.owner_layout_version_id === 'string' && doc.owner_layout_version_id.trim()
        ? doc.owner_layout_version_id.trim()
        : null;
    const snapshot = doc.owner_layout_snapshot_json;
    if (!versionId && (snapshot == null || snapshot === '')) {
        return { mode: 'legacy' };
    }
    if (snapshot != null && snapshot !== '') {
        const definition = parseAndValidateOwnerInvoiceLayoutDefinition(snapshot);
        return { mode: 'owner_layout', definition, version_id: versionId };
    }
    // Version id without snapshot is incomplete — treat as legacy to avoid
    // changing historical behavior or requiring Owner DB on old paths.
    return { mode: 'legacy' };
}
/**
 * Phase 1 adapter: map Owner layout → flags consumed by existing sectioned renderer.
 * Does not invent a second renderer. Legacy path never calls this.
 */
export function adaptOwnerLayoutDefinitionForCanonicalRenderer(definition) {
    const field_visibility = {};
    for (const f of definition.fields) {
        field_visibility[f.field_key] = f.visible;
    }
    const table_column_visibility = {};
    for (const c of definition.table.columns) {
        table_column_visibility[c.key] = c.visible;
    }
    return {
        document_style_key: 'sectioned',
        field_visibility,
        table_column_visibility,
        user_branding_bounds: definition.user_branding_bounds,
        layout_schema_version: 1,
    };
}
export function isLegacyIssuedLayoutPath(doc) {
    return resolveIssuedDocumentLayoutSource(doc).mode === 'legacy';
}
