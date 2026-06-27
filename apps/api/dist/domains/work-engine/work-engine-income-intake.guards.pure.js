/**
 * Work Engine intake — Income invoice source_entity ownership guards (pure).
 */
import { badRequest, forbidden } from '../../shared/errors.js';
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUuid(v) {
    return UUID_REGEX.test(v);
}
export const INCOME_INTAKE_SOURCE_MODULE = 'income';
export const INCOME_INTAKE_ENTITY_TYPE = 'income_document';
export const INCOME_DOCUMENT_EVENTS_REQUIRING_ISSUED = new Set([
    'income.document_issued',
    'income.invoice_due_date_set',
    'income.invoice_overdue',
    'income.credit_document_issued',
]);
export function isIncomeDocumentIntake(ctx) {
    return (ctx.source_module === INCOME_INTAKE_SOURCE_MODULE &&
        ctx.source_entity_type === INCOME_INTAKE_ENTITY_TYPE);
}
/**
 * Validates that an income_document row belongs to the intake org/client and
 * (when required) is issued. Throws on mismatch — never silently accepts.
 */
export function assertIncomeDocumentIntakeOwnership(doc, ctx) {
    if (!isIncomeDocumentIntake(ctx))
        return;
    if (!isUuid(ctx.source_entity_id)) {
        throw badRequest('source_entity_id must be a uuid for income_document intake', 'income_document_invalid_id');
    }
    if (!doc) {
        throw badRequest(`income document ${ctx.source_entity_id} not found`, 'income_document_not_found');
    }
    if (doc.organization_id !== ctx.org_id) {
        throw forbidden('income document does not belong to organization', 'income_document_org_mismatch');
    }
    if (!doc.represented_client_id || doc.represented_client_id !== ctx.client_id) {
        throw forbidden('income document client does not match event client_id', 'income_document_client_mismatch');
    }
    if (INCOME_DOCUMENT_EVENTS_REQUIRING_ISSUED.has(ctx.event_type) &&
        doc.document_status !== 'issued') {
        throw badRequest('income document must be issued', 'income_document_not_issued');
    }
}
