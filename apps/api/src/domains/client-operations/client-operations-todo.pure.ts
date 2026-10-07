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
 * After client handler becomes `afterHandlerUserId`, would `assigneeUserId` still
 * access the client under Stage 3 rules?
 * Owner/Admin (office access) always retain access; Staff only if they are the handler.
 */
export function assigneeWouldRetainClientAccessAfterHandlerChange(params: {
  assigneeUserId: string;
  assigneeHasOfficeAccess: boolean;
  afterHandlerUserId: string | null;
}): boolean {
  if (params.assigneeHasOfficeAccess) return true;
  const after = params.afterHandlerUserId == null ? null : String(params.afterHandlerUserId).trim() || null;
  return after === params.assigneeUserId;
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
