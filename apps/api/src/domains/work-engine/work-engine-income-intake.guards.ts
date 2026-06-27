/**
 * Work Engine intake — Income invoice source_entity ownership guards (DB).
 */

import { supabaseAdmin } from '../../db/client.js';
import {
  assertIncomeDocumentIntakeOwnership,
  isIncomeDocumentIntake,
  type IncomeDocumentIntakeOwnershipContext,
} from './work-engine-income-intake.guards.pure.js';

export type { IncomeDocumentIntakeOwnershipContext, IncomeDocumentOwnershipRow } from './work-engine-income-intake.guards.pure.js';
export {
  INCOME_DOCUMENT_EVENTS_REQUIRING_ISSUED,
  INCOME_INTAKE_ENTITY_TYPE,
  INCOME_INTAKE_SOURCE_MODULE,
  assertIncomeDocumentIntakeOwnership,
  isIncomeDocumentIntake,
} from './work-engine-income-intake.guards.pure.js';

export async function assertIncomeDocumentIntakeSourceEntity(
  ctx: IncomeDocumentIntakeOwnershipContext,
): Promise<void> {
  if (!isIncomeDocumentIntake(ctx)) return;

  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('organization_id, represented_client_id, document_status')
    .eq('id', ctx.source_entity_id)
    .maybeSingle();
  if (error) throw error;

  assertIncomeDocumentIntakeOwnership(
    data
      ? {
          organization_id: String((data as { organization_id: string }).organization_id),
          represented_client_id: (data as { represented_client_id: string | null }).represented_client_id,
          document_status: String((data as { document_status: string }).document_status),
        }
      : null,
    ctx,
  );
}
