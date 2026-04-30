import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import type { AllowedAction } from './docflow.types.js';

function threadStatusLabel(status: string): string {
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

function threadTypeLabel(type: string): string {
  switch (type) {
    case 'document_request':
      return 'Document Request';
    case 'question':
      return 'Question';
    case 'reminder':
      return 'Reminder';
    case 'task_followup':
      return 'Task Follow-up';
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

async function getThreadMessages(
  orgId: string,
  clientId: string,
  threadId: string,
  visibility: 'office' | 'portal'
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
    .select('id, thread_id, message_type, created_by_type, body, message_status, created_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId);
  if (visibility === 'portal') q = q.eq('message_status', 'published');
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  const messages = data ?? [];
  const messageIds = messages.map((m) => String(m.id));
  const deliveryByMessageId = new Map<string, { delivery_status: string; delivery_reason: string | null }>();
  if (messageIds.length) {
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
      delivery_status: normalized.status,
      delivery_reason: normalized.reason,
    };
  });
}

async function getThreadAttachments(orgId: string, clientId: string, threadId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('client_message_attachments')
    .select('id, message_id, file_asset_id, created_at, file_assets(file_name, mime_type)')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
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

async function getUnreadForOffice(orgId: string, clientId: string, threadId: string): Promise<number> {
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

function clientPortalAllowedActions(selectedThread: { thread_status: string } | null): AllowedAction[] {
  const hasThread = Boolean(selectedThread);
  const archived = selectedThread?.thread_status === 'archived';
  return [
    {
      command: 'send_client_message',
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
  const selectedThread =
    threadRows.find((t) => t.id === params.selectedThreadId) ??
    (threadRows.length ? threadRows[0] : null);
  const [messages, attachments, unreadSelected] = selectedThread
    ? await Promise.all([
        getThreadMessages(orgId, clientId, selectedThread.id, 'portal'),
        getThreadAttachments(orgId, clientId, selectedThread.id),
        getUnreadForClient(orgId, clientId, selectedThread.id),
      ])
    : [[], [], 0];

  const unreadByThread = new Map<string, number>();
  for (const t of threadRows) {
    unreadByThread.set(t.id, await getUnreadForClient(orgId, clientId, t.id));
  }

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
          allowed_actions: clientPortalAllowedActions(selectedThread),
        }
      : null,
    messages,
    attachments,
    unread_count: [...unreadByThread.values()].reduce((s, c) => s + c, 0),
    attachment_permissions: {
      can_attach: true,
    },
    allowed_actions: clientPortalAllowedActions(selectedThread),
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

