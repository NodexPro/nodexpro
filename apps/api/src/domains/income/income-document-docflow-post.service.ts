/**
 * INV-1 P7 — post issued income document PDF to DocFlow thread (Income-owned orchestration).
 */

import { supabaseAdmin } from '../../db/client.js';
import { assertFileAssetInScope } from '../docflow/docflow.guards.js';
import { createSystemMessageCore } from '../docflow/docflow-system-message-core.service.js';

const INCOME_DOCFLOW_MODULE_KEY = 'income';
const INCOME_DOCFLOW_RULE_CODE = 'income_document_docflow_delivery';

export type PostIncomeDocumentToDocflowResult = {
  threadId: string;
  messageId: string;
  reusedExisting: boolean;
};

export async function postIncomeDocumentToDocflowThread(params: {
  orgId: string;
  representedClientId: string;
  incomeDocumentId: string;
  pdfAssetId: string;
  messageBody: string;
  messageSnapshotJson: Record<string, unknown>;
  idempotencyKey: string;
  actorUserId: string | null;
}): Promise<PostIncomeDocumentToDocflowResult> {
  const ruleContextKey = `income_document:${params.incomeDocumentId}`;
  const systemMessageIdempotencyKey = `income-docflow:${params.incomeDocumentId}:${params.idempotencyKey}`;

  const { threadId, messageId, reusedExisting } = await createSystemMessageCore({
    orgId: params.orgId,
    clientId: params.representedClientId,
    moduleKey: INCOME_DOCFLOW_MODULE_KEY,
    messageType: 'system',
    body: params.messageBody,
    idempotencyKey: systemMessageIdempotencyKey,
    ruleCode: INCOME_DOCFLOW_RULE_CODE,
    ruleContextKey,
    sendModeRaw: 'auto_send_allowed',
    autoSendAllowedByRule: true,
    allowPublishWithoutAutoSendRule: true,
    emitAutoSentEvent: true,
    threadIdInput: null,
    actorUserId: params.actorUserId,
  });

  await assertFileAssetInScope(params.orgId, params.pdfAssetId);

  const { error: attErr } = await supabaseAdmin.from('client_message_attachments').insert({
    org_id: params.orgId,
    client_id: params.representedClientId,
    thread_id: threadId,
    message_id: messageId,
    file_asset_id: params.pdfAssetId,
  });
  if (attErr && (attErr as { code?: string }).code !== '23505') throw attErr;

  if (!attErr) {
    await supabaseAdmin.from('client_message_events').insert({
      org_id: params.orgId,
      client_id: params.representedClientId,
      thread_id: threadId,
      message_id: messageId,
      event_type: 'message_attachment_added',
      actor_type: 'system',
      actor_user_id: params.actorUserId,
      payload_json: {
        org_id: params.orgId,
        client_id: params.representedClientId,
        module_key: INCOME_DOCFLOW_MODULE_KEY,
        thread_id: threadId,
        message_id: messageId,
        file_asset_id: params.pdfAssetId,
        source: 'income_document_docflow_delivery',
        income_document_id: params.incomeDocumentId,
      },
    });
  }

  return { threadId, messageId, reusedExisting };
}
