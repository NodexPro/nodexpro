/**
 * Document card commands. Metadata write only — not payment settlement.
 * amount_total remains document-face metadata, not Accounting Base payment_status.
 */
import type { RequestContext } from '../../shared/context.js';
import * as documentsService from './documents.service.js';
import { getDocumentCardData, type DocumentCardData } from './document-card.service.js';

export type UpdateDocumentCommandBody = Partial<{
  title: string;
  document_type_code: string;
  document_date: string | null;
  amount_total: number | null;
  currency: string | null;
}>;

function pickUpdateDocumentBody(body: Record<string, unknown>): UpdateDocumentCommandBody {
  const out: UpdateDocumentCommandBody = {};
  if (body.title !== undefined) out.title = body.title === null ? '' : String(body.title);
  if (typeof body.document_type_code === 'string') out.document_type_code = body.document_type_code;
  if (body.document_date !== undefined) {
    out.document_date = body.document_date === null ? null : String(body.document_date);
  }
  if (body.amount_total !== undefined) {
    if (body.amount_total === null) out.amount_total = null;
    else if (typeof body.amount_total === 'number' && Number.isFinite(body.amount_total)) {
      out.amount_total = body.amount_total;
    }
  }
  if (body.currency !== undefined) out.currency = body.currency === null ? null : String(body.currency);
  return out;
}

export async function executeUpdateDocumentCommand(
  ctx: RequestContext,
  orgId: string,
  documentId: string,
  body: Record<string, unknown>,
): Promise<DocumentCardData> {
  await documentsService.updateDocument(ctx, orgId, documentId, pickUpdateDocumentBody(body));
  return getDocumentCardData(ctx, orgId, documentId);
}
