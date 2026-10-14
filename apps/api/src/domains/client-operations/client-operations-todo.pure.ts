/**
 * Pure Client Operations ToDo helpers (Stage 5A).
 * No DB / env — unit-test friendly.
 */

export const CLIENT_OPERATIONS_TODO_PAGE_SIZE = 25;
export const CLIENT_OPERATIONS_TODO_TASK_TEXT_MAX = 2000;

/** Semantic priorities 1..4; null = no priority (fifth visual row). */
export type ClientOperationsTodoPriority = 1 | 2 | 3 | 4;

export function normalizeTodoPriority(raw: unknown): ClientOperationsTodoPriority | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new Error('INVALID_TODO_PRIORITY');
  }
  return n as ClientOperationsTodoPriority;
}

export function normalizeTodoTaskText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('TODO_TEXT_REQUIRED');
  if (text.length > CLIENT_OPERATIONS_TODO_TASK_TEXT_MAX) throw new Error('TODO_TEXT_TOO_LONG');
  return text;
}

// ── One-time / external client (migration 188) ──────────────────────────────────────────────────────
// Limits mirror the database check constraints.
export const CLIENT_OPERATIONS_TODO_EXTERNAL_CLIENT_NAME_MAX = 200;
export const CLIENT_OPERATIONS_TODO_EXTERNAL_CLIENT_TAX_ID_MAX = 50;

/** One-time client name: trimmed, non-empty, ≤ 200. */
export function normalizeTodoExternalClientName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('TODO_EXTERNAL_CLIENT_NAME_REQUIRED');
  if (text.length > CLIENT_OPERATIONS_TODO_EXTERNAL_CLIENT_NAME_MAX) {
    throw new Error('TODO_EXTERNAL_CLIENT_NAME_TOO_LONG');
  }
  return text;
}

/** Optional manual ת.ז./ח.פ.: blank → null; trimmed; length-limited only (no legal validation here). */
export function normalizeTodoExternalClientTaxId(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (text.length > CLIENT_OPERATIONS_TODO_EXTERNAL_CLIENT_TAX_ID_MAX) {
    throw new Error('TODO_EXTERNAL_CLIENT_TAX_ID_TOO_LONG');
  }
  return text;
}

// ── Progress note (שלב טיפול) + completion reason (סיבת סגירה) — migration 189 ──────────────────────────
// Free text only: no enum, no workflow meaning. Limits mirror the database check constraints.
export const CLIENT_OPERATIONS_TODO_PROGRESS_NOTE_MAX = 300;
export const CLIENT_OPERATIONS_TODO_COMPLETION_REASON_MAX = 300;

/** Optional single-line free text: absent/blank → null; line breaks/tabs → one space; trimmed; bounded. */
function normalizeOptionalFreeText(raw: unknown, max: number, invalid: string, tooLong: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error(invalid);
  const text = raw.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return null;
  if (text.length > max) throw new Error(tooLong);
  return text;
}

export function normalizeTodoProgressNote(raw: unknown): string | null {
  return normalizeOptionalFreeText(
    raw,
    CLIENT_OPERATIONS_TODO_PROGRESS_NOTE_MAX,
    'TODO_PROGRESS_NOTE_INVALID',
    'TODO_PROGRESS_NOTE_TOO_LONG',
  );
}

export function normalizeTodoCompletionReason(raw: unknown): string | null {
  return normalizeOptionalFreeText(
    raw,
    CLIENT_OPERATIONS_TODO_COMPLETION_REASON_MAX,
    'TODO_COMPLETION_REASON_INVALID',
    'TODO_COMPLETION_REASON_TOO_LONG',
  );
}

const isBlank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

export type TodoClientIdentityInput =
  | { mode: 'canonical'; client_id: string }
  | { mode: 'one_time'; external_client_name: string; external_client_tax_id: string | null };

/**
 * Create-command identity: exactly ONE of
 *   A) canonical `client_id`            (external fields must be absent)
 *   B) one-time `external_client_name`  (+ optional `external_client_tax_id`, no `client_id`)
 * The backend decides; the frontend never needs to know which rules apply.
 */
export function resolveTodoClientIdentityInput(body: {
  client_id?: unknown;
  external_client_name?: unknown;
  external_client_tax_id?: unknown;
}): TodoClientIdentityInput {
  const hasClientId = !isBlank(body.client_id);
  const hasExternal = !isBlank(body.external_client_name) || !isBlank(body.external_client_tax_id);
  if (hasClientId && hasExternal) throw new Error('TODO_CLIENT_IDENTITY_CONFLICT');
  if (hasClientId) return { mode: 'canonical', client_id: String(body.client_id).trim() };
  if (isBlank(body.external_client_name)) throw new Error('TODO_CLIENT_REQUIRED');
  return {
    mode: 'one_time',
    external_client_name: normalizeTodoExternalClientName(body.external_client_name),
    external_client_tax_id: normalizeTodoExternalClientTaxId(body.external_client_tax_id),
  };
}

