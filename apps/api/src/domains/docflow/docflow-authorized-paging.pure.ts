/**
 * Stage 5.5 — DocFlow pagination for restricted (Staff/Viewer) viewers.
 *
 * The SQL page RPCs (`docflow_office_inbox_clients_page`, `docflow_task_center_threads_page`)
 * take no client allow-list, so filtering their output would break LIMIT/OFFSET and total_count.
 * For a restricted viewer the read model therefore loads ONLY rows that belong to the
 * Stage 5.1 authorized client set (bounded by the grant list, never the whole office),
 * applies filters, orders, and slices the page here. Totals are computed from authorized
 * rows only, so no unauthorized activity can be inferred from page counts.
 *
 * Owner/Admin and Staff/Viewer with ALL access keep the unchanged SQL RPC path.
 */

export function chunkIds<T>(ids: readonly T[], size = 100): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

export function paginateAuthorizedRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { rows: T[]; total_rows: number; total_pages: number; effective_page: number } {
  const size = Math.max(1, Math.min(100, Math.floor(pageSize) || 25));
  const total_rows = rows.length;
  const total_pages = total_rows > 0 ? Math.max(1, Math.ceil(total_rows / size)) : 0;
  const requested = Math.max(1, Math.floor(page) || 1);
  const effective_page = total_pages === 0 ? 1 : Math.min(requested, total_pages);
  const start = (effective_page - 1) * size;
  return { rows: rows.slice(start, start + size), total_rows, total_pages, effective_page };
}

function containsCi(haystack: string | null | undefined, needle: string): boolean {
  return String(haystack ?? '').toLowerCase().includes(needle);
}

export type AuthorizedInboxClient = {
  client_id: string;
  display_name: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
};

export function clientMatchesSearch(client: AuthorizedInboxClient, search: string | null | undefined): boolean {
  const needle = String(search ?? '').trim().toLowerCase();
  if (!needle) return true;
  return (
    containsCi(client.display_name, needle) ||
    containsCi(client.phone, needle) ||
    containsCi(client.email, needle)
  );
}

function compareIsoDesc(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return tb - ta;
}

function compareName(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

export type AuthorizedInboxRow = AuthorizedInboxClient & { last_thread_activity_at: string | null };

/** Mirrors `docflow_office_inbox_clients_page` ordering over the authorized client set only. */
export function buildAuthorizedInboxPage(params: {
  clients: readonly AuthorizedInboxClient[];
  activityByClient: ReadonlyMap<string, string | null>;
  allowedClientIds: readonly string[];
  search?: string | null;
  page: number;
  pageSize: number;
}) {
  const allow = new Set(params.allowedClientIds);
  const rows: AuthorizedInboxRow[] = params.clients
    .filter((c) => allow.has(c.client_id) && clientMatchesSearch(c, params.search))
    .map((c) => ({ ...c, last_thread_activity_at: params.activityByClient.get(c.client_id) ?? null }));
  rows.sort(
    (a, b) =>
      compareIsoDesc(a.last_thread_activity_at, b.last_thread_activity_at) ||
      compareName(a.display_name, b.display_name),
  );
  const paged = paginateAuthorizedRows(rows, params.page, params.pageSize);
  return { rows: paged.rows, total: paged.total_rows, effective_page: paged.effective_page };
}

export type AuthorizedTaskThread = {
  thread_id: string;
  client_id: string;
  module_key: string;
  thread_type: string;
  thread_status: string;
  deadline_at: string | null;
  assigned_user_id: string | null;
  updated_at: string | null;
};

export type AuthorizedTaskCenterFilters = {
  search?: string | null;
  module?: string | null;
  thread_type?: string | null;
  thread_status?: string | null;
  assigned_filter?: string | null;
  overdue_only?: boolean;
  due_from?: string | null;
  due_to?: string | null;
  /** Thread ids that have unread office messages; required when unread_only is set. */
  unreadThreadIds?: ReadonlySet<string> | null;
  unread_only?: boolean;
};

function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Mirrors the filter semantics of `docflow_task_center_threads_page` (without the unread subquery). */
export function threadPassesTaskCenterFilters(
  t: AuthorizedTaskThread,
  clientName: string,
  clientPhone: string | null,
  clientEmail: string | null,
  f: AuthorizedTaskCenterFilters,
  viewerUserId: string,
  nowMs: number,
): boolean {
  const status = String(f.thread_status ?? '').trim();
  if (!status) {
    if (t.thread_status === 'archived') return false;
  } else if (t.thread_status !== status) {
    return false;
  }
  const mod = String(f.module ?? '').trim();
  if (mod && t.module_key !== mod) return false;
  const type = String(f.thread_type ?? '').trim();
  if (type && t.thread_type !== type) return false;

  const needle = String(f.search ?? '').trim().toLowerCase();
  if (needle && !(containsCi(clientName, needle) || containsCi(clientPhone, needle) || containsCi(clientEmail, needle))) {
    return false;
  }

  const assigned = String(f.assigned_filter ?? '').trim();
  const assignedLower = assigned.toLowerCase();
  if (assigned && assignedLower !== 'all') {
    const ok =
      (assignedLower === 'me' && t.assigned_user_id === viewerUserId) ||
      (assignedLower === 'unassigned' && t.assigned_user_id == null) ||
      t.assigned_user_id === assigned;
    if (!ok) return false;
  }

  if (f.overdue_only) {
    const overdue =
      t.thread_status !== 'archived' &&
      t.thread_status !== 'resolved' &&
      t.deadline_at != null &&
      new Date(t.deadline_at).getTime() < nowMs;
    if (!overdue) return false;
  }
  if (f.due_from && t.deadline_at != null && utcDate(t.deadline_at) < f.due_from) return false;
  if (f.due_to && t.deadline_at != null && utcDate(t.deadline_at) > f.due_to) return false;

  if (f.unread_only && !(f.unreadThreadIds?.has(t.thread_id) ?? false)) return false;
  return true;
}

export function buildAuthorizedTaskCenterPage<T extends AuthorizedTaskThread & { client_name: string }>(params: {
  rows: readonly T[];
  page: number;
  pageSize: number;
}) {
  const sorted = [...params.rows].sort(
    (a, b) => compareIsoDesc(a.updated_at, b.updated_at) || compareName(a.client_name, b.client_name),
  );
  return paginateAuthorizedRows(sorted, params.page, params.pageSize);
}

/** Mirrors `docflow_task_center_metrics` thread KPIs over the authorized thread set only. */
export function computeAuthorizedTaskCenterThreadKpis(
  threads: readonly AuthorizedTaskThread[],
  viewerUserId: string,
  nowMs: number,
) {
  let overdue = 0;
  let waiting = 0;
  let assignedToMe = 0;
  for (const t of threads) {
    if (
      t.thread_status !== 'archived' &&
      t.thread_status !== 'resolved' &&
      t.deadline_at != null &&
      new Date(t.deadline_at).getTime() < nowMs
    ) {
      overdue += 1;
    }
    if (t.thread_status === 'waiting_client') waiting += 1;
    if (t.thread_status !== 'archived' && t.assigned_user_id != null && t.assigned_user_id === viewerUserId) {
      assignedToMe += 1;
    }
  }
  return { overdue_count: overdue, waiting_client_count: waiting, assigned_to_me_count: assignedToMe };
}
