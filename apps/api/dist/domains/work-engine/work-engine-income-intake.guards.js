/**
 * Work Engine intake — Income invoice source_entity ownership guards (DB).
 */
import { supabaseAdmin } from '../../db/client.js';
import { assertIncomeDocumentIntakeOwnership, isIncomeDocumentIntake, } from './work-engine-income-intake.guards.pure.js';
export { INCOME_DOCUMENT_EVENTS_REQUIRING_ISSUED, INCOME_INTAKE_ENTITY_TYPE, INCOME_INTAKE_SOURCE_MODULE, assertIncomeDocumentIntakeOwnership, isIncomeDocumentIntake, } from './work-engine-income-intake.guards.pure.js';
export async function assertIncomeDocumentIntakeSourceEntity(ctx) {
    if (!isIncomeDocumentIntake(ctx))
        return;
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('organization_id, represented_client_id, document_status')
        .eq('id', ctx.source_entity_id)
        .maybeSingle();
    if (error)
        throw error;
    assertIncomeDocumentIntakeOwnership(data
        ? {
            organization_id: String(data.organization_id),
            represented_client_id: data.represented_client_id,
            document_status: String(data.document_status),
        }
        : null, ctx);
}
