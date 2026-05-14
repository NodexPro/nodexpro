import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import type { AllowedAction } from './docflow.types.js';
import {
  fetchDocflowRequestTemplatesForOrgCountry,
  resolveOrganizationCountryCode,
} from './docflow-request-templates.service.js';

export function threadStatusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'waiting_client':
      return 'Waiting Client';
    case 'waiting_office':
      return 'Waiting Office';
    case 'resolved':
      return 'Resolved';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

export function threadTypeLabel(type: string): string {
  switch (type) {
    case 'document_request':
      return 'Document Request';
    case 'question':
      return 'Question';
    case 'reminder':
      return 'Reminder';
    case 'task_followup':
      return 'Task Follow-up';
    case 'client_initiated':
      return 'Client Message';
    default:
      return type;
  }
}

function buildSlaIndicator(deadlineAt: string | null): { code: string; label: string } {
  if (!deadlineAt) return { code: 'none', label: 'No SLA deadline' };
  const d = new Date(deadlineAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(d)) return { code: 'none', label: 'No SLA deadline' };
  if (d < now) return { code: 'overdue', label: 'Overdue' };
  const hours = (d - now) / (1000 * 60 * 60);
  if (hours <= 24) return { code: 'due_soon', label: 'Due soon' };
  return { code: 'on_track', label: 'On track' };
}

/** Legacy: latest office vs client message in loaded window (composer uploads use send_*_message_with_attachment instead). */
function docflowAttachmentTargets(messages: Record<string, unknown>[]): {
  office_message_id: string | null;
  client_message_id: string | null;
} {
  let office_message_id: string | null = null;
  let client_message_id: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const id = String(m.id ?? '').trim();
    const t = String(m.created_by_type ?? '').trim();
    if (!id) continue;
    if (!office_message_id && t === 'office') office_message_id = id;
    if (!client_message_id && t === 'client') client_message_id = id;
    if (office_message_id && client_message_id) break;
  }
  return { office_message_id, client_message_id };
}

async function getThreadMessages(
  orgId: string,
  clientId: string,
  threadId: string,
  visibility: 'office' | 'portal',
  opts?: { limit?: number }
): Promise<Record<string, unknown>[]> {
  const normalizeDeliveryView = (
    rawStatus: string | null,
    rawReason: string | null
  ): { status: string | null; reason: string | null } => {
    if (!rawStatus) return { status: null, reason: null };
    if (rawStatus === 'pending' && rawReason === 'client_portal_not_activated') {
      return { status: 'pending_client_access', reason: 'client_portal_not_activated' };
    }
    if (rawStatus === 'sent' && rawReason === 'sent_internal') {
      return { status: 'sent_internal', reason: null };
    }
    if (rawStatus === 'sent') return { status: 'sent', reason: null };
    return { status: rawStatus, reason: rawReason };
  };
  let q = supabaseAdmin
    .from('client_messages')
    .select('id, thread_id, message_type, created_by_type, body, message_status, created_at, request_snapshot_json')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId);
  if (visibility === 'portal') q = q.eq('message_status', 'published');
  const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 0) || 0)) || null;
  if (limit) {
    // Load last N messages (descending), then reverse in memory for chat UI.
    q = q.order('created_at', { ascending: false }).limit(limit);
  } else {
    q = q.order('created_at', { ascending: true });
  }
  const { data, error } = await q;
  if (error) throw error;
  const messages = (data ?? []).slice().reverse();
  const messageIds = messages.map((m) => String(m.id));
  const deliveryByMessageId = new Map<string, { delivery_status: string; delivery_reason: string | null }>();
  // Delivery view is primarily needed in portal visibility.
  if (visibility === 'portal' && messageIds.length) {
    const { data: deliveries, error: dErr } = await supabaseAdmin
      .from('client_message_deliveries')
      .select('message_id, delivery_status, failure_reason')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .in('message_id', messageIds)
      .eq('channel', 'docflow');
    if (dErr) throw dErr;
    for (const d of deliveries ?? []) {
      deliveryByMessageId.set(String(d.message_id), {
        delivery_status: String(d.delivery_status),
        delivery_reason: d.failure_reason ? String(d.failure_reason) : null,
      });
    }
  }

  return messages.map((m) => {
    const delivery = deliveryByMessageId.get(String(m.id));
    const normalized = normalizeDeliveryView(delivery?.delivery_status ?? null, delivery?.delivery_reason ?? null);
    return {
      ...m,
      message_type_label: m.message_type,
      delivery_status: visibility === 'portal' ? normalized.status : null,
      delivery_reason: visibility === 'portal' ? normalized.reason : null,
    };
  });
}

async function getThreadAttachments(
  orgId: string,
  clientId: string,
  threadId: string,
  opts?: { limit?: number }
): Promise<Record<string, unknown>[]> {
  let q = supabaseAdmin
    .from('client_message_attachments')
    .select('id, message_id, file_asset_id, created_at, file_assets(file_name, mime_type)')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId);
  const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 0) || 0)) || null;
  q = q.order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []).slice().reverse();
  return rows.map((row) => {
    const r = row as {
      id: string;
      message_id: string;
      file_asset_id: string;
      created_at: string;
      file_assets?: { file_name?: string | null; mime_type?: string | null } | null;
    };
    return {
      id: r.id,
      message_id: r.message_id,
      file_asset_id: r.file_asset_id,
      created_at: r.created_at,
      file_name: r.file_assets?.file_name ?? null,
      mime_type: r.file_assets?.mime_type ?? null,
    };
  });
}

