/**
 * INV-1 P3 — Income email command orchestrator.
 * Income owns validation, sender, message, PDF; Delivery owns ledger + transport only.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { loadClientOperationsCoreClient } from '../client-operations/client-operations-client-core.read.js';
import {
  beginAttempt,
  finalizeAttempt,
  sendEmail,
  type DeliveryAttemptRecord,
  type DeliveryEmailSendResult,
} from '../delivery/index.js';
import {
  assertRowMatchesIssuerScope,
  reqUuid,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import {
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import { loadResolvedBrandingProfileForDocumentType } from './income-document-branding.service.js';
import {
  assertIncomeDocumentReadyForEmailSend,
  assertIncomeRepresentedClientScopeForEmailSend,
  buildIncomeDocumentEmailDeliveryIdempotencyKey,
  buildIncomeDocumentEmailMessage,
  buildIncomeDocumentEmailTemplateValues,
  buildIncomeEmailSenderSnapshot,
  customerDisplayNameFromSnapshot,
  normalizeIncomeDocumentRecipientEmail,
  parseIncomeDocumentEmailIdempotencyKey,
  type IncomeIssuedDocumentEmailReadiness,
} from './income-document-email-delivery.pure.js';
import { loadIssuedDocumentPdfBytesForEmail } from './income-document-pdf.service.js';
import { documentTypeLabel } from './income-pdf-template.resolver.js';
import { emitIncomeWorkEventAfterDocumentSentByEmail } from './income-work-engine-bridge.js';
import type { IncomeDocumentType } from './income.types.js';

const SOURCE_MODULE = 'income';
const SOURCE_ENTITY_TYPE = 'income_document';

export type SendIncomeDocumentByEmailResult = {
  deliveryAttemptId: string;
  deliveryResult: 'sent' | 'failed';
  idempotentReplay: boolean;
  providerMessageId: string | null;
  failureReason: string | null;
};

export type IncomeDocumentEmailDeliveryDeps = {
  beginAttempt: typeof beginAttempt;
  sendEmail: typeof sendEmail;
  finalizeAttempt: typeof finalizeAttempt;
};

const defaultDeps: IncomeDocumentEmailDeliveryDeps = {
  beginAttempt,
  sendEmail,
  finalizeAttempt,
};

async function loadIssuedDocumentForEmail(
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

export async function executeSendIncomeDocumentByEmail(
  ctx: RequestContext,
  body: Record<string, unknown>,
  deps: IncomeDocumentEmailDeliveryDeps = defaultDeps,
): Promise<SendIncomeDocumentByEmailResult> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeIssuePermission(scope);

  const incomeDocumentId = reqUuid(body.income_document_id, 'income_document_id');
  const recipientEmail = normalizeIncomeDocumentRecipientEmail(body.recipient_email);
  const commandIdempotencyKey = parseIncomeDocumentEmailIdempotencyKey(body);
  const representedClientId = assertIncomeRepresentedClientScopeForEmailSend(scope.represented_client_id);

  const doc = await loadIssuedDocumentForEmail(scope.org_id, incomeDocumentId);
  assertRowMatchesIssuerScope(scope, doc);
  assertIncomeDocumentReadyForEmailSend(doc);

  if (doc.represented_client_id !== representedClientId) {
    throw badRequest('Document is outside active represented client scope');
  }

  const client = await loadClientOperationsCoreClient(scope.org_id, representedClientId);
  if (!client) throw notFound('Represented client profile not found');

  const branding = await loadResolvedBrandingProfileForDocumentType(scope, doc.document_type);
  const language = doc.language === 'en' ? 'en' : 'he';
  const templateValues = buildIncomeDocumentEmailTemplateValues({
    documentTypeLabel: documentTypeLabel(doc.document_type as IncomeDocumentType, language),
    documentNumber: doc.document_number,
    clientName: customerDisplayNameFromSnapshot(doc.customer_snapshot_json),
    businessName: client.display_name,
  });
  const emailMessage = buildIncomeDocumentEmailMessage({
    branding,
    templateValues,
    replyTo: client.email?.trim() || null,
  });

  const pdf = await loadIssuedDocumentPdfBytesForEmail(scope.org_id, doc.pdf_asset_id!);
  const senderSnapshot = buildIncomeEmailSenderSnapshot(client);
  const deliveryIdempotencyKey = buildIncomeDocumentEmailDeliveryIdempotencyKey(
    incomeDocumentId,
    commandIdempotencyKey,
  );

  const attempt = await deps.beginAttempt({
    organizationId: scope.org_id,
    representedClientId,
    sourceModule: SOURCE_MODULE,
    sourceEntityType: SOURCE_ENTITY_TYPE,
    sourceEntityId: incomeDocumentId,
    channel: 'email',
    recipientEmail,
    senderSnapshotJson: senderSnapshot,
    messageSnapshotJson: emailMessage.message_snapshot_json,
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
  let sendResult: DeliveryEmailSendResult | null = null;

  if (!idempotentReplay) {
    sendResult = await deps.sendEmail({
      organizationId: scope.org_id,
      to: recipientEmail,
      reply_to: emailMessage.reply_to,
      subject: emailMessage.subject,
      body_text: emailMessage.body_text,
      body_html: emailMessage.body_html,
      attachments: [
        {
          filename: pdf.fileName,
          content_type: 'application/pdf',
          content_base64: pdf.buffer.toString('base64'),
        },
      ],
    });

    finalized = await deps.finalizeAttempt({
      attemptId: attempt.id,
      organizationId: scope.org_id,
      result: sendResult.status,
      failureReason: sendResult.failure_reason,
      providerMessageId: sendResult.provider_message_id,
    });
  }

  const deliveryResult = finalized.result === 'sent' ? 'sent' : 'failed';
  const failureReason = finalized.failureReason;
  const providerMessageId = finalized.providerMessageId;

  if (!idempotentReplay) {
    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: scope.actor_user_id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action:
        deliveryResult === 'sent'
          ? AUDIT_ACTIONS.INCOME_DOCUMENT_EMAIL_SENT
          : AUDIT_ACTIONS.INCOME_DOCUMENT_EMAIL_SEND_FAILED,
      payload: {
        delivery_attempt_id: finalized.id,
        recipient_email: recipientEmail,
        provider_message_id: providerMessageId,
        failure_reason: failureReason,
      },
    });

    if (deliveryResult === 'sent') {
      void emitIncomeWorkEventAfterDocumentSentByEmail({
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
        recipientEmail,
        deliveryAttemptId: finalized.id,
        providerMessageId,
      }).catch(() => {
        /* fire-and-forget */
      });
    }
  }

  return {
    deliveryAttemptId: finalized.id,
    deliveryResult,
    idempotentReplay,
    providerMessageId,
    failureReason,
  };
}
