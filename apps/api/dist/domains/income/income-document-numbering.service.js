/**
 * INC-4 — Backend-only income document numbering (atomic via Postgres RPC).
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
export async function allocateIncomeDocumentNumber(scope, documentType, issueDateIso, prefix) {
    const year = Number(issueDateIso.slice(0, 4));
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        throw badRequest('issue_date year is invalid');
    }
    const { data, error } = await supabaseAdmin.rpc('allocate_income_document_number', {
        p_organization_id: scope.org_id,
        p_issuer_business_id: scope.issuer_business_id,
        p_represented_client_id: scope.represented_client_id,
        p_document_type: documentType,
        p_year: year,
        p_prefix: prefix ?? null,
    });
    if (error)
        throw error;
    const row = data;
    if (!row?.document_number || row.sequence_number == null) {
        throw new Error('Failed to allocate income document number');
    }
    return {
        document_number: String(row.document_number),
        sequence_number: Number(row.sequence_number),
        year: Number(row.year ?? year),
    };
}
