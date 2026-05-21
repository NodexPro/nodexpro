/**
 * INC-8.5 — document date legality (issuer + document_type series).
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import type { IncomeDocumentType } from './income.types.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';

export const INCOME_ISSUE_DATE_BACKDATED_ERROR =
  'לא ניתן להפיק מסמך בתאריך מוקדם ממסמך שכבר הונפק בסדרה זו.';

export async function assertIncomeDocumentIssueDateAllowed(params: {
  scope: ActiveIncomeIssuerScope;
  documentType: IncomeDocumentType;
  issueDate: string;
}): Promise<void> {
  const { scope, documentType, issueDate } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw badRequest('document_date must be YYYY-MM-DD');
  }

  let q = supabaseAdmin
    .from('income_documents')
    .select('id, issue_date')
    .eq('organization_id', scope.org_id)
    .eq('issuer_business_id', scope.issuer_business_id)
    .eq('document_type', documentType)
    .eq('document_status', 'issued')
    .gt('issue_date', issueDate)
    .limit(1);

  if (scope.represented_client_id) {
    q = q.eq('represented_client_id', scope.represented_client_id);
  } else {
    q = q.is('represented_client_id', null);
  }

  const { data, error } = await q;
  if (error) throw error;
  if ((data ?? []).length > 0) {
    throw badRequest(INCOME_ISSUE_DATE_BACKDATED_ERROR, 'income_issue_date_backdated');
  }
}

export function resolveIssueDateFromDraft(
  draftDocumentDate: string | null | undefined,
  commandDocumentDate: string | null | undefined,
): string {
  const raw = commandDocumentDate ?? draftDocumentDate;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
    return String(raw).trim();
  }
  return new Date().toISOString().slice(0, 10);
}