export type TodoClientPresentation = {
  id: string | null;
  display_name: string | null;
  tax_id: string | null;
  is_one_time: boolean;
};

/** Backend-ready client presentation for a ToDo (the frontend never infers the client type). */
export function buildTodoClientPresentation(
  row: {
    client_id: string | null;
    external_client_name?: string | null;
    external_client_tax_id?: string | null;
  },
  canonical: { display_name: string | null; tax_id: string | null } | undefined,
): TodoClientPresentation {
  if (row.client_id == null) {
    return {
      id: null,
      display_name: row.external_client_name ?? null,
      tax_id: row.external_client_tax_id ?? null,
      is_one_time: true,
    };
  }
  return {
    id: row.client_id,
    display_name: canonical?.display_name ?? null,
    tax_id: canonical?.tax_id ?? null,
    is_one_time: false,
  };
}

export const CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_MAX_TOKENS = 5;
export const CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_TOKEN_MAX_LENGTH = 60;
export const CLIENT_OPERATIONS_TODO_CLIENT_OPTIONS_DEFAULT_LIMIT = 20;
export const CLIENT_OPERATIONS_TODO_CLIENT_OPTIONS_MAX_LIMIT = 50;

/**
 * Typed ToDo client search text → case-insensitive substring tokens (all tokens must match the client
 * display name or tax id). Characters that are LIKE / PostgREST filter syntax (`% _ \ * , ( ) "`) are
 * dropped so user text can never alter the filter expression.
 */
export function normalizeTodoClientSearchTokens(raw: unknown): string[] {
  const text = String(raw ?? '')
    .toLowerCase()
    .replace(/[%_\\*,()"]/g, ' ');
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim().slice(0, CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_TOKEN_MAX_LENGTH))
    .filter(Boolean);
  return [...new Set(tokens)].slice(0, CLIENT_OPERATIONS_TODO_CLIENT_SEARCH_MAX_TOKENS);
}

export function normalizeTodoClientOptionsLimit(raw: unknown): number {
  const n = Number(raw ?? CLIENT_OPERATIONS_TODO_CLIENT_OPTIONS_DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return CLIENT_OPERATIONS_TODO_CLIENT_OPTIONS_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(n)), CLIENT_OPERATIONS_TODO_CLIENT_OPTIONS_MAX_LIMIT);
}

/** Sort key: priority 1..4 then null/no-priority last. */
export function todoPrioritySortRank(priority: number | null | undefined): number {
  if (priority == null) return 5;
  const n = Number(priority);
  if (!Number.isInteger(n) || n < 1 || n > 4) return 5;
  return n;
}

export function compareTodosForBoardOrder(
  a: { priority: number | null; created_at: string; id: string },
  b: { priority: number | null; created_at: string; id: string },
): number {
  const pr = todoPrioritySortRank(a.priority) - todoPrioritySortRank(b.priority);
  if (pr !== 0) return pr;
  const ca = String(a.created_at ?? '');
  const cb = String(b.created_at ?? '');
  if (ca !== cb) return ca < cb ? -1 : 1;
  const ia = String(a.id ?? '');
  const ib = String(b.id ?? '');
  if (ia === ib) return 0;
  return ia < ib ? -1 : 1;
}

export function normalizeTodoPage(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '1').trim());
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function buildTodoPagination(params: {
  total: number;
  page: number;
  pageSize?: number;
}): {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
} {
  const pageSize = params.pageSize ?? CLIENT_OPERATIONS_TODO_PAGE_SIZE;
  const total = Math.max(0, Math.floor(params.total));
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, Math.floor(params.page)), totalPages);
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    has_prev: page > 1,
    has_next: page < totalPages,
  };
}

export function sliceTodoPage<T>(rows: T[], page: number, pageSize = CLIENT_OPERATIONS_TODO_PAGE_SIZE): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/**
 * Handler assignment does not grant or remove visibility.
 * Office roles retain access. Staff/Viewer retain access only when the
 * visibility policy already allows the client (`assigneeHasClientVisibility`).
 */
export function assigneeWouldRetainClientAccessAfterHandlerChange(params: {
  assigneeUserId: string;
  assigneeHasOfficeAccess: boolean;
  assigneeHasClientVisibility: boolean;
  afterHandlerUserId?: string | null;
}): boolean {
  if (params.assigneeHasOfficeAccess) return true;
  return params.assigneeHasClientVisibility === true;
}

export function presentationPriorityToken(
  priority: number | null | undefined,
): 'p1' | 'p2' | 'p3' | 'p4' | 'none' {
  if (priority === 1) return 'p1';
  if (priority === 2) return 'p2';
  if (priority === 3) return 'p3';
  if (priority === 4) return 'p4';
  return 'none';
}
