/**
 * INV-13A — Canonical issue freeze contract (future + Phase 1 wiring).
 *
 * Only NEW issued documents after deploy may receive freeze fields.
 * Historical rows stay null → legacy renderer path.
 * No backfill. No Owner DB lookup on legacy issued render.
 */
import { parseAndValidateOwnerInvoiceLayoutDefinition } from './owner-invoice-document-layout-schema.pure.js';
/**
 * Build freeze payload from an active published Owner layout row.
 * Returns null when no published layout (issue continues legacy / null freeze).
 */
export function buildOwnerInvoiceLayoutIssueFreezeFromPublished(row) {
    if (!row || row.status !== 'published')
        return null;
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : '';
    if (!id)
        return null;
    const snapshot = parseAndValidateOwnerInvoiceLayoutDefinition(row.layout_definition_json);
    return {
        owner_layout_version_id: id,
        owner_layout_snapshot_json: snapshot,
    };
}
