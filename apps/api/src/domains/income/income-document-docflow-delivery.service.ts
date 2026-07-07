/**
 * INV-1 P7 — Income DocFlow command orchestrator.
 * Income owns validation, PDF, message; DocFlow owns thread/message; Delivery owns ledger.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { assertDocflowEntitled } from '../docflow/docflow.guards.js';
import { beginAttempt, finalizeAttempt, type DeliveryAttemptRecord } from '../delivery/index.js';
import { loadClientOperationsCoreClient } from '../client-operations/client-operations-client-core.read.js';
import {
  assertRowMatchesIssuerScope,
  reqUuid,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import {
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import {
  assertIncomeDocumentReadyForDocflowSend,
  assertIncomeRepresentedClientScopeForDocflowSend,
  buildIncomeDocumentDocflowDeliveryIdempotencyKey,
  buildIncomeDocumentDocflowMessageSnapshot,
  buildIncomeDocflowSenderSnapshot,
  parseIncomeDocumentDocflowIdempotencyKey,
} from './income-document-docflow-delivery.pure.js';
import {
  customerDisplayNameFromSnapshot,
  type IncomeIssuedDocumentEmailReadiness,
} from './income-document-email-delivery.pure.js';
import { postIncomeDocumentToDocflowThread } from './income-document-docflow-post.service.js';
import {
  isDocflowEntitledForOrg,
  loadRepresentedClientDocflowPortalActive,
} from './income-document-email-delivery.read-model.service.js';
import { loadIssuedDocumentPdfBytesForEmail } from './income-document-pdf.service.js';
import { documentTypeLabel } from './income-pdf-template.resolver.js';
import { emitIncomeWorkEventAfterDocumentSentByDocflow } from './income-work-engine-bridge.js';
import type { IncomeDocumentType } from './income.types.js';

const SOURCE_MODULE = 'income';
const SOURCE_ENTITY_TYPE = 'income_document';

export type SendIncomeDocumentByDocflowResult = {
  deliveryAttemptId: string;
  deliveryResult: 'sent' | 'failed';
  idempotentReplay: boolean;
  docflowThreadId: string | null;
  docflowMessageId: string | null;
  failureReason: string | null;
};

export type IncomeDocumentDocflowDeliveryDeps = {
  beginAttempt: typeof beginAttempt;
  finalizeAttempt: typeof finalizeAttempt;
  postToDocflow: typeof postIncomeDocumentToDocflowThread;
  assertDocflowEntitled: typeof assertDocflowEntitled;
  loadPortalActive: typeof loadRepresentedClientDocflowPortalActive;
  isDocflowEntitled: typeof isDocflowEntitledForOrg;
};

const defaultDeps: IncomeDocumentDocflowDeliveryDeps = {
  beginAttempt,
  finalizeAttempt,
  postToDocflow: postIncomeDocumentToDocflowThread,
  assertDocflowEntitled,
  loadPortalActive: loadRepresentedClientDocflowPortalActive,
  isDocflowEntitled: isDocflowEntitledForOrg,
};

async function loadIssuedDocumentForDocflow(
  orgId: string,
  incomeDocumentId: string,
): Promise<IncomeIssuedDocumentEmailReadiness> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, issue_date, due_date, currency, pdf_render_status, pdf_asset_id, customer_snapshot_json, totals_snapshot_json, language',
    )
    .eq('id', incomeDocumentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income document not found');
  return data as IncomeIssuedDocumentEmailReadiness;
}

export async function executeSendIncomeDocumentByDocflow(
  ctx: RequestContext,
  body: Record<string, unknown>,
  deps: IncomeDocumentDocflowDeliveryDeps = defaultDeps,
): Promise<SendIncomeDocumentByDocflowResult> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeIssuePermission(scope);

  const incomeDocumentId = reqUuid(body.income_document_id, 'income_document_id');
  const commandIdempotencyKey = parseIncomeDocumentDocflowIdempotencyKey(body);
  const representedClientId = assertIncomeRepresentedClientScopeForDocflowSend(scope.represented_client_id);

  await deps.assertDocflowEntitled(scope.org_id);
  const portalActive = await deps.loadPortalActive(scope.org_id, representedClientId);
  if (!portalActive) {
    throw badRequest('Represented client does not have an active DocFlow portal');
  }

  const doc = await loadIssuedDocumentForDocflow(scope.org_id, incomeDocumentId);
  assertRowMatchesIssuerScope(scope, doc);
  assertIncomeDocumentReadyForDocflowSend(doc);

  if (doc.represented_client_id !== representedClientId) {
    throw badRequest('Document is outside active represented client scope');
  }

  const client = await loadClientOperationsCoreClient(scope.org_id, representedClientId);
  if (!client) throw notFound('Represented client profile not found');

  const language = doc.language === 'en' ? 'en' : 'he';
  const messageSnapshot = buildIncomeDocumentDocflowMessageSnapshot({
    documentTypeLabel: documentTypeLabel(doc.document_type as IncomeDocumentType, language),
    documentNumber: doc.document_number,
    clientDisplayName: customerDisplayNameFromSnapshot(doc.customer_snapshot_json),
    businessName: client.display_name,
  });
  const messageBody = String(messageSnapshot.body ?? '');

  const pdf = await loadIssuedDocumentPdfBytesForEmail(scope.org_id, doc.pdf_asset_id!);
  const senderSnapshot = buildIncomeDocflowSenderSnapshot(client);
  const deliveryIdempotencyKey = buildIncomeDocumentDocflowDeliveryIdempotencyKey(
    incomeDocumentId,
    commandIdempotencyKey,
  );

  const attempt = await deps.beginAttempt({
    organizationId: scope.org_id,
    representedClientId,
    sourceModule: SOURCE_MODULE,
    sourceEntityType: SOURCE_ENTITY_TYPE,
    sourceEntityId: incomeDocumentId,
    channel: 'docflow',
    recipientEmail: null,
    senderSnapshotJson: senderSnapshot,
    messageSnapshotJson: messageSnapshot,
    attachmentRefsJson: [
      {
        asset_id: doc.pdf_asset_id,
        storage_ref: `${pdf.storageBucket}/${pdf.storageKey}`,
        filename: pdf.fileName,
        content_type: 'application/pdf',
      },
    ],
    idempotencyKey: deliveryIdempotencyKey,
    sentByUserId: scope.actor_user_id,
  });

  const idempotentReplay = attempt.result !== 'pending';
  let finalized: DeliveryAttemptRecord = attempt;
  let docflowThreadId: string | null = attempt.docflowThreadId;
  let docflowMessageId: string | null = attempt.docflowMessageId;

  if (!idempotentReplay) {
    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: scope.actor_user_id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action: AUDIT_ACTIONS.INCOME_DOCUMENT_DOCFLOW_SEND_ATTEMPTED,
      payload: {
        delivery_attempt_id: attempt.id,
        represented_client_id: representedClientId,
      },
    });

    let postResult: Awaited<ReturnType<typeof postIncomeDocumentToDocflowThread>> | null = null;
    let failureReason: string | null = null;
    try {
      postResult = await deps.postToDocflow({
        orgId: scope.org_id,
        representedClientId,
        incomeDocumentId,
        pdfAssetId: doc.pdf_asset_id!,
        messageBody,
        messageSnapshotJson: messageSnapshot,
        idempotencyKey: commandIdempotencyKey,
        actorUserId: scope.actor_user_id,
      });
      docflowThreadId = postResult.threadId;
      docflowMessageId = postResult.messageId;
    } catch (err) {
      failureReason = (err as { message?: string })?.message ?? String(err);
    }

    finalized = await deps.finalizeAttempt({
      attemptId: attempt.id,
      organizationId: scope.org_id,
      result: postResult ? 'sent' : 'failed',
      failureReason,
      docflowThreadId,
      docflowMessageId,
    });

    const deliveryResult = finalized.result === 'sent' ? 'sent' : 'failed';
    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: scope.actor_user_id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action:
        deliveryResult === 'sent'
          ? AUDIT_ACTIONS.INCOME_DOCUMENT_DOCFLOW_POSTED
          : AUDIT_ACTIONS.INCOME_DOCUMENT_DOCFLOW_FAILED,
      payload: {
        delivery_attempt_id: finalized.id,
        docflow_thread_id: docflowThreadId,
        docflow_message_id: docflowMessageId,
        failure_reason: failureReason,
      },
    });

    if (deliveryResult === 'sent' && docflowThreadId && docflowMessageId) {
      void emitIncomeWorkEventAfterDocumentSentByDocflow({
        ctx,
        orgId: scope.org_id,
        incomeDocumentId,
        representedClientId,
        documentType: doc.document_type,
        documentNumber: doc.document_number,
        issueDate: doc.issue_date,
        dueDate: doc.due_date,
        currency: doc.currency ?? 'ILS',
        customerSnapshotJson: doc.customer_snapshot_json ?? {},
        totalsSnapshotJson: doc.totals_snapshot_json,
        deliveryAttemptId: finalized.id,
        docflowThreadId,
        docflowMessageId,
      }).catch(() => {
        /* fire-and-forget */
      });
    }
  }

  const deliveryResult = finalized.result === 'sent' ? 'sent' : 'failed';

  return {
    deliveryAttemptId: finalized.id,
    deliveryResult,
    idempotentReplay,
    docflowThreadId: finalized.docflowThreadId,
    docflowMessageId: finalized.docflowMessageId,
    failureReason: finalized.failureReason,
  };
}
