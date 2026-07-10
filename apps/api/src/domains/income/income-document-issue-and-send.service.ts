/**
 * INV-2.2C — Issue & Send orchestrator (single command entry point).
 * Reuses issue_income_document + send_income_document_by_email pipelines only.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { parseRecurringCycleReviewCommandContext } from '../work-engine/work-engine-invoice-retainer-cycle-draft-review-context.pure.js';
import { reqUuid } from './income.guards.js';
import {
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import { executeIssueIncomeDocument } from './income-document-issue.service.js';
import {
  executeSendIncomeDocumentByEmail,
  type SendIncomeDocumentByEmailResult,
} from './income-document-email-delivery.service.js';
import { renderIncomeDocumentPdf } from './income-document-pdf.service.js';
import { resolveIssueAndSendRecipientEmail } from './income-document-issue-and-send.pure.js';
import {
  abortIncomeIssueAndSendIdempotency,
  beginIncomeIssueAndSendIdempotency,
  completeIncomeIssueAndSendIdempotency,
  parseIssueAndSendIdempotencyKey,
  type IncomeIssueAndSendIdempotencyLease,
} from './income-issue-and-send-idempotency.js';

export type IssueAndSendIncomeDocumentResult = {
  issuedDocumentId: string;
  deliveryAttemptId: string | null;
  deliveryResult: 'sent' | 'failed' | 'not_attempted';
  idempotentReplay: boolean;
  providerMessageId: string | null;
  failureReason: string | null;
};

async function loadDraftDeliveryContactJson(
  orgId: string,
  draftId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('delivery_contact_json')
    .eq('organization_id', orgId)
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { delivery_contact_json?: Record<string, unknown> | null } | null;
  return row?.delivery_contact_json ?? null;
}

async function ensureIssuedDocumentPdfReady(
  ctx: RequestContext,
  orgId: string,
  incomeDocumentId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('pdf_render_status, pdf_asset_id')
    .eq('organization_id', orgId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { pdf_render_status?: string; pdf_asset_id?: string | null } | null;
  if (row?.pdf_render_status === 'rendered' && row.pdf_asset_id) return;
  await renderIncomeDocumentPdf(ctx, orgId, incomeDocumentId);
}

function toDeliveryOutcome(
  sendResult: SendIncomeDocumentByEmailResult | null,
  sendErrorMessage: string | null,
): Pick<
  IssueAndSendIncomeDocumentResult,
  'deliveryAttemptId' | 'deliveryResult' | 'providerMessageId' | 'failureReason'
> {
  if (sendResult) {
    return {
      deliveryAttemptId: sendResult.deliveryAttemptId,
      deliveryResult: sendResult.deliveryResult,
      providerMessageId: sendResult.providerMessageId,
      failureReason: sendResult.failureReason,
    };
  }
  return {
    deliveryAttemptId: null,
    deliveryResult: 'failed',
    providerMessageId: null,
    failureReason: sendErrorMessage ?? 'שליחת המסמך נכשלה',
  };
}

async function runEmailSendStep(
  ctx: RequestContext,
  params: {
    issuedDocumentId: string;
    recipientEmail: string;
    idempotencyKey: string;
  },
): Promise<SendIncomeDocumentByEmailResult | null> {
  try {
    return await executeSendIncomeDocumentByEmail(ctx, {
      income_document_id: params.issuedDocumentId,
      recipient_email: params.recipientEmail,
      idempotency_key: params.idempotencyKey,
    });
  } catch {
    return null;
  }
}

async function writeIssueAndSendAudit(params: {
  ctx: RequestContext;
  orgId: string;
  draftId: string;
  issuedDocumentId: string;
  deliveryAttemptId: string | null;
  deliveryResult: 'sent' | 'failed' | 'not_attempted';
  recipientEmail: string;
  reviewContext: ReturnType<typeof parseRecurringCycleReviewCommandContext>;
  idempotentReplay: boolean;
}): Promise<void> {
  if (params.idempotentReplay) return;
  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.ctx.user?.id ?? null,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: params.issuedDocumentId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_ISSUE_AND_SEND,
    payload: {
      source_draft_id: params.draftId,
      generated_draft_id: params.reviewContext?.generated_draft_id ?? params.draftId,
      recurring_cycle_id: params.reviewContext?.cycle_id ?? null,
      profile_id: params.reviewContext?.profile_id ?? null,
      issued_document_id: params.issuedDocumentId,
      delivery_attempt_id: params.deliveryAttemptId,
      delivery_result: params.deliveryResult,
      recipient_email: params.recipientEmail,
    },
  });
}

async function finishIssueAndSend(
  ctx: RequestContext,
  params: {
    draftId: string;
    issuedDocumentId: string;
    recipientEmail: string;
    idempotencyKey: string;
    lease: IncomeIssueAndSendIdempotencyLease | null;
    reviewContext: ReturnType<typeof parseRecurringCycleReviewCommandContext>;
    idempotentReplay: boolean;
  },
): Promise<IssueAndSendIncomeDocumentResult> {
  const scope = await loadActiveIncomeIssuerScope(ctx);

  await ensureIssuedDocumentPdfReady(ctx, scope.org_id, params.issuedDocumentId);

  const sendResult = await runEmailSendStep(ctx, {
    issuedDocumentId: params.issuedDocumentId,
    recipientEmail: params.recipientEmail,
    idempotencyKey: params.idempotencyKey,
  });
  const delivery = toDeliveryOutcome(
    sendResult,
    sendResult ? null : 'שליחת המסמך נכשלה',
  );

  if (params.lease?.kind === 'fresh') {
    await completeIncomeIssueAndSendIdempotency({
      leaseRowId: params.lease.leaseRowId,
      incomeDocumentId: params.issuedDocumentId,
      sourceDraftId: params.draftId,
    });
  }

  await writeIssueAndSendAudit({
    ctx,
    orgId: scope.org_id,
    draftId: params.draftId,
    issuedDocumentId: params.issuedDocumentId,
    deliveryAttemptId: delivery.deliveryAttemptId,
    deliveryResult: delivery.deliveryResult,
    recipientEmail: params.recipientEmail,
    reviewContext: params.reviewContext,
    idempotentReplay: params.idempotentReplay,
  });

  return {
    issuedDocumentId: params.issuedDocumentId,
    idempotentReplay: params.idempotentReplay,
    ...delivery,
  };
}

export async function executeIssueAndSendIncomeDocument(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IssueAndSendIncomeDocumentResult> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeIssuePermission(scope);

  const draftId = reqUuid(body.draft_id, 'draft_id');
  const idempotencyKey = parseIssueAndSendIdempotencyKey(body);
  const reviewContext = parseRecurringCycleReviewCommandContext(body);
  const deliveryContactJson = await loadDraftDeliveryContactJson(scope.org_id, draftId);
  const recipientEmail = resolveIssueAndSendRecipientEmail({
    body_recipient_email: body.recipient_email,
    draft_delivery_contact_json: deliveryContactJson,
  });

  const lease = await beginIncomeIssueAndSendIdempotency({
    organizationId: scope.org_id,
    idempotencyKey,
    sourceDraftId: draftId,
  });

  if (lease.kind === 'replay') {
    return finishIssueAndSend(ctx, {
      draftId,
      issuedDocumentId: lease.incomeDocumentId,
      recipientEmail,
      idempotencyKey,
      lease: null,
      reviewContext,
      idempotentReplay: true,
    });
  }

  try {
    const issueResult = await executeIssueIncomeDocument(ctx, { draft_id: draftId });
    return finishIssueAndSend(ctx, {
      draftId,
      issuedDocumentId: issueResult.issuedDocumentId,
      recipientEmail,
      idempotencyKey,
      lease,
      reviewContext,
      idempotentReplay: issueResult.idempotentReplay,
    });
  } catch (error) {
    await abortIncomeIssueAndSendIdempotency(lease.leaseRowId);
    throw error;
  }
}
