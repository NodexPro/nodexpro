import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden, notFound } from '../../shared/errors.js';
import { createOpaqueToken, resolvePortalSessionByRawToken, sha256Hex } from './docflow-portal-auth.service.js';
import {
  buildClientDocflowTabAggregate,
  buildClientPortalInboxAggregate,
  buildDocflowInvitesManagementAggregate,
} from './docflow-read-models.service.js';
import type { DocflowCommandPayload, DocflowCommandResponse, DocflowCommandType } from './docflow.types.js';
import {
  asOptionalString,
  assertClientBelongsToOrg,
  assertDocflowEntitled,
  assertFileAssetInScope,
  assertDocflowMessageScope,
  assertDocflowThreadScope,
  assertOfficeScope,
  canTransitionThreadStatus,
  reqDateTimeIso,
  reqString,
} from './docflow.guards.js';
import { createSystemMessageCore } from './docflow-system-message-core.service.js';
import { executeDocflowCommunicationOfficeCommand } from './docflow-communication-rule.service.js';
import { sendInviteSms } from './docflow-invite-delivery.adapter.js';
import { createEmailDeliveryAdapter } from './email-delivery.adapter.js';
import { resolveEmailProvider } from '../../shared/owner-email-provider-config.service.js';
import { getPlatformPublicUrlForInvite } from '../../shared/owner-email-provider-config.service.js';

function ensureObj(value: unknown): DocflowCommandPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DocflowCommandPayload) : {};
}

async function audit(
  organizationId: string,
  actorUserId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  payload: Record<string, unknown>,
  moduleCode: string | null = 'docflow'
): Promise<void> {
  await writeAudit({
    organizationId,
    actorUserId,
    moduleCode,
    entityType,
    entityId,
    action,
    payload,
  });
}

async function refreshOffice(orgId: string, clientId: string, selectedThreadId?: string | null): Promise<DocflowCommandResponse['refreshed']> {
  return {
    aggregate_key: 'client_docflow_tab_aggregate',
    aggregate: await buildClientDocflowTabAggregate({ orgId, clientId, selectedThreadId }),
  };
}

async function refreshPortal(orgId: string, clientId: string, portalUserId: string, selectedThreadId?: string | null): Promise<DocflowCommandResponse['refreshed']> {
  return {
    aggregate_key: 'client_portal_inbox_aggregate',
    aggregate: await buildClientPortalInboxAggregate({ orgId, clientId, portalUserId, selectedThreadId }),
  };
}

function parseInvitesRefreshParams(payload: DocflowCommandPayload): {
  page: number;
  pageSize: number;
  searchClient: string | null;
  inviteStatus: string | null;
} {
  return {
    page: Number(payload.page ?? 1) || 1,
    pageSize: Number(payload.page_size ?? 25) || 25,
    searchClient: asOptionalString(payload.search_client),
    inviteStatus: asOptionalString(payload.invite_status),
  };
}

async function refreshInvitesManagement(orgId: string, payload: DocflowCommandPayload): Promise<DocflowCommandResponse['refreshed']> {
  const p = parseInvitesRefreshParams(payload);
  return {
    aggregate_key: 'docflow_invites_management_aggregate',
    aggregate: await buildDocflowInvitesManagementAggregate({
      orgId,
      page: p.page,
      pageSize: p.pageSize,
      searchClient: p.searchClient,
      inviteStatus: p.inviteStatus,
    }),
  };
}

async function createDocflowInviteForClient(params: {
  orgId: string;
  clientId: string;
  actorUserId: string;
  emailRaw?: string | null;
  phoneRaw?: string | null;
  expiresInHours?: number;
}): Promise<{ inviteId: string; rawToken: string }> {
  const email = String(params.emailRaw ?? '')
    .trim()
    .toLowerCase();
  const phoneDigits = String(params.phoneRaw ?? '').replace(/\D/g, '');
  const channelIdentifier = email || (phoneDigits ? `phone-${phoneDigits}@docflow.local` : '');
  if (!channelIdentifier) throw badRequest('Client invite channel is required', 'missing_client_contact_channel');
  const expiresInHours = Number(params.expiresInHours ?? 72);
  if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 24 * 30) {
    throw badRequest('expires_in_hours out of allowed range');
  }

  const rawToken = createOpaqueToken();
  const tokenHash = sha256Hex(rawToken);
  const { data: portalUser, error: puErr } = await supabaseAdmin
    .from('client_portal_users')
    .upsert(
      {
        org_id: params.orgId,
        client_id: params.clientId,
        email_normalized: channelIdentifier,
        status: 'invited',
        auth_method: 'magic_link',
      },
      { onConflict: 'org_id,client_id,email_normalized' }
    )
    .select('id')
    .single();
  if (puErr) throw puErr;

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('client_portal_invitations')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      portal_user_id: portalUser.id,
      invite_email_normalized: channelIdentifier,
      invite_token_hash: tokenHash,
      token_expires_at: expiresAt,
      status: 'pending',
      issued_by_user_id: params.actorUserId,
    })
    .select('id')
    .single();
  if (invErr) throw invErr;

  await supabaseAdmin.from('client_message_events').insert({
    org_id: params.orgId,
    client_id: params.clientId,
    event_type: 'invitation_created',
    actor_type: 'office',
    actor_user_id: params.actorUserId,
    payload_json: { invitation_id: invite.id },
  });
  await audit(params.orgId, params.actorUserId, 'docflow_invitation', invite.id, 'invitation_created', {
    client_id: params.clientId,
  });
  return { inviteId: String(invite.id), rawToken };
}

function resolveInviteDeliveryErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'delivery_failed');
  if (raw.includes('sms_provider_not_configured')) return 'sms_provider_not_configured: ספק SMS לא מוגדר';
  if (raw.includes('email_provider_not_configured')) return 'email_provider_not_configured: ספק אימייל לא מוגדר';
  return `delivery_failed: ${raw}`;
}

const DOCFLOW_COMMUNICATION_COMMANDS: ReadonlySet<DocflowCommandType> = new Set([
  'run_communication_rule',
  'approve_draft_message',
  'edit_draft_message',
  'cancel_draft_message',
  'send_approved_message',
]);

export async function executeDocflowOfficeCommand(
  ctx: RequestContext,
  command: DocflowCommandType,
  payloadInput: unknown
): Promise<DocflowCommandResponse> {
  const payload = ensureObj(payloadInput);
  const orgId = reqString(payload, 'org_id');
  if (DOCFLOW_COMMUNICATION_COMMANDS.has(command)) {
    return executeDocflowCommunicationOfficeCommand(ctx, command, payload);
  }

  assertOfficeScope(ctx, orgId);
  await assertDocflowEntitled(orgId);
  const actorUserId = ctx.user.id;
  if (command === 'invite_selected_clients_to_docflow') {
    const idsRaw = Array.isArray(payload.client_ids) ? payload.client_ids : [];
    const clientIds = [...new Set(idsRaw.map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (!clientIds.length) throw badRequest('client_ids must contain at least one id');
    const { data: clients, error: clientsErr } = await supabaseAdmin
      .from('clients')
      .select('id, phone, email')
      .eq('organization_id', orgId)
      .in('id', clientIds);
    if (clientsErr) throw clientsErr;
    const byId = new Map((clients ?? []).map((c) => [String(c.id), c]));
    for (const cid of clientIds) {
      const client = byId.get(cid);
      if (!client) throw badRequest(`Client ${cid} not in organization`, 'client_out_of_scope');
      const hasPhone = typeof client.phone === 'string' && client.phone.trim() !== '';
      const hasEmail = typeof client.email === 'string' && client.email.trim() !== '';
      if (!hasPhone && !hasEmail) {
        throw badRequest(
          'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.',
          'missing_client_contact_channel'
        );
      }
      await createDocflowInviteForClient({
        orgId,
        clientId: cid,
        actorUserId,
        emailRaw: client.email ? String(client.email) : null,
        phoneRaw: client.phone ? String(client.phone) : null,
        expiresInHours: Number(payload.expires_in_hours ?? 72),
      });
    }
    return { ok: true, command, refreshed: await refreshInvitesManagement(orgId, payload) };
  }
  if (command === 'invite_all_clients_to_docflow') {
    const aggregate = await buildDocflowInvitesManagementAggregate({
      orgId,
      page: 1,
      pageSize: 1000,
      searchClient: null,
      inviteStatus: null,
    });
    const table = (aggregate.table as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? [];
    for (const row of table) {
      const canInvite = Boolean((row.allowed_actions as { can_invite?: boolean } | undefined)?.can_invite);
      if (!canInvite) continue;
      const cid = String(row.client_id ?? '');
      const email = String(row.email ?? '').trim();
      const phone = String(row.phone ?? '').trim();
      if (!cid || (!email && !phone)) continue;
      await createDocflowInviteForClient({
        orgId,
        clientId: cid,
        actorUserId,
        emailRaw: email || null,
        phoneRaw: phone || null,
        expiresInHours: Number(payload.expires_in_hours ?? 72),
      });
    }
    return { ok: true, command, refreshed: await refreshInvitesManagement(orgId, payload) };
  }
  if (command === 'issue_docflow_invite_delivery') {
    const invitationId = reqString(payload, 'invitation_id');
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('client_portal_invitations')
      .select('id, org_id, client_id, status, token_expires_at')
      .eq('id', invitationId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (inviteErr) throw inviteErr;
    if (!invite) throw notFound('Invitation not found');
    const inviteStatus = String(invite.status ?? '');
    if (inviteStatus === 'revoked') throw badRequest('Invitation revoked', 'invitation_revoked');
    if (inviteStatus === 'accepted') throw badRequest('Invitation already accepted', 'invitation_already_accepted');
    if (new Date(String(invite.token_expires_at ?? '')).getTime() <= Date.now()) {
      throw badRequest('Invitation expired', 'invitation_expired');
    }
    const clientId = String(invite.client_id);
    await assertClientBelongsToOrg(orgId, clientId);

    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id, display_name, email, phone')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) throw notFound('Client not found');
    const email = String(client.email ?? '').trim().toLowerCase();
    const phone = String(client.phone ?? '').trim();
    if (!email && !phone) {
      throw badRequest(
        'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.',
        'missing_client_contact_channel'
      );
    }
    const preferredChannel = asOptionalString(payload.channel);
    const channel: 'email' | 'sms' =
      preferredChannel === 'email'
        ? 'email'
        : preferredChannel === 'sms'
          ? 'sms'
          : email
            ? 'email'
            : 'sms';
    if (channel === 'email' && !email) throw badRequest('Client email missing', 'missing_client_email_for_invite_delivery');
    if (channel === 'sms' && !phone) throw badRequest('Client phone missing', 'missing_client_phone_for_invite_delivery');

    const appPublicUrl = (await getPlatformPublicUrlForInvite())?.trim();
    if (!appPublicUrl) throw badRequest('app_public_url is required', 'app_public_url_missing');

    const rawToken = createOpaqueToken();
    const tokenHash = sha256Hex(rawToken);
    const { error: rotateErr } = await supabaseAdmin
      .from('client_portal_invitations')
      .update({ invite_token_hash: tokenHash })
      .eq('id', invitationId)
      .eq('org_id', orgId);
    if (rotateErr) throw rotateErr;
    const inviteUrl = `${appPublicUrl.replace(/\/+$/, '')}/client-portal/invite/${encodeURIComponent(rawToken)}`;

    const { data: deliveryStart, error: startErr } = await supabaseAdmin
      .from('client_portal_invite_deliveries')
      .insert({
        org_id: orgId,
        client_id: clientId,
        invitation_id: invitationId,
        channel,
        delivery_status: 'sending',
      })
      .select('id')
      .single();
    if (startErr) throw startErr;

    await audit(orgId, actorUserId, 'docflow_invite_delivery', invitationId, 'docflow_invite_delivery_requested', {
      invitation_id: invitationId,
      client_id: clientId,
      channel,
    });

    try {
      const providerResult =
        channel === 'email'
          ? await (async () => {
              const cfg = await resolveEmailProvider(orgId);
              if (!cfg) throw new Error('email_provider_not_configured');
              const adapter = createEmailDeliveryAdapter(cfg);
              const clientName = String(client.display_name ?? 'לקוח');
              const firmName = cfg.fromName || 'NodexPro';
              // Hebrew product-level invitation content (backend-generated).
              const subject = 'נפתח עבורך אזור תקשורת עם המשרד';
              const text = [
                `שלום ${clientName},`,
                '',
                'נפתח עבורך אזור תקשורת עם המשרד שלך.',
                '',
                'ב-DocFlow אפשר:',
                '• לקבל הודעות מהמשרד',
                '• לשלוח מסמכים',
                '• להשיב בקלות',
                '',
                'להתחברות:',
                inviteUrl,
                '',
                '---',
              ].join('\n');
              const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
  <p>שלום ${clientName},</p>
  <p>נפתח עבורך אזור תקשורת עם המשרד שלך.</p>
  <p>ב-DocFlow אפשר:</p>
  <ul style="margin: 0; padding: 0 18px;">
    <li>לקבל הודעות מהמשרד</li>
    <li>לשלוח מסמכים</li>
    <li>להשיב בקלות</li>
  </ul>
  <p style="margin-top:18px;">להתחברות:</p>
  <p style="margin: 0 0 12px 0; color:#2563EB; word-break: break-all; font-size:14px;">
    ${inviteUrl}
  </p>
  <p style="margin: 0;">
    <a href="${inviteUrl}" style="display:inline-block;padding:12px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
      כניסה ל-DocFlow
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #E5E7EB;margin:18px 0;" />
</div>`;
              return adapter.sendEmail({
                to: email,
                subject,
                html,
                text,
              });
            })()
          : await sendInviteSms({
              to: phone,
              inviteUrl,
              firmName: 'NodexPro',
            });

      const { error: sentErr } = await supabaseAdmin
        .from('client_portal_invite_deliveries')
        .update({
          delivery_status: 'sent',
          delivered_at: new Date().toISOString(),
          provider_message_id: providerResult.providerMessageId ?? null,
          delivery_error: null,
        })
        .eq('id', String(deliveryStart.id))
        .eq('org_id', orgId);
      if (sentErr) throw sentErr;
      await audit(orgId, actorUserId, 'docflow_invite_delivery', invitationId, 'docflow_invite_delivery_sent', {
        invitation_id: invitationId,
        client_id: clientId,
        channel,
        provider_message_id: providerResult.providerMessageId ?? null,
      });
    } catch (deliveryErr) {
      const deliveryError = resolveInviteDeliveryErrorMessage(deliveryErr);
      const { error: failedErr } = await supabaseAdmin
        .from('client_portal_invite_deliveries')
        .update({
          delivery_status: 'failed',
          delivered_at: null,
          delivery_error: deliveryError,
        })
        .eq('id', String(deliveryStart.id))
        .eq('org_id', orgId);
      if (failedErr) throw failedErr;
      await audit(orgId, actorUserId, 'docflow_invite_delivery', invitationId, 'docflow_invite_delivery_failed', {
        invitation_id: invitationId,
        client_id: clientId,
        channel,
        error: deliveryError,
      });
    }

    return { ok: true, command, refreshed: await refreshInvitesManagement(orgId, payload) };
  }

  const clientId = reqString(payload, 'client_id');
  await assertClientBelongsToOrg(orgId, clientId);

  switch (command) {
    case 'invite_client_to_docflow': {
      const { data: clientContact, error: clientErr } = await supabaseAdmin
        .from('clients')
        .select('phone, email')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
      if (clientErr) throw clientErr;
      if (!clientContact) throw notFound('Client not found');
      const hasPhone = typeof clientContact.phone === 'string' && clientContact.phone.trim() !== '';
      const hasEmail = typeof clientContact.email === 'string' && clientContact.email.trim() !== '';
      if (!hasPhone && !hasEmail) {
        throw badRequest(
          'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.',
          'missing_client_contact_channel'
        );
      }

      const payloadEmail = asOptionalString(payload.email);
      const defaultEmail = typeof clientContact.email === 'string' ? clientContact.email : null;
      const defaultPhone = typeof clientContact.phone === 'string' ? clientContact.phone : null;
      const email = (payloadEmail ?? defaultEmail ?? '').trim();
      const inviteOut = await createDocflowInviteForClient({
        orgId,
        clientId,
        actorUserId,
        emailRaw: email || null,
        phoneRaw: defaultPhone,
        expiresInHours: Number(payload.expires_in_hours ?? 72),
      });

      const refreshed =
        String(payload.refresh_target ?? '') === 'docflow_invites_management'
          ? await refreshInvitesManagement(orgId, payload)
          : await refreshOffice(orgId, clientId);
      return {
        ok: true,
        command,
        refreshed: {
          ...refreshed,
          aggregate: {
            ...refreshed.aggregate,
            invite_token_once: inviteOut.rawToken,
          },
        },
      };
    }
    case 'resend_invite': {
      const { data: client, error: clientErr } = await supabaseAdmin
        .from('clients')
        .select('email, phone')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
      if (clientErr) throw clientErr;
      if (!client) throw notFound('Client not found');
      const email = String(client.email ?? '').trim();
      const phone = String(client.phone ?? '').trim();
      if (!email && !phone) throw badRequest('Client invite channel is required', 'missing_client_contact_channel');
      await createDocflowInviteForClient({
        orgId,
        clientId,
        actorUserId,
        emailRaw: email || null,
        phoneRaw: phone || null,
        expiresInHours: Number(payload.expires_in_hours ?? 72),
      });
      return { ok: true, command, refreshed: await refreshInvitesManagement(orgId, payload) };
    }
    case 'revoke_invite': {
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('client_portal_invitations')
        .update({ status: 'revoked', revoked_at: now })
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('status', 'pending');
      if (error) throw error;
      await audit(orgId, actorUserId, 'docflow_invitation', clientId, AUDIT_ACTIONS.DOCFLOW_INVITATION_REVOKED, {
        client_id: clientId,
      });
      return { ok: true, command, refreshed: await refreshInvitesManagement(orgId, payload) };
    }
    case 'revoke_client_portal_access': {
      const reason = asOptionalString(payload.reason);
      const { error: puErr } = await supabaseAdmin
        .from('client_portal_users')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('client_id', clientId);
      if (puErr) throw puErr;

      const { error: sessErr } = await supabaseAdmin
        .from('client_portal_sessions')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('status', 'active');
      if (sessErr) throw sessErr;

      const { error: invErr } = await supabaseAdmin
        .from('client_portal_invitations')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('status', 'pending');
      if (invErr) throw invErr;

      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        event_type: 'portal_access_revoked',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: { reason },
      });
      await audit(orgId, actorUserId, 'docflow_portal_access', clientId, 'portal_access_revoked', { reason });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId) };
    }
    case 'create_client_thread': {
      const moduleKey = reqString(payload, 'module_key');
      const threadType = reqString(payload, 'thread_type');
      if (!['document_request', 'question', 'reminder', 'task_followup'].includes(threadType)) {
        throw badRequest('Unsupported thread_type');
      }
      const assignedUserId = asOptionalString(payload.assigned_user_id);
      const deadlineAt = asOptionalString(payload.deadline_at);
      if (deadlineAt && !Number.isFinite(new Date(deadlineAt).getTime())) throw badRequest('deadline_at must be valid ISO datetime');

      const { data, error } = await supabaseAdmin
        .from('client_message_threads')
        .insert({
          org_id: orgId,
          client_id: clientId,
          module_key: moduleKey,
          thread_type: threadType,
          thread_status: 'open',
          assigned_user_id: assignedUserId,
          deadline_at: deadlineAt,
          created_by_type: 'office',
          created_by_user_id: actorUserId,
          title: asOptionalString(payload.title),
        })
        .select('id')
        .single();
      if (error) throw error;

      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: data.id,
        event_type: 'thread_created',
        actor_type: 'office',
        actor_user_id: actorUserId,
      });
      await audit(orgId, actorUserId, 'docflow_thread', data.id, 'thread_created', { module_key: moduleKey, thread_type: threadType });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, data.id) };
    }
    case 'archive_client_thread': {
      const threadId = reqString(payload, 'thread_id');
      const { data: thread, error: tErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('id, thread_status')
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!thread) throw notFound('Thread not found');
      if (!canTransitionThreadStatus(thread.thread_status, 'archived')) throw badRequest('Thread must be resolved first');
      const { error } = await supabaseAdmin
        .from('client_message_threads')
        .update({ thread_status: 'archived', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', threadId);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_archived',
        actor_type: 'office',
        actor_user_id: actorUserId,
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_archived', {});
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'reopen_client_thread': {
      const threadId = reqString(payload, 'thread_id');
      const { data: thread, error: tErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('id, thread_status')
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!thread) throw notFound('Thread not found');
      if (!canTransitionThreadStatus(thread.thread_status, 'open')) throw badRequest('Only resolved thread can be reopened');
      const { error } = await supabaseAdmin
        .from('client_message_threads')
        .update({ thread_status: 'open', updated_at: new Date().toISOString() })
        .eq('id', threadId);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_reopened',
        actor_type: 'office',
        actor_user_id: actorUserId,
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_reopened', {});
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'change_thread_status': {
      const threadId = reqString(payload, 'thread_id');
      const nextStatus = reqString(payload, 'next_thread_status');
      const { data: thread, error: tErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('id, thread_status')
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!thread) throw notFound('Thread not found');
      if (!canTransitionThreadStatus(thread.thread_status, nextStatus)) {
        throw badRequest(`Invalid thread status transition: ${thread.thread_status} -> ${nextStatus}`);
      }
      const patch: Record<string, unknown> = {
        thread_status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      if (nextStatus === 'resolved') patch.resolved_at = new Date().toISOString();
      if (nextStatus === 'archived') patch.archived_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('client_message_threads').update(patch).eq('id', threadId);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_status_changed',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: { from: thread.thread_status, to: nextStatus },
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_status_changed', {
        from: thread.thread_status,
        to: nextStatus,
      });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'assign_thread_to_user': {
      const threadId = reqString(payload, 'thread_id');
      const assignedUserId = asOptionalString(payload.assigned_user_id);
      const { error } = await supabaseAdmin
        .from('client_message_threads')
        .update({ assigned_user_id: assignedUserId, updated_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_assignment_changed',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: { assigned_user_id: assignedUserId },
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_assignment_changed', {
        assigned_user_id: assignedUserId,
      });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'set_thread_deadline': {
      const threadId = reqString(payload, 'thread_id');
      const deadlineAt = payload.deadline_at === null ? null : reqDateTimeIso(payload, 'deadline_at');
      const { error } = await supabaseAdmin
        .from('client_message_threads')
        .update({ deadline_at: deadlineAt, updated_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_deadline_set',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: { deadline_at: deadlineAt },
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_deadline_set', { deadline_at: deadlineAt });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'create_system_message': {
      const perms = ctx.membership?.permissions ?? [];
      if (!perms.includes('docflow:system_message_write')) {
        throw forbidden('Insufficient permission for system messages');
      }
      const moduleKey = reqString(payload, 'module_key');
      const messageType = reqString(payload, 'message_type');
      if (!['system', 'reminder'].includes(messageType)) throw badRequest('message_type must be system or reminder');
      const body = reqString(payload, 'body');
      const idempotencyKey = reqString(payload, 'idempotency_key');
      const ruleCode = reqString(payload, 'rule_code');
      const ruleContextKey = asOptionalString(payload.rule_context_key);
      const sendModeRaw = (asOptionalString(payload.send_mode) ?? 'draft_review_required') as
        | 'draft_review_required'
        | 'auto_send_allowed';
      if (!['draft_review_required', 'auto_send_allowed'].includes(sendModeRaw)) {
        throw badRequest('Unsupported send_mode');
      }
      const autoSendAllowedByRule = payload.auto_send_allowed_by_rule === true;
      const threadIdInput = asOptionalString(payload.thread_id);

      const out = await createSystemMessageCore({
        orgId,
        clientId,
        moduleKey,
        messageType: messageType as 'system' | 'reminder',
        body,
        idempotencyKey,
        ruleCode,
        ruleContextKey,
        sendModeRaw,
        autoSendAllowedByRule,
        allowPublishWithoutAutoSendRule: false,
        threadIdInput,
        actorUserId,
      });

      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, out.threadId) };
    }
    case 'send_office_message': {
      const threadId = reqString(payload, 'thread_id');
      await assertDocflowThreadScope(orgId, clientId, threadId);
      const body = reqString(payload, 'body');
      const messageType = reqString(payload, 'message_type');
      if (!['text', 'file', 'system', 'request', 'reminder'].includes(messageType)) throw badRequest('Unsupported message_type');
      const { data, error } = await supabaseAdmin
        .from('client_messages')
        .insert({
          org_id: orgId,
          client_id: clientId,
          thread_id: threadId,
          message_type: messageType,
          created_by_type: 'office',
          created_by_user_id: actorUserId,
          body,
          message_status: 'published',
        })
        .select('id')
        .single();
      if (error) throw error;
      await supabaseAdmin
        .from('client_message_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId);
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: data.id,
        event_type: 'message_created',
        actor_type: 'office',
        actor_user_id: actorUserId,
      });
      await audit(orgId, actorUserId, 'docflow_message', data.id, 'message_created', { thread_id: threadId, message_type: messageType });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'attach_file_to_client_message': {
      const threadId = reqString(payload, 'thread_id');
      const messageId = reqString(payload, 'message_id');
      const fileAssetId = reqString(payload, 'file_asset_id');
      await assertDocflowThreadScope(orgId, clientId, threadId);
      await assertDocflowMessageScope(orgId, clientId, threadId, messageId);
      await assertFileAssetInScope(orgId, fileAssetId);
      const { error } = await supabaseAdmin.from('client_message_attachments').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: messageId,
        file_asset_id: fileAssetId,
      });
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: messageId,
        event_type: 'message_attachment_added',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: {
          org_id: orgId,
          client_id: clientId,
          module_key: 'docflow',
          thread_id: threadId,
          message_id: messageId,
          file_asset_id: fileAssetId,
        },
      });
      await audit(orgId, actorUserId, 'docflow_message_attachment', messageId, 'message_attachment_added', {
        org_id: orgId,
        client_id: clientId,
        module_key: 'docflow',
        thread_id: threadId,
        message_id: messageId,
        file_asset_id: fileAssetId,
      });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'remove_message_attachment': {
      const threadId = reqString(payload, 'thread_id');
      const messageId = reqString(payload, 'message_id');
      const fileAssetId = reqString(payload, 'file_asset_id');
      await assertDocflowThreadScope(orgId, clientId, threadId);
      await assertDocflowMessageScope(orgId, clientId, threadId, messageId);
      await assertFileAssetInScope(orgId, fileAssetId);
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('client_message_attachments')
        .select('id')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('thread_id', threadId)
        .eq('message_id', messageId)
        .eq('file_asset_id', fileAssetId)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) throw notFound('Attachment not found');
      const { error } = await supabaseAdmin.from('client_message_attachments').delete().eq('id', row.id);
      if (error) throw error;
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: messageId,
        event_type: 'message_attachment_removed',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: {
          org_id: orgId,
          client_id: clientId,
          module_key: 'docflow',
          thread_id: threadId,
          message_id: messageId,
          file_asset_id: fileAssetId,
        },
      });
      await audit(orgId, actorUserId, 'docflow_message_attachment', messageId, 'message_attachment_removed', {
        org_id: orgId,
        client_id: clientId,
        module_key: 'docflow',
        thread_id: threadId,
        message_id: messageId,
        file_asset_id: fileAssetId,
      });
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    case 'mark_thread_read_by_office': {
      const threadId = reqString(payload, 'thread_id');
      await assertDocflowThreadScope(orgId, clientId, threadId);
      const eventPayload: Record<string, unknown> = {};
      if (payload.last_message_id) eventPayload.last_message_id = String(payload.last_message_id);
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_read_marked_office',
        actor_type: 'office',
        actor_user_id: actorUserId,
        payload_json: eventPayload,
      });
      await audit(orgId, actorUserId, 'docflow_thread', threadId, 'thread_read_marked_office', eventPayload);
      return { ok: true, command, refreshed: await refreshOffice(orgId, clientId, threadId) };
    }
    default:
      throw badRequest(`Unsupported office docflow command: ${command}`);
  }
}

export async function executeDocflowPortalCommand(
  command: DocflowCommandType,
  payloadInput: unknown
): Promise<DocflowCommandResponse> {
  const payload = ensureObj(payloadInput);
  switch (command) {
    case 'accept_client_portal_invitation': {
      console.info('DOCFLOW INVITE ACCEPT START');
      try {
        const rawInviteToken = reqString(payload, 'invite_token');
        const tokenHash = sha256Hex(rawInviteToken);
        const { data: invite, error } = await supabaseAdmin
          .from('client_portal_invitations')
          .select('id, org_id, client_id, portal_user_id, status, token_expires_at, invite_email_normalized')
          .eq('invite_token_hash', tokenHash)
          .maybeSingle();
        if (error) throw error;
        if (!invite) {
          throw forbidden('Invalid invitation token', 'INVALID_INVITATION_TOKEN');
        }
        const invStatus = String(invite.status ?? '');
        if (invStatus === 'revoked') {
          throw forbidden('Invitation revoked', 'INVITATION_REVOKED');
        }
        if (new Date(String(invite.token_expires_at ?? '')).getTime() <= Date.now()) {
          throw forbidden('Invitation expired', 'INVITATION_EXPIRED');
        }
        await assertDocflowEntitled(invite.org_id);

        /** Already accepted: same magic link issues a fresh portal session (cross-device / cleared storage). */
        if (invStatus === 'accepted') {
          console.info('DOCFLOW INVITE ACCEPT ALREADY_ACCEPTED_REISSUE_SESSION', { invitation_id: invite.id });
          const portalUserIdAccepted = invite.portal_user_id as string | null;
          if (!portalUserIdAccepted) {
            throw forbidden('Portal user missing', 'PORTAL_USER_MISSING');
          }
          const { data: puRow, error: puAcceptedErr } = await supabaseAdmin
            .from('client_portal_users')
            .select('id, status')
            .eq('id', portalUserIdAccepted)
            .maybeSingle();
          if (puAcceptedErr) throw puAcceptedErr;
          if (!puRow || puRow.status !== 'active') {
            throw forbidden('Portal access revoked', 'PORTAL_ACCESS_REVOKED');
          }

          const nowIso = new Date().toISOString();
          const { error: luErr } = await supabaseAdmin
            .from('client_portal_users')
            .update({ last_login_at: nowIso, updated_at: nowIso })
            .eq('id', portalUserIdAccepted);
          if (luErr) throw luErr;

          const rawSessionTokenRefresh = createOpaqueToken();
          const sessionHashRefresh = sha256Hex(rawSessionTokenRefresh);
          const { data: sessionRefresh, error: sRefreshErr } = await supabaseAdmin
            .from('client_portal_sessions')
            .insert({
              org_id: invite.org_id,
              client_id: invite.client_id,
              portal_user_id: portalUserIdAccepted,
              session_token_hash: sessionHashRefresh,
              status: 'active',
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select('id')
            .single();
          if (sRefreshErr) throw sRefreshErr;

          console.info('DOCFLOW INVITE ACCEPT SESSION_CREATED', {
            invitation_id: invite.id,
            session_id: sessionRefresh.id,
            path: 'already_accepted_reissue',
          });

          await supabaseAdmin.from('client_message_events').insert({
            org_id: invite.org_id,
            client_id: invite.client_id,
            event_type: 'portal_session_refreshed_via_invite_link',
            actor_type: 'client',
            actor_portal_user_id: portalUserIdAccepted,
            payload_json: { invitation_id: invite.id, session_id: sessionRefresh.id },
          });
          await audit(invite.org_id, null, 'docflow_portal_session', sessionRefresh.id, 'portal_session_refreshed_via_invite', {
            client_id: invite.client_id,
            invitation_id: invite.id,
          });

          const refreshedAccepted = await refreshPortal(invite.org_id, invite.client_id, portalUserIdAccepted);
          return {
            ok: true,
            command,
            refreshed: {
              ...refreshedAccepted,
              aggregate: {
                ...refreshedAccepted.aggregate,
                portal_session_token_once: rawSessionTokenRefresh,
              },
            },
          };
        }

        if (invStatus !== 'pending') {
          throw forbidden('Invitation cannot be accepted', 'INVITATION_NOT_ACCEPTABLE');
        }

        let portalUserId = invite.portal_user_id as string | null;
        if (!portalUserId) {
          const { data: created, error: cErr } = await supabaseAdmin
            .from('client_portal_users')
            .insert({
              org_id: invite.org_id,
              client_id: invite.client_id,
              email_normalized: invite.invite_email_normalized,
              status: 'active',
              auth_method: 'magic_link',
              last_login_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (cErr) throw cErr;
          portalUserId = created.id;
        } else {
          const { error: upErr } = await supabaseAdmin
            .from('client_portal_users')
            .update({ status: 'active', last_login_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString() })
            .eq('id', portalUserId);
          if (upErr) throw upErr;
        }

        await supabaseAdmin
          .from('client_portal_invitations')
          .update({ status: 'accepted', accepted_at: new Date().toISOString(), portal_user_id: portalUserId })
          .eq('id', invite.id);

        const rawSessionToken = createOpaqueToken();
        const sessionHash = sha256Hex(rawSessionToken);
        const { data: session, error: sErr } = await supabaseAdmin
          .from('client_portal_sessions')
          .insert({
            org_id: invite.org_id,
            client_id: invite.client_id,
            portal_user_id: portalUserId,
            session_token_hash: sessionHash,
            status: 'active',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select('id')
          .single();
        if (sErr) throw sErr;

        console.info('DOCFLOW INVITE ACCEPT SESSION_CREATED', {
          invitation_id: invite.id,
          session_id: session.id,
          path: 'first_accept',
        });

        await supabaseAdmin.from('client_message_events').insert({
          org_id: invite.org_id,
          client_id: invite.client_id,
          event_type: 'invitation_accepted',
          actor_type: 'client',
          actor_portal_user_id: portalUserId,
          payload_json: { invitation_id: invite.id, session_id: session.id },
        });
        await audit(invite.org_id, null, 'docflow_invitation', invite.id, 'invitation_accepted', {
          client_id: invite.client_id,
        });

        if (!portalUserId) {
          throw forbidden('Portal user activation failed', 'PORTAL_ACTIVATION_FAILED');
        }
        const refreshed = await refreshPortal(invite.org_id, invite.client_id, portalUserId);
        return {
          ok: true,
          command,
          refreshed: {
            ...refreshed,
            aggregate: {
              ...refreshed.aggregate,
              portal_session_token_once: rawSessionToken,
            },
          },
        };
      } catch (e) {
        const reason =
          e instanceof AppError ? (e.code ?? e.message) : e instanceof Error ? e.message : 'unexpected_error';
        console.warn('DOCFLOW INVITE ACCEPT FAILED', reason);
        throw e;
      }
    }
    case 'send_client_message':
    case 'attach_file_to_client_message':
    case 'remove_message_attachment':
    case 'mark_thread_read_by_client': {
      const rawSessionToken = reqString(payload, 'portal_session_token');
      const session = await resolvePortalSessionByRawToken(rawSessionToken);
      await assertDocflowEntitled(session.orgId);
      const orgId = session.orgId;
      const clientId = session.clientId;
      const portalUserId = session.portalUserId;

      if (command === 'send_client_message') {
        const threadId = reqString(payload, 'thread_id');
        await assertDocflowThreadScope(orgId, clientId, threadId);
        const body = reqString(payload, 'body');
        const messageType = reqString(payload, 'message_type');
        if (!['text', 'file', 'system', 'request', 'reminder'].includes(messageType)) throw badRequest('Unsupported message_type');
        const { data, error } = await supabaseAdmin
          .from('client_messages')
          .insert({
            org_id: orgId,
            client_id: clientId,
            thread_id: threadId,
            message_type: messageType,
            created_by_type: 'client',
            created_by_portal_user_id: portalUserId,
            body,
            message_status: 'published',
          })
          .select('id')
          .single();
        if (error) throw error;
        await supabaseAdmin.from('client_message_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
        await supabaseAdmin.from('client_message_events').insert({
          org_id: orgId,
          client_id: clientId,
          thread_id: threadId,
          message_id: data.id,
          event_type: 'message_created',
          actor_type: 'client',
          actor_portal_user_id: portalUserId,
        });
        await audit(orgId, null, 'docflow_message', data.id, 'message_created', {
          thread_id: threadId,
          actor: 'client_portal_user',
        });
        return { ok: true, command, refreshed: await refreshPortal(orgId, clientId, portalUserId, threadId) };
      }

      if (command === 'attach_file_to_client_message') {
        const threadId = reqString(payload, 'thread_id');
        const messageId = reqString(payload, 'message_id');
        const fileAssetId = reqString(payload, 'file_asset_id');
        await assertDocflowThreadScope(orgId, clientId, threadId);
        await assertDocflowMessageScope(orgId, clientId, threadId, messageId);
        await assertFileAssetInScope(orgId, fileAssetId);
        const { error } = await supabaseAdmin.from('client_message_attachments').insert({
          org_id: orgId,
          client_id: clientId,
          thread_id: threadId,
          message_id: messageId,
          file_asset_id: fileAssetId,
        });
        if (error) throw error;
        await supabaseAdmin.from('client_message_events').insert({
          org_id: orgId,
          client_id: clientId,
          thread_id: threadId,
          message_id: messageId,
          event_type: 'message_attachment_added',
          actor_type: 'client',
          actor_portal_user_id: portalUserId,
          payload_json: {
            org_id: orgId,
            client_id: clientId,
            module_key: 'docflow',
            thread_id: threadId,
            message_id: messageId,
            file_asset_id: fileAssetId,
          },
        });
        await audit(orgId, null, 'docflow_message_attachment', messageId, 'message_attachment_added', {
          actor: 'client_portal_user',
          org_id: orgId,
          client_id: clientId,
          module_key: 'docflow',
          thread_id: threadId,
          message_id: messageId,
          file_asset_id: fileAssetId,
        });
        return { ok: true, command, refreshed: await refreshPortal(orgId, clientId, portalUserId, threadId) };
      }

      if (command === 'remove_message_attachment') {
        const threadId = reqString(payload, 'thread_id');
        const messageId = reqString(payload, 'message_id');
        const fileAssetId = reqString(payload, 'file_asset_id');
        await assertDocflowThreadScope(orgId, clientId, threadId);
        await assertDocflowMessageScope(orgId, clientId, threadId, messageId);
        await assertFileAssetInScope(orgId, fileAssetId);
        const { data: row, error: rowErr } = await supabaseAdmin
          .from('client_message_attachments')
          .select('id')
          .eq('org_id', orgId)
          .eq('client_id', clientId)
          .eq('thread_id', threadId)
          .eq('message_id', messageId)
          .eq('file_asset_id', fileAssetId)
          .maybeSingle();
        if (rowErr) throw rowErr;
        if (!row) throw notFound('Attachment not found');
        const { error } = await supabaseAdmin.from('client_message_attachments').delete().eq('id', row.id);
        if (error) throw error;
        await supabaseAdmin.from('client_message_events').insert({
          org_id: orgId,
          client_id: clientId,
          thread_id: threadId,
          message_id: messageId,
          event_type: 'message_attachment_removed',
          actor_type: 'client',
          actor_portal_user_id: portalUserId,
          payload_json: {
            org_id: orgId,
            client_id: clientId,
            module_key: 'docflow',
            thread_id: threadId,
            message_id: messageId,
            file_asset_id: fileAssetId,
          },
        });
        await audit(orgId, null, 'docflow_message_attachment', messageId, 'message_attachment_removed', {
          actor: 'client_portal_user',
          org_id: orgId,
          client_id: clientId,
          module_key: 'docflow',
          thread_id: threadId,
          message_id: messageId,
          file_asset_id: fileAssetId,
        });
        return { ok: true, command, refreshed: await refreshPortal(orgId, clientId, portalUserId, threadId) };
      }

      const threadId = reqString(payload, 'thread_id');
      await assertDocflowThreadScope(orgId, clientId, threadId);
      await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        event_type: 'thread_read_marked_client',
        actor_type: 'client',
        actor_portal_user_id: portalUserId,
      });
      await audit(orgId, null, 'docflow_thread', threadId, 'thread_read_marked_client', { actor: 'client_portal_user' });
      return { ok: true, command, refreshed: await refreshPortal(orgId, clientId, portalUserId, threadId) };
    }
    default:
      throw badRequest(`Unsupported portal docflow command: ${command}`);
  }
}