/** Per-thread office unread (message count). Org/inbox totals: `docflow_office_unread_messages_*` RPCs (same rules). */
export async function getUnreadForOffice(orgId: string, clientId: string, threadId: string): Promise<number> {
  const { data: lastRead, error: readErr } = await supabaseAdmin
    .from('client_message_events')
    .select('created_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId)
    .eq('event_type', 'thread_read_marked_office')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) throw readErr;
  const marker = lastRead?.created_at ?? '1970-01-01T00:00:00.000Z';
  const { count, error } = await supabaseAdmin
    .from('client_messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId)
    .gt('created_at', marker)
    .neq('created_by_type', 'office')
    .eq('message_status', 'published');
  if (error) throw error;
  return count ?? 0;
}

/**
 * Batch office-unread counts for many threads (same rules as {@link getUnreadForOffice}).
 * Used by cross-domain read models (e.g. Work Engine queue). Executes one
 * unread count query per distinct thread (bounded by the caller's page size).
 */
export async function batchOfficeUnreadForThreads(
  orgId: string,
  pairs: Array<{ clientId: string; threadId: string }>,
): Promise<Map<string, number>> {
  const byThread = new Map<string, number>();
  const unique = new Map<string, { clientId: string; threadId: string }>();
  for (const p of pairs) {
    if (!p.threadId || !p.clientId) continue;
    unique.set(p.threadId, p);
  }
  if (unique.size === 0) return byThread;

  await Promise.all(
    [...unique.values()].map(async (p) => {
      const n = await getUnreadForOffice(orgId, p.clientId, p.threadId);
      byThread.set(p.threadId, n);
    }),
  );
  return byThread;
}

async function getUnreadForClient(orgId: string, clientId: string, threadId: string): Promise<number> {
  const { data: lastRead, error: readErr } = await supabaseAdmin
    .from('client_message_events')
    .select('created_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId)
    .eq('event_type', 'thread_read_marked_client')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) throw readErr;
  const marker = lastRead?.created_at ?? '1970-01-01T00:00:00.000Z';
  const { count, error } = await supabaseAdmin
    .from('client_messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId)
    .gt('created_at', marker)
    .neq('created_by_type', 'client')
    .eq('message_status', 'published');
  if (error) throw error;
  return count ?? 0;
}

function officeAllowedActions(threadStatus: string): AllowedAction[] {
  const archived = threadStatus === 'archived';
  const resolved = threadStatus === 'resolved';
  return [
    { command: 'send_office_message', enabled: !archived, reason: archived ? 'Thread archived' : null },
    {
      command: 'send_office_message_with_attachment',
      enabled: !archived,
      reason: archived ? 'Thread archived' : null,
    },
    {
      command: 'create_docflow_document_request',
      enabled: !archived,
      reason: archived ? 'Thread archived' : null,
    },
    { command: 'change_thread_status', enabled: !archived, reason: archived ? 'Thread archived' : null },
    { command: 'assign_thread_to_user', enabled: !archived, reason: archived ? 'Thread archived' : null },
    { command: 'set_thread_deadline', enabled: !archived, reason: archived ? 'Thread archived' : null },
    { command: 'archive_client_thread', enabled: resolved, reason: resolved ? null : 'Thread must be resolved first' },
    { command: 'reopen_client_thread', enabled: resolved, reason: resolved ? null : 'Thread is not resolved' },
    { command: 'attach_file_to_client_message', enabled: !archived, reason: archived ? 'Thread archived' : null },
    { command: 'remove_message_attachment', enabled: !archived, reason: archived ? 'Thread archived' : null },
    { command: 'mark_thread_read_by_office', enabled: true, reason: null },
  ];
}

function clientPortalAllowedActions(
  selectedThread: { thread_status: string } | null,
  opts?: { hasAnyThreads?: boolean }
): AllowedAction[] {
  const hasThread = Boolean(selectedThread);
  const hasAnyThreads = opts?.hasAnyThreads === true;
  const archived = selectedThread?.thread_status === 'archived';
  return [
    {
      command: 'start_client_portal_thread',
      enabled: !hasAnyThreads,
      reason: hasAnyThreads ? 'Thread already exists' : null,
    },
    {
      command: 'send_client_message',
      enabled: hasThread && !archived,
      reason: !hasThread ? 'No thread selected' : archived ? 'Thread archived' : null,
    },
    {
      command: 'send_client_message_with_attachment',
      enabled: hasThread && !archived,
      reason: !hasThread ? 'No thread selected' : archived ? 'Thread archived' : null,
    },
    {
      command: 'attach_file_to_client_message',
      enabled: hasThread && !archived,
      reason: !hasThread ? 'No thread selected' : archived ? 'Thread archived' : null,
    },
    {
      command: 'remove_message_attachment',
      enabled: hasThread && !archived,
      reason: !hasThread ? 'No thread selected' : archived ? 'Thread archived' : null,
    },
    {
      command: 'mark_thread_read_by_client',
      enabled: hasThread,
      reason: !hasThread ? 'No thread selected' : null,
    },
  ];
}

function resolveInviteEligibility(client: { phone?: string | null; email?: string | null }): {
  canInvite: boolean;
  reasonCode: string | null;
  reasonText: string | null;
} {
  const hasPhone = typeof client.phone === 'string' && client.phone.trim() !== '';
  const hasEmail = typeof client.email === 'string' && client.email.trim() !== '';
  if (hasPhone || hasEmail) {
    return { canInvite: true, reasonCode: null, reasonText: null };
  }
  return {
    canInvite: false,
    reasonCode: 'missing_client_contact_channel',
    reasonText: 'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.',
  };
}

export async function buildClientDocflowTabAggregate(params: {
  orgId: string;
  clientId: string;
  selectedThreadId?: string | null;
}): Promise<Record<string, unknown>> {
  const { orgId, clientId } = params;

  const [client, threads, portalUsers] = await Promise.all([
    supabaseAdmin.from('clients').select('id, display_name, status, phone, email').eq('organization_id', orgId).eq('id', clientId).maybeSingle(),
    supabaseAdmin
      .from('client_message_threads')
      .select('id, module_key, thread_type, thread_status, assigned_user_id, deadline_at, created_at, updated_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false }),
    supabaseAdmin
      .from('client_portal_users')
      .select('id, status, last_login_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);
  if (client.error) throw client.error;
  if (!client.data) throw notFound('Client not found');
  if (threads.error) throw threads.error;
  if (portalUsers.error) throw portalUsers.error;

  const threadRows = threads.data ?? [];
  const selectedThread =
    threadRows.find((t) => t.id === params.selectedThreadId) ??
    (threadRows.length ? threadRows[0] : null);

  const [messages, attachments, unreadSelected] = selectedThread
    ? await Promise.all([
        getThreadMessages(orgId, clientId, selectedThread.id, 'office'),
        getThreadAttachments(orgId, clientId, selectedThread.id),
        getUnreadForOffice(orgId, clientId, selectedThread.id),
      ])
    : [[], [], 0];

  const unreadByThread = new Map<string, number>();
  for (const t of threadRows) {
    unreadByThread.set(t.id, await getUnreadForOffice(orgId, clientId, t.id));
  }

  const assignedIds = [...new Set(threadRows.map((t) => t.assigned_user_id).filter(Boolean))] as string[];
  let usersById = new Map<string, { id: string; full_name: string | null; email: string }>();
  if (assignedIds.length) {
    const { data: users, error } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', assignedIds);
    if (error) throw error;
    usersById = new Map((users ?? []).map((u) => [u.id, u]));
  }

  const inviteEligibility = resolveInviteEligibility({
    phone: client.data.phone as string | null | undefined,
    email: client.data.email as string | null | undefined,
  });

  return {
    aggregate_key: 'client_docflow_tab_aggregate',
    client_header: {
      client_id: client.data.id,
      display_name: client.data.display_name,
      status: client.data.status,
    },
    entitlement_status: { active: true, source: 'module_entitlement' },
    portal_access_status: {
      active: (portalUsers.data?.[0]?.status ?? '') === 'active',
      status: portalUsers.data?.[0]?.status ?? 'not_invited',
      last_login_at: portalUsers.data?.[0]?.last_login_at ?? null,
    },
    thread_list: threadRows.map((t) => ({
      ...t,
      thread_type_label: threadTypeLabel(t.thread_type),
      thread_status_label: threadStatusLabel(t.thread_status),
      unread_count: unreadByThread.get(t.id) ?? 0,
      sla_indicator: buildSlaIndicator(t.deadline_at),
      assigned_user: t.assigned_user_id
        ? {
            id: t.assigned_user_id,
            display_name: usersById.get(t.assigned_user_id)?.full_name ?? usersById.get(t.assigned_user_id)?.email ?? 'Unknown',
          }
        : null,
    })),
    selected_thread: selectedThread
      ? {
          ...selectedThread,
          thread_type_label: threadTypeLabel(selectedThread.thread_type),
          thread_status_label: threadStatusLabel(selectedThread.thread_status),
          sla_indicator: buildSlaIndicator(selectedThread.deadline_at),
          assigned_user: selectedThread.assigned_user_id
            ? {
                id: selectedThread.assigned_user_id,
                display_name:
                  usersById.get(selectedThread.assigned_user_id)?.full_name ??
                  usersById.get(selectedThread.assigned_user_id)?.email ??
                  'Unknown',
              }
            : null,
          allowed_actions: officeAllowedActions(selectedThread.thread_status),
        }
      : null,
    messages,
    attachments,
    attachment_targets: docflowAttachmentTargets(messages as Record<string, unknown>[]),
    unread_counters: {
      selected_thread: unreadSelected,
      total: [...unreadByThread.values()].reduce((s, c) => s + c, 0),
    },
    allowed_actions: [
      {
        command: 'invite_client_to_docflow',
        enabled: inviteEligibility.canInvite,
        reason: inviteEligibility.reasonCode,
      },
      { command: 'create_client_thread', enabled: true, reason: null },
      { command: 'revoke_client_portal_access', enabled: (portalUsers.data?.[0]?.status ?? '') === 'active', reason: null },
    ],
    can_invite_to_docflow: inviteEligibility.canInvite,
    invite_to_docflow_reason_code: inviteEligibility.reasonCode,
    invite_to_docflow_reason_text: inviteEligibility.reasonText,
    empty_states: {
      no_threads: threadRows.length === 0,
      no_messages: selectedThread ? messages.length === 0 : true,
    },
    validation_messages: [],
  };
}

function docflowInviteStatusLabel(status: string): string {
  switch (status) {
    case 'not_invited':
      return 'לא הוזמן';
    case 'invited':
      return 'הזמנה נשלחה';
    case 'joined':
      return 'הצטרף';
    case 'expired':
      return 'פג תוקף';
    case 'revoked':
      return 'בוטל';
    default:
      return status;
  }
}

type DocflowInviteManagementRow = {
  invitation_id: string | null;
  client_id: string;
  client_name: string;
  phone: string | null;
  email: string | null;
  invite_status: 'not_invited' | 'invited' | 'joined' | 'expired' | 'revoked';
  invite_status_label: string;
  delivery_status: 'not_sent' | 'sending' | 'sent' | 'failed';
  delivery_status_label: string;
  delivery_channel: 'email' | 'sms' | null;
  delivery_error: string | null;
  invite_sent_at: string | null;
  allowed_actions: {
    can_invite: boolean;
    can_resend: boolean;
    can_revoke: boolean;
    can_send_invite_delivery: boolean;
  };
};

function docflowInviteDeliveryStatusLabel(status: string): string {
  switch (status) {
    case 'not_sent':
      return 'לא נשלח';
    case 'sending':
      return 'בשליחה';
    case 'sent':
      return 'נשלח';
    case 'failed':
      return 'נכשל';
    default:
      return status;
  }
}

function resolveInviteStatus(row: {
  portalStatus: string | null;
  inviteStatus: string | null;
  tokenExpiresAt: string | null;
}): DocflowInviteManagementRow['invite_status'] {
  if (row.portalStatus === 'active' || row.inviteStatus === 'accepted') return 'joined';
  if (row.inviteStatus === 'revoked') return 'revoked';
  if (row.inviteStatus === 'pending') {
    const expiresAt = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : null;
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) return 'expired';
    return 'invited';
  }
  return 'not_invited';
}

function invitationDbStatusLabel(status: string | null): string {
  switch (String(status ?? '').trim()) {
    case 'pending':
      return 'ממתין';
    case 'accepted':
      return 'אושר';
    case 'expired':
      return 'פג תוקף';
    case 'revoked':
      return 'בוטל';
    default:
      return status ? String(status) : '—';
  }
}

function messengerPortalBadgeForInviteStatus(
  status: DocflowInviteManagementRow['invite_status'],
): { color: 'gray' | 'yellow' | 'blue'; label: string } {
  if (status === 'joined') return { color: 'blue', label: 'משתמש פורטל פעיל' };
  if (status === 'invited') return { color: 'yellow', label: 'הזמנה ממתינה' };
  return { color: 'gray', label: docflowInviteStatusLabel(status) };
}

type MessengerPortalListExtras = {
  portal_badge: { color: 'gray' | 'yellow' | 'blue'; label: string };
  portal_card: Record<string, unknown>;
  show_portal_invite_glyph: boolean;
};

async function buildMessengerPortalListExtrasByClientId(
  orgId: string,
  pageRows: Array<{
    client_id: string;
    display_name: string;
    phone: string | null;
    email: string | null;
  }>,
): Promise<Map<string, MessengerPortalListExtras>> {
  const out = new Map<string, MessengerPortalListExtras>();
  const clientIds = pageRows.map((r) => r.client_id).filter(Boolean);
  if (!clientIds.length) return out;

  const [portalUsersRes, invitesRes] = await Promise.all([
    supabaseAdmin
      .from('client_portal_users')
      .select('client_id, status, last_login_at, updated_at')
      .eq('org_id', orgId)
      .in('client_id', clientIds)
      .order('updated_at', { ascending: false }),
    supabaseAdmin
      .from('client_portal_invitations')
      .select('id, client_id, status, created_at, token_expires_at, accepted_at')
      .eq('org_id', orgId)
      .in('client_id', clientIds)
      .order('created_at', { ascending: false }),
  ]);
  if (portalUsersRes.error) throw portalUsersRes.error;
  if (invitesRes.error) throw invitesRes.error;

  const latestPortalByClient = new Map<string, { status: string | null; last_login_at: string | null }>();
  for (const row of portalUsersRes.data ?? []) {
    const cid = String((row as { client_id?: string }).client_id ?? '');
    if (!cid || latestPortalByClient.has(cid)) continue;
    latestPortalByClient.set(cid, {
      status: (row as { status?: string }).status ? String((row as { status: string }).status) : null,
      last_login_at: (row as { last_login_at?: string | null }).last_login_at
        ? String((row as { last_login_at: string }).last_login_at)
        : null,
    });
  }
  const latestInviteByClient = new Map<
    string,
    { id: string; status: string | null; createdAt: string | null; tokenExpiresAt: string | null; acceptedAt: string | null }
  >();
  for (const row of invitesRes.data ?? []) {
    const cid = String((row as { client_id?: string }).client_id ?? '');
    if (!cid || latestInviteByClient.has(cid)) continue;
    latestInviteByClient.set(cid, {
      id: String((row as { id?: string }).id ?? ''),
      status: (row as { status?: string }).status ? String((row as { status: string }).status) : null,
      createdAt: (row as { created_at?: string | null }).created_at ? String((row as { created_at: string }).created_at) : null,
      tokenExpiresAt: (row as { token_expires_at?: string | null }).token_expires_at
        ? String((row as { token_expires_at: string }).token_expires_at)
        : null,
      acceptedAt: (row as { accepted_at?: string | null }).accepted_at
        ? String((row as { accepted_at: string }).accepted_at)
        : null,
    });
  }

  const inviteIds = Array.from(
    new Set(
      [...latestInviteByClient.values()]
        .map((i) => i.id)
        .filter((id) => id && id.length > 0),
    ),
  );
  const latestDeliveryByInvitation = new Map<
    string,
    { status: 'not_sent' | 'sending' | 'sent' | 'failed'; channel: 'email' | 'sms' | null; error: string | null }
  >();
  if (inviteIds.length) {
    const { data: delRows, error: dErr } = await supabaseAdmin
      .from('client_portal_invite_deliveries')
      .select('invitation_id, channel, delivery_status, delivery_error, created_at')
      .eq('org_id', orgId)
      .in('invitation_id', inviteIds)
      .order('created_at', { ascending: false });
    if (dErr) throw dErr;
    for (const row of delRows ?? []) {
      const invId = String((row as { invitation_id?: string }).invitation_id ?? '');
      if (!invId || latestDeliveryByInvitation.has(invId)) continue;
      const st = String((row as { delivery_status?: string }).delivery_status ?? 'not_sent') as
        | 'not_sent'
        | 'sending'
        | 'sent'
        | 'failed';
      const ch = (row as { channel?: string | null }).channel
        ? (String((row as { channel: string }).channel) as 'email' | 'sms')
        : null;
      latestDeliveryByInvitation.set(invId, {
        status: st,
        channel: ch,
        error: (row as { delivery_error?: string | null }).delivery_error
          ? String((row as { delivery_error: string }).delivery_error)
          : null,
      });
    }
  }

  for (const r of pageRows) {
    const clientId = r.client_id;
    const latestPortal = latestPortalByClient.get(clientId);
    const latestInvite = latestInviteByClient.get(clientId);
    const resolvedStatus = resolveInviteStatus({
      portalStatus: latestPortal?.status ?? null,
      inviteStatus: latestInvite?.status ?? null,
      tokenExpiresAt: latestInvite?.tokenExpiresAt ?? null,
    });
    const hasPhone = typeof r.phone === 'string' && r.phone.trim() !== '';
    const hasEmail = typeof r.email === 'string' && r.email.trim() !== '';
    const hasAnyChannel = hasPhone || hasEmail;
    const canInvite = hasAnyChannel && (resolvedStatus === 'not_invited' || resolvedStatus === 'expired' || resolvedStatus === 'revoked');
    const delivery = latestInvite?.id ? latestDeliveryByInvitation.get(latestInvite.id) : null;
    const deliveryStatus = delivery?.status ?? 'not_sent';
    const canSendDelivery = resolvedStatus === 'invited' && hasAnyChannel && deliveryStatus !== 'sent';
    const portalActive = (latestPortal?.status ?? '') === 'active';
    const inviteRowStatus = latestInvite?.status ?? null;

    const portal_badge = messengerPortalBadgeForInviteStatus(resolvedStatus);
    const portal_status_label = docflowInviteStatusLabel(resolvedStatus);
    const invitation_status_label = latestInvite ? invitationDbStatusLabel(inviteRowStatus) : '—';
    const delivery_status_label = docflowInviteDeliveryStatusLabel(deliveryStatus);
    const invitation_sent_at = latestInvite?.createdAt ?? null;
    const accepted_at = latestInvite?.acceptedAt ?? null;
    const last_portal_activity_at =
      portalActive && latestPortal?.last_login_at ? latestPortal.last_login_at : null;

    const allowed_actions: Array<{
      command: string;
      label: string;
      variant: 'primary' | 'secondary' | 'danger';
      enabled: boolean;
      reason: string | null;
      payload: Record<string, unknown>;
    }> = [
      {
        command: 'invite_client_to_docflow',
        label: 'שלח הזמנה לפורטל',
        variant: 'primary',
        enabled: canInvite,
        reason: canInvite ? null : hasAnyChannel ? null : 'חסר טלפון או אימייל בפרטי הלקוח',
        payload: {},
      },
      {
        command: 'resend_invite',
        label: 'שלח שוב הזמנה',
        variant: 'secondary',
        enabled: resolvedStatus === 'invited' && hasAnyChannel,
        reason: resolvedStatus === 'invited' && hasAnyChannel ? null : 'אין הזמנה פעילה לשליחה חוזרת',
        payload: {},
      },
      {
        command: 'revoke_invite',
        label: 'בטל הזמנה',
        variant: 'danger',
        enabled: resolvedStatus === 'invited',
        reason: resolvedStatus === 'invited' ? null : 'אין הזמנה ממתינה לביטול',
        payload: {},
      },
      {
        command: 'issue_docflow_invite_delivery',
        label: 'שלח קישור (מייל / SMS)',
        variant: 'primary',
        enabled: canSendDelivery && Boolean(latestInvite?.id),
        reason: canSendDelivery ? null : 'השליחה כבר בוצעה או שאין הזמנה לשליחה',
        payload: latestInvite?.id ? { invitation_id: latestInvite.id } : {},
      },
      {
        command: 'revoke_client_portal_access',
        label: 'השבת גישה לפורטל',
        variant: 'danger',
        enabled: portalActive,
        reason: portalActive ? null : 'אין משתמש פורטל פעיל',
        payload: {},
      },
    ];

    const portal_card = {
      title: r.display_name?.trim() || 'לקוח',
      subtitle: portal_badge.label,
      fields: [
        { key: 'client', label: 'לקוח', value: r.display_name?.trim() || null },
        { key: 'phone', label: 'טלפון', value: r.phone },
        { key: 'email', label: 'אימייל', value: r.email },
        { key: 'portal_status', label: 'סטטוס פורטל', value: portal_status_label },
        { key: 'invitation_status', label: 'סטטוס הזמנה', value: invitation_status_label },
        { key: 'delivery_status', label: 'סטטוס שליחה', value: delivery_status_label },
        { key: 'invitation_sent_at', label: 'הזמנה נוצרה בתאריך', value: invitation_sent_at },
        { key: 'accepted_at', label: 'אושר בתאריך', value: accepted_at },
        { key: 'last_portal_activity_at', label: 'פעילות אחרונה בפורטל', value: last_portal_activity_at },
      ],
      allowed_actions,
    };

    out.set(clientId, {
      portal_badge,
      portal_card,
      show_portal_invite_glyph: canInvite,
    });
  }

  return out;
}

export async function buildDocflowInvitesManagementAggregate(params: {
  orgId: string;
  page?: number;
  pageSize?: number;
  searchClient?: string | null;
  inviteStatus?: string | null;
}): Promise<Record<string, unknown>> {
  const pageSize = Math.max(1, Math.min(100, Number(params.pageSize ?? 25) || 25));
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const searchClient = String(params.searchClient ?? '').trim().toLowerCase();
  const inviteStatusFilter = String(params.inviteStatus ?? '').trim();

  const [clientsRes, portalUsersRes, invitesRes, deliveriesRes] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('id, display_name, phone, email')
      .eq('organization_id', params.orgId)
      .order('display_name', { ascending: true }),
    supabaseAdmin
      .from('client_portal_users')
      .select('id, client_id, status, updated_at')
      .eq('org_id', params.orgId)
      .order('updated_at', { ascending: false }),
    supabaseAdmin
      .from('client_portal_invitations')
      .select('id, client_id, status, created_at, token_expires_at')
      .eq('org_id', params.orgId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('client_portal_invite_deliveries')
      .select('id, invitation_id, channel, delivery_status, delivery_error, provider_message_id, delivered_at, created_at')
      .eq('org_id', params.orgId)
      .order('created_at', { ascending: false }),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  if (portalUsersRes.error) throw portalUsersRes.error;
  if (invitesRes.error) throw invitesRes.error;
  if (deliveriesRes.error) throw deliveriesRes.error;

  const latestPortalByClient = new Map<string, { status: string | null }>();
  for (const row of portalUsersRes.data ?? []) {
    const clientId = String(row.client_id ?? '');
    if (!clientId || latestPortalByClient.has(clientId)) continue;
    latestPortalByClient.set(clientId, { status: row.status ? String(row.status) : null });
  }
  const latestInviteByClient = new Map<string, { status: string | null; createdAt: string | null; tokenExpiresAt: string | null }>();
  const latestInviteIdByClient = new Map<string, string>();
  for (const row of invitesRes.data ?? []) {
    const clientId = String(row.client_id ?? '');
    if (!clientId || latestInviteByClient.has(clientId)) continue;
    latestInviteByClient.set(clientId, {
      status: row.status ? String(row.status) : null,
      createdAt: row.created_at ? String(row.created_at) : null,
      tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
    });
    latestInviteIdByClient.set(clientId, String(row.id));
  }
  const latestDeliveryByInvitation = new Map<
    string,
    { status: 'not_sent' | 'sending' | 'sent' | 'failed'; channel: 'email' | 'sms' | null; error: string | null }
  >();
  for (const row of deliveriesRes.data ?? []) {
    const invId = String(row.invitation_id ?? '');
    if (!invId || latestDeliveryByInvitation.has(invId)) continue;
    const st = String(row.delivery_status ?? 'not_sent') as 'not_sent' | 'sending' | 'sent' | 'failed';
    const ch = (row.channel ? String(row.channel) : null) as 'email' | 'sms' | null;
    latestDeliveryByInvitation.set(invId, {
      status: st,
      channel: ch,
      error: row.delivery_error ? String(row.delivery_error) : null,
    });
  }

  const rowsAll: DocflowInviteManagementRow[] = (clientsRes.data ?? []).map((client) => {
    const clientId = String(client.id);
    const latestPortal = latestPortalByClient.get(clientId);
    const latestInvite = latestInviteByClient.get(clientId);
    const status = resolveInviteStatus({
      portalStatus: latestPortal?.status ?? null,
      inviteStatus: latestInvite?.status ?? null,
      tokenExpiresAt: latestInvite?.tokenExpiresAt ?? null,
    });
    const hasPhone = typeof client.phone === 'string' && client.phone.trim() !== '';
    const hasEmail = typeof client.email === 'string' && client.email.trim() !== '';
    const hasAnyChannel = hasPhone || hasEmail;
    const canInvite = hasAnyChannel && (status === 'not_invited' || status === 'expired' || status === 'revoked');
    const latestInviteId = latestInviteIdByClient.get(clientId);
    const delivery = latestInviteId ? latestDeliveryByInvitation.get(latestInviteId) : null;
    const deliveryStatus = delivery?.status ?? 'not_sent';
    const canSendDelivery = status === 'invited' && hasAnyChannel && deliveryStatus !== 'sent';
    return {
      invitation_id: latestInviteId ?? null,
      client_id: clientId,
      client_name: String(client.display_name ?? ''),
      phone: client.phone ? String(client.phone) : null,
      email: client.email ? String(client.email) : null,
      invite_status: status,
      invite_status_label: docflowInviteStatusLabel(status),
      delivery_status: deliveryStatus,
      delivery_status_label: docflowInviteDeliveryStatusLabel(deliveryStatus),
      delivery_channel: delivery?.channel ?? null,
      delivery_error: delivery?.error ?? null,
      invite_sent_at: latestInvite?.createdAt ?? null,
      allowed_actions: {
        can_invite: canInvite,
        can_resend: status === 'invited' && hasAnyChannel,
        can_revoke: status === 'invited',
        can_send_invite_delivery: canSendDelivery,
      },
    };
  });

  const rowsFiltered = rowsAll.filter((row) => {
    if (inviteStatusFilter && row.invite_status !== inviteStatusFilter) return false;
    if (!searchClient) return true;
    const haystack = `${row.client_name} ${row.phone ?? ''} ${row.email ?? ''}`.toLowerCase();
    return haystack.includes(searchClient);
  });

  const total = rowsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = rowsFiltered.slice(offset, offset + pageSize);
  const selectedIds = new Set(pageRows.filter((r) => r.allowed_actions.can_invite).map((r) => r.client_id));

  return {
    aggregate_key: 'docflow_invites_management_aggregate',
    title: 'הזמנות ל DocFlow',
    table: {
      columns: [
        { key: 'client_name', label: 'לקוח' },
        { key: 'phone', label: 'טלפון' },
        { key: 'email', label: 'אימייל' },
        { key: 'invite_status_label', label: 'סטטוס הזמנה' },
        { key: 'delivery_status_label', label: 'סטטוס שליחה' },
        { key: 'invite_sent_at', label: 'תאריך שליחה' },
        { key: 'actions', label: 'פעולות' },
      ],
      rows: pageRows,
    },
    filters: {
      search_client: searchClient,
      invite_status: inviteStatusFilter,
      invite_status_options: [
        { value: '', label: 'כל הסטטוסים' },
        { value: 'not_invited', label: 'לא הוזמן' },
        { value: 'invited', label: 'הזמנה נשלחה' },
        { value: 'joined', label: 'הצטרף' },
        { value: 'expired', label: 'פג תוקף' },
        { value: 'revoked', label: 'בוטל' },
      ],
    },
    pagination: {
      page: safePage,
      page_size: pageSize,
      total,
      total_pages: totalPages,
    },
    status_labels: {
      not_invited: 'לא הוזמן',
      invited: 'הזמנה נשלחה',
      joined: 'הצטרף',
      expired: 'פג תוקף',
      revoked: 'בוטל',
    },
    delivery_status_labels: {
      not_sent: 'לא נשלח',
      sending: 'בשליחה',
      sent: 'נשלח',
      failed: 'נכשל',
    },
    allowed_actions: {
      invite_all_clients_to_docflow: { enabled: rowsAll.some((r) => r.allowed_actions.can_invite), reason: null },
      invite_selected_clients_to_docflow: {
        enabled: selectedIds.size > 0,
        reason: selectedIds.size > 0 ? null : 'no_eligible_clients_in_current_page',
      },
    },
    bulk_actions: [
      { command: 'invite_all_clients_to_docflow', label: 'הזמן את כל הלקוחות', enabled: rowsAll.some((r) => r.allowed_actions.can_invite), reason: null },
      {
        command: 'invite_selected_clients_to_docflow',
        label: 'הזמן לקוחות נבחרים',
        enabled: selectedIds.size > 0,
        reason: selectedIds.size > 0 ? null : 'no_eligible_clients_in_current_page',
      },
    ],
  };
}

export async function buildClientPortalInboxAggregate(params: {
  orgId: string;
  clientId: string;
  portalUserId: string;
  selectedThreadId?: string | null;
}): Promise<Record<string, unknown>> {
  const { orgId, clientId } = params;
  void params.portalUserId;
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, display_name')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw notFound('Client not found');

  const { data: threads, error: threadsErr } = await supabaseAdmin
    .from('client_message_threads')
    .select('id, module_key, thread_type, thread_status, deadline_at, updated_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .neq('thread_status', 'archived')
    .order('updated_at', { ascending: false });
  if (threadsErr) throw threadsErr;
  const threadRows = threads ?? [];
  const hasAnyThreads = threadRows.length > 0;
  const selectedThread =
    threadRows.find((t) => t.id === params.selectedThreadId) ??
    (threadRows.length ? threadRows[0] : null);
  const [messages, attachments, unreadSelected] = selectedThread
    ? await Promise.all([
        // Match office thread context window (last N published messages); omitting limit defaults to 1 in getThreadMessages.
        getThreadMessages(orgId, clientId, selectedThread.id, 'portal', { limit: 20 }),
        getThreadAttachments(orgId, clientId, selectedThread.id, { limit: 80 }),
        getUnreadForClient(orgId, clientId, selectedThread.id),
      ])
    : [[], [], 0];

  const unreadByThread = new Map<string, number>();
  for (const t of threadRows) {
    unreadByThread.set(t.id, await getUnreadForClient(orgId, clientId, t.id));
  }

  const portalAllowedActions = clientPortalAllowedActions(selectedThread, { hasAnyThreads });
  const canSendMessageWithAttachment = portalAllowedActions.some(
    (a) => a.command === 'send_client_message_with_attachment' && a.enabled
  );

  return {
    aggregate_key: 'client_portal_inbox_aggregate',
    firm_header: { title: 'NodexPro DocFlow' },
    client_profile_header: {
      client_id: client.id,
      display_name: client.display_name,
    },
    portal_session_status: {
      active: true,
    },
    thread_list: threadRows.map((t) => ({
      id: t.id,
      module_key: t.module_key,
      thread_type: t.thread_type,
      thread_type_label: threadTypeLabel(t.thread_type),
      thread_status: t.thread_status,
      thread_status_label: threadStatusLabel(t.thread_status),
      deadline: t.deadline_at,
      sla_indicator: buildSlaIndicator(t.deadline_at),
      unread_count: unreadByThread.get(t.id) ?? 0,
    })),
    selected_thread: selectedThread
      ? {
          ...selectedThread,
          thread_type_label: threadTypeLabel(selectedThread.thread_type),
          thread_status_label: threadStatusLabel(selectedThread.thread_status),
          allowed_actions: portalAllowedActions,
        }
      : null,
    messages,
    attachments,
    attachment_targets: docflowAttachmentTargets(messages as Record<string, unknown>[]),
    unread_count: [...unreadByThread.values()].reduce((s, c) => s + c, 0),
    attachment_permissions: {
      can_attach: canSendMessageWithAttachment,
    },
    allowed_actions: portalAllowedActions,
    pwa_badge_metadata: {
      unread_count: [...unreadByThread.values()].reduce((s, c) => s + c, 0),
    },
    pwa_metadata: {
      unread_count: [...unreadByThread.values()].reduce((s, c) => s + c, 0),
      display_mode_preference: 'standalone',
      add_to_home_hint: true,
    },
    empty_states: {
      no_threads: threadRows.length === 0,
      no_messages: selectedThread ? messages.length === 0 : true,
    },
  };
}

function normalizePage(raw: unknown, def: number): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.floor(n));
}

function normalizePageSize(raw: unknown, def: number): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

async function resolveOfficeSelectedThread(params: {
  orgId: string;
  clientId: string;
  selectedThreadId?: string | null;
}): Promise<{
  threadRows: Array<{ id: string; module_key: string; thread_type: string; thread_status: string; deadline_at: string | null; updated_at: string }>;
  selectedThread:
    | { id: string; module_key: string; thread_type: string; thread_status: string; deadline_at: string | null; updated_at: string }
    | null;
  messages: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  unreadSelected: number;
  unreadByThread: Map<string, number>;
}> {
  const { data: threads, error: threadsErr } = await supabaseAdmin
    .from('client_message_threads')
    .select('id, module_key, thread_type, thread_status, deadline_at, updated_at')
    .eq('org_id', params.orgId)
    .eq('client_id', params.clientId)
    .neq('thread_status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (threadsErr) throw threadsErr;
  const threadRows = (threads ?? []).map((t) => ({
    id: String(t.id),
    module_key: String(t.module_key ?? 'docflow'),
    thread_type: String(t.thread_type ?? ''),
    thread_status: String(t.thread_status ?? ''),
    deadline_at: (t.deadline_at ? String(t.deadline_at) : null) as string | null,
    updated_at: String(t.updated_at ?? ''),
  }));

  const selectedThread =
    threadRows.find((t) => t.id === (params.selectedThreadId ?? null)) ?? (threadRows.length ? threadRows[0] : null);

  const threadIds = threadRows.map((t) => t.id);

  // Batch unread: 2 queries total (events + messages), no per-thread calls.
  const lastReadByThread = new Map<string, string>();
  if (threadIds.length) {
    const { data: readEvents, error: reErr } = await supabaseAdmin
      .from('client_message_events')
      .select('thread_id, created_at')
      .eq('org_id', params.orgId)
      .eq('client_id', params.clientId)
      .eq('event_type', 'thread_read_marked_office')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (reErr) throw reErr;
    for (const e of readEvents ?? []) {
      const tid = String((e as any).thread_id ?? '');
      if (!tid || lastReadByThread.has(tid)) continue;
      const ts = String((e as any).created_at ?? '');
      if (ts) lastReadByThread.set(tid, ts);
    }
  }

  const unreadByThread = new Map<string, number>(threadIds.map((id) => [id, 0]));
  if (threadIds.length) {
    let minMarker = '1970-01-01T00:00:00.000Z';
    for (const tid of threadIds) {
      const marker = lastReadByThread.get(tid) ?? '1970-01-01T00:00:00.000Z';
      if (marker < minMarker) minMarker = marker;
    }

    const { data: msgRows, error: mErr } = await supabaseAdmin
      .from('client_messages')
      .select('thread_id, created_at')
      .eq('org_id', params.orgId)
      .eq('client_id', params.clientId)
      .in('thread_id', threadIds)
      .gt('created_at', minMarker)
      .neq('created_by_type', 'office')
      .eq('message_status', 'published')
      .order('created_at', { ascending: true })
      .limit(5000);
    if (mErr) throw mErr;
    for (const row of msgRows ?? []) {
      const tid = String((row as any).thread_id ?? '');
      const ts = String((row as any).created_at ?? '');
      if (!tid || !ts) continue;
      const marker = lastReadByThread.get(tid) ?? '1970-01-01T00:00:00.000Z';
      if (ts > marker) unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
    }
  }

  const [messages, attachments] = selectedThread
    ? await Promise.all([
        getThreadMessages(params.orgId, params.clientId, selectedThread.id, 'office', { limit: 50 }),
        getThreadAttachments(params.orgId, params.clientId, selectedThread.id, { limit: 80 }),
      ])
    : [[], []];
  const unreadSelected = selectedThread ? unreadByThread.get(selectedThread.id) ?? 0 : 0;

  return { threadRows, selectedThread, messages, attachments, unreadSelected, unreadByThread };
}

export async function buildClientContextDocflowAggregate(params: {
  orgId: string;
  clientId: string;
  selectedThreadId?: string | null;
}): Promise<Record<string, unknown>> {
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, status')
    .eq('organization_id', params.orgId)
    .eq('id', params.clientId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw notFound('Client not found');

  const resolved = await resolveOfficeSelectedThread({
    orgId: params.orgId,
    clientId: params.clientId,
    selectedThreadId: params.selectedThreadId ?? null,
  });

  return {
    aggregate_key: 'client_context_docflow_aggregate',
    client_header: {
      client_id: String(client.id),
      display_name: String(client.display_name ?? ''),
      status: String(client.status ?? ''),
    },
    thread_list: resolved.threadRows.map((t) => ({
      ...t,
      thread_type_label: threadTypeLabel(t.thread_type),
      thread_status_label: threadStatusLabel(t.thread_status),
      unread_count: resolved.unreadByThread.get(t.id) ?? 0,
      sla_indicator: buildSlaIndicator(t.deadline_at),
    })),
    selected_thread: resolved.selectedThread
      ? {
          ...resolved.selectedThread,
          thread_type_label: threadTypeLabel(resolved.selectedThread.thread_type),
          thread_status_label: threadStatusLabel(resolved.selectedThread.thread_status),
          sla_indicator: buildSlaIndicator(resolved.selectedThread.deadline_at),
          allowed_actions: officeAllowedActions(resolved.selectedThread.thread_status),
        }
      : null,
    messages: resolved.messages,
    attachments: resolved.attachments,
    attachment_targets: docflowAttachmentTargets(resolved.messages as Record<string, unknown>[]),
    unread_counters: {
      selected_thread: resolved.unreadSelected,
      total: [...resolved.unreadByThread.values()].reduce((s, c) => s + c, 0),
    },
    empty_states: {
      no_threads: resolved.threadRows.length === 0,
      no_messages: resolved.selectedThread ? resolved.messages.length === 0 : true,
    },
    allowed_actions: [
      { command: 'create_client_thread', enabled: true, reason: null },
      { command: 'send_office_message', enabled: resolved.selectedThread ? resolved.selectedThread.thread_status !== 'archived' : false, reason: null },
      {
        command: 'send_office_message_with_attachment',
        enabled: resolved.selectedThread ? resolved.selectedThread.thread_status !== 'archived' : false,
        reason: null,
      },
      {
        command: 'create_docflow_document_request',
        enabled: resolved.selectedThread ? resolved.selectedThread.thread_status !== 'archived' : false,
        reason: null,
      },
      { command: 'mark_thread_read_by_office', enabled: Boolean(resolved.selectedThread), reason: null },
      { command: 'archive_client_thread', enabled: resolved.selectedThread ? resolved.selectedThread.thread_status === 'resolved' : false, reason: null },
    ],
  };
}

export async function buildClientThreadContextAggregate(params: {
  orgId: string;
  clientId: string;
  threadId?: string | null;
}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  let msClient = 0;
  let msThreads = 0;
  let msMessages = 0;
  let msAttachments = 0;
  let msAllowedActions = 0;
  const threadIdInput = String(params.threadId ?? '').trim() || null;
  let selectedThreadId: string | null = null;
  let threadsCount = 0;
  let messagesCount = 0;
  let attachmentsCount = 0;

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, status')
    .eq('organization_id', params.orgId)
    .eq('id', params.clientId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw notFound('Client not found');
  msClient = ms();

  const { data: threads, error: threadsErr } = await supabaseAdmin
    .from('client_message_threads')
    .select('id, module_key, thread_type, thread_status, deadline_at, updated_at')
    .eq('org_id', params.orgId)
    .eq('client_id', params.clientId)
    .neq('thread_status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(threadIdInput ? 50 : 1);
  if (threadsErr) throw threadsErr;
  msThreads = ms();
  const threadRows = (threads ?? []).map((t) => ({
    id: String(t.id),
    module_key: String(t.module_key ?? 'docflow'),
    thread_type: String(t.thread_type ?? ''),
    thread_status: String(t.thread_status ?? ''),
    deadline_at: (t.deadline_at ? String(t.deadline_at) : null) as string | null,
    updated_at: String(t.updated_at ?? ''),
  }));
  threadsCount = threadRows.length;
  const selectedThread =
    threadRows.find((t) => t.id === threadIdInput) ?? (threadRows.length ? threadRows[0] : null);
  selectedThreadId = selectedThread?.id ?? null;

  const messages = selectedThread
    ? await getThreadMessages(params.orgId, params.clientId, selectedThread.id, 'office', { limit: 20 })
    : [];
  msMessages = ms();
  messagesCount = messages.length;
  const messageIds = messages.map((m) => String(m.id ?? '')).filter(Boolean);
  const attachments =
    selectedThread && messageIds.length
      ? await (async () => {
          const { data: rows, error: aErr } = await supabaseAdmin
            .from('client_message_attachments')
            .select('id, message_id, file_asset_id, created_at, file_assets(file_name, mime_type)')
            .eq('org_id', params.orgId)
            .eq('client_id', params.clientId)
            .eq('thread_id', selectedThread.id)
            .in('message_id', messageIds)
            .order('created_at', { ascending: true })
            .limit(200);
          if (aErr) throw aErr;
          return (rows ?? []).map((row) => {
            const r = row as {
              id: string;
              message_id: string;
              file_asset_id: string;
              created_at: string;
              file_assets?: { file_name?: string | null; mime_type?: string | null } | null;
            };
            return {
              id: r.id,
              message_id: r.message_id,
              file_asset_id: r.file_asset_id,
              created_at: r.created_at,
              file_name: r.file_assets?.file_name ?? null,
              mime_type: r.file_assets?.mime_type ?? null,
            };
          });
        })()
      : [];
  msAttachments = ms();
  attachmentsCount = attachments.length;

  const allowedActions = ((): AllowedAction[] => [
    { command: 'start_office_thread_for_client', enabled: !selectedThread, reason: selectedThread ? 'Thread already exists' : null },
    { command: 'send_office_message', enabled: selectedThread ? selectedThread.thread_status !== 'archived' : false, reason: null },
    {
      command: 'send_office_message_with_attachment',
      enabled: selectedThread ? selectedThread.thread_status !== 'archived' : false,
      reason: null,
    },
    {
      command: 'create_docflow_document_request',
      enabled: selectedThread ? selectedThread.thread_status !== 'archived' : false,
      reason: null,
    },
    { command: 'mark_thread_read_by_office', enabled: Boolean(selectedThread), reason: null },
    { command: 'archive_client_thread', enabled: selectedThread ? selectedThread.thread_status === 'resolved' : false, reason: null },
  ])();
  msAllowedActions = ms();

  console.info('[docflow client-thread-context timing]', {
    org_id: params.orgId,
    client_id: params.clientId,
    thread_id_input: threadIdInput,
    selected_thread_id: selectedThreadId,
    counts: { threads: threadsCount, messages: messagesCount, attachments: attachmentsCount },
    ms: {
      client_header_query: msClient,
      selected_thread_query: msThreads - msClient,
      messages_query: msMessages - msThreads,
      attachments_query: msAttachments - msMessages,
      allowed_actions_build: msAllowedActions - msAttachments,
      total: msAllowedActions,
    },
  });

  return {
    aggregate_key: 'client_thread_context_aggregate',
    client_header: {
      client_id: String(client.id),
      display_name: String(client.display_name ?? ''),
      status: String(client.status ?? ''),
    },
    selected_thread: selectedThread
      ? {
          ...selectedThread,
          thread_type_label: threadTypeLabel(selectedThread.thread_type),
          thread_status_label: threadStatusLabel(selectedThread.thread_status),
          sla_indicator: buildSlaIndicator(selectedThread.deadline_at),
          allowed_actions: officeAllowedActions(selectedThread.thread_status),
        }
      : null,
    messages,
    attachments,
    attachment_targets: docflowAttachmentTargets(messages as Record<string, unknown>[]),
    allowed_actions: allowedActions,
    empty_states: {
      no_threads: !selectedThread,
      no_messages: selectedThread ? messages.length === 0 : true,
    },
  };
}

export async function buildOfficeDocflowInboxAggregate(params: {
  orgId: string;
  page?: number;
  pageSize?: number;
  searchClient?: string | null;
  selectedClientId?: string | null;
  selectedThreadId?: string | null;
  /** When false, skips nested `client_context` (e.g. office messenger composes thread context separately). Default true. */
  includeClientContext?: boolean;
}): Promise<Record<string, unknown>> {
  const pageSize = normalizePageSize(params.pageSize, 25);
  const page = normalizePage(params.page, 1);
  const searchRaw = String(params.searchClient ?? '').trim();
  const searchForRpc = searchRaw ? searchRaw : null;

  // Order by latest DocFlow thread activity (max updated_at per client), then display_name.
  // Pagination and search are applied in SQL (RPC) so ordering truth stays on the backend.
  const { data: inboxRows, error: cErr } = await supabaseAdmin.rpc('docflow_office_inbox_clients_page', {
    p_org_id: params.orgId,
    p_search: searchForRpc,
    p_page: page,
    p_page_size: pageSize,
  });
  if (cErr) throw cErr;

  const rows = (inboxRows ?? []) as Array<{
    client_id: string;
    display_name: string | null;
    status: string | null;
    phone: string | null;
    email: string | null;
    last_thread_activity_at: string | null;
    total_count: string | number | null;
  }>;
  let total = rows.length ? Number(rows[0]?.total_count ?? 0) : 0;
  if (!rows.length && page > 1) {
    const { data: headRows, error: headErr } = await supabaseAdmin.rpc('docflow_office_inbox_clients_page', {
      p_org_id: params.orgId,
      p_search: searchForRpc,
      p_page: 1,
      p_page_size: 1,
    });
    if (headErr) throw headErr;
    const head = (headRows ?? []) as Array<{ total_count?: string | number | null }>;
    total = head.length ? Number(head[0]?.total_count ?? 0) : 0;
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = rows.map((c) => ({
    client_id: String(c.client_id),
    display_name: String(c.display_name ?? ''),
    status: String(c.status ?? ''),
    phone: c.phone ? String(c.phone) : null,
    email: c.email ? String(c.email) : null,
    last_thread_activity_at: c.last_thread_activity_at ? String(c.last_thread_activity_at) : null,
  }));

  const pageClientIds = pageRows.map((r) => r.client_id);
  const { data: threads, error: tErr } = await supabaseAdmin
    .from('client_message_threads')
    .select('id, client_id, thread_type, thread_status, updated_at')
    .eq('org_id', params.orgId)
    .in('client_id', pageClientIds)
    .order('updated_at', { ascending: false });
  if (tErr) throw tErr;

  const threadsByClient = new Map<string, Array<{ id: string; thread_type: string; thread_status: string; updated_at: string }>>();
  for (const row of threads ?? []) {
    const cid = String((row as any).client_id ?? '');
    if (!cid) continue;
    const list = threadsByClient.get(cid) ?? [];
    list.push({
      id: String((row as any).id),
      thread_type: String((row as any).thread_type ?? ''),
      thread_status: String((row as any).thread_status ?? ''),
      updated_at: String((row as any).updated_at ?? ''),
    });
    threadsByClient.set(cid, list);
  }

  // Unread per client (sum of unread messages across all non-archived threads) — same SQL as task center KPI / RPC.
  const unreadByClient = new Map<string, number>();
  if (pageClientIds.length) {
    const { data: unreadRows, error: uErr } = await supabaseAdmin.rpc('docflow_office_unread_messages_for_clients', {
      p_org_id: params.orgId,
      p_client_ids: pageClientIds,
    });
    if (uErr) throw uErr;
    for (const row of unreadRows ?? []) {
      const cid = String((row as { client_id?: string }).client_id ?? '');
      const n = Number((row as { unread_count?: number | string }).unread_count) || 0;
      if (cid) unreadByClient.set(cid, n);
    }
  }

  const selectedClientId =
    String(params.selectedClientId ?? '').trim() ||
    (pageRows.length ? pageRows[0]!.client_id : '');

  // Selected client must be resolved in-scope even if it is not in current page.
  const selectedClientInScope = selectedClientId
    ? (
        await supabaseAdmin
          .from('clients')
          .select('id')
          .eq('organization_id', params.orgId)
          .eq('id', selectedClientId)
          .maybeSingle()
      ).data
      ? { client_id: selectedClientId }
      : null
    : null;
  const includeClientContext = params.includeClientContext !== false;
  const selectedClientAggregate =
    selectedClientInScope && includeClientContext
      ? await buildClientContextDocflowAggregate({
          orgId: params.orgId,
          clientId: selectedClientId,
          selectedThreadId: params.selectedThreadId ?? null,
        })
      : null;

  const resolvedSelectedThreadId = includeClientContext
    ? (selectedClientAggregate?.selected_thread as { id?: string } | null)?.id ?? null
    : String(params.selectedThreadId ?? '').trim() || null;

  return {
    aggregate_key: 'office_docflow_inbox_aggregate',
    org_id: params.orgId,
    filters: {
      search_client: searchRaw,
    },
    pagination: {
      page: safePage,
      page_size: pageSize,
      total,
      total_pages: totalPages,
    },
    client_list: pageRows.map((r) => {
      const tlist = threadsByClient.get(r.client_id) ?? [];
      const latest = tlist[0] ?? null;
      return {
        ...r,
        unread_count: unreadByClient.get(r.client_id) ?? 0,
        active_thread_count: tlist.filter((t) => t.thread_status !== 'archived').length,
        latest_thread: latest
          ? {
              id: latest.id,
              thread_type: latest.thread_type,
              thread_type_label: threadTypeLabel(latest.thread_type),
              thread_status: latest.thread_status,
              thread_status_label: threadStatusLabel(latest.thread_status),
              updated_at: latest.updated_at,
            }
          : null,
      };
    }),
    selection: {
      selected_client_id: selectedClientInScope?.client_id ?? null,
      selected_thread_id: resolvedSelectedThreadId,
    },
    client_context: selectedClientAggregate,
    empty_states: {
      no_clients: total === 0,
    },
  };
}

/**
 * Single read model for the office DocFlow messenger screen: inbox list + selected client thread context
 * (same thread semantics as `client_thread_context_aggregate`, not `client_context_docflow_aggregate`).
 */
export async function buildOfficeDocflowMessengerAggregate(params: {
  orgId: string;
  page?: number;
  pageSize?: number;
  searchClient?: string | null;
  clientId?: string | null;
  threadId?: string | null;
}): Promise<Record<string, unknown>> {
  const messengerPageSize = params.pageSize ?? 50;
  const clientIdParam = String(params.clientId ?? '').trim() || null;
  const threadIdParam = String(params.threadId ?? '').trim() || null;

  const orgCountry = await resolveOrganizationCountryCode(params.orgId);
  const available_request_templates = orgCountry ? await fetchDocflowRequestTemplatesForOrgCountry(orgCountry) : [];

  const inbox = await buildOfficeDocflowInboxAggregate({
    orgId: params.orgId,
    page: params.page,
    pageSize: messengerPageSize,
    searchClient: params.searchClient,
    selectedClientId: clientIdParam,
    selectedThreadId: threadIdParam,
    includeClientContext: false,
  });

  const inboxSelection = inbox.selection as { selected_client_id?: string | null } | undefined;
  const selectedClientId = String(inboxSelection?.selected_client_id ?? '').trim();
  const selectedThreadIdParam = threadIdParam;
  const threadCtx = selectedClientId
    ? await buildClientThreadContextAggregate({
        orgId: params.orgId,
        clientId: selectedClientId,
        threadId: selectedThreadIdParam,
      })
    : null;

  const {
    aggregate_key: _inboxKey,
    client_context: _cc,
    empty_states: inboxEmpty,
    ...inboxRest
  } = inbox as Record<string, unknown> & {
    selection?: { selected_client_id?: string | null; selected_thread_id?: string | null };
    empty_states?: Record<string, unknown>;
  };

  if (!threadCtx) {
    return {
      aggregate_key: 'office_docflow_messenger_aggregate',
      ...inboxRest,
      client_header: null,
      selected_thread: null,
      messages: [],
      attachments: [],
      allowed_actions: [],
      available_request_templates,
      empty_states: {
        ...(typeof inboxEmpty === 'object' && inboxEmpty ? inboxEmpty : {}),
      },
    };
  }

  const { aggregate_key: _tKey, ...threadRest } = threadCtx;

  return {
    aggregate_key: 'office_docflow_messenger_aggregate',
    ...inboxRest,
    ...threadRest,
    available_request_templates,
    empty_states: {
      ...(typeof inboxEmpty === 'object' && inboxEmpty ? inboxEmpty : {}),
      ...(typeof threadRest.empty_states === 'object' && threadRest.empty_states ? threadRest.empty_states : {}),
    },
  };
}

