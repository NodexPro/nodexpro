/**
 * Client Operations ToDo — Stage 5A aggregates + named commands.
 * Domain owner: Client Operations. Reuses Stage 4 workspace exactly.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import {
  assertUserIsActiveHandlerEligible,
  listActiveHandlerEligibleMembers,
  loadMemberDisplayNamesByUserIds,
} from '../memberships/organization-membership-access.js';
import {
  assertCanAccessClientFromContext,
  clientIdIsAuthorized,
  resolveOrganizationClientAccessScope,
  roleHasOfficeClientAccess,
  type OrganizationClientAccessScope,
} from './organization-client-access.js';
import {
  resolveClientOperationsWorkspaceScopeFromContext,
  workspaceAggregateContract,
  type ClientOperationsWorkspaceRequested,
  type ClientOperationsWorkspaceResolution,
} from './client-operations-workspace.service.js';
import {
  assigneeWouldRetainClientAccessAfterHandlerChange,
  buildTodoPagination,
  CLIENT_OPERATIONS_TODO_PAGE_SIZE,
  compareTodosForBoardOrder,
  normalizeTodoPage,
  normalizeTodoPriority,
  normalizeTodoTaskText,
  presentationPriorityToken,
  sliceTodoPage,
  type ClientOperationsTodoPriority,
} from './client-operations-todo.pure.js';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  return orgId;
}

function canEditClientOperations(ctx: RequestContext): boolean {
  return ctx.membership?.permissions?.includes('client_operations.edit') === true;
}

function canViewClientOperations(ctx: RequestContext): boolean {
  return (
    ctx.membership?.permissions?.includes('client_operations.view') === true ||
    canEditClientOperations(ctx)
  );
}

type TodoRow = {
  id: string;
  organization_id: string;
  client_id: string;
  assigned_to_user_id: string;
  task_text: string;
  priority: number | null;
  created_at: string;
  created_by_user_id: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
};

export type ClientOperationsTodoCard = {
  id: string;
  client: {
    id: string;
    display_name: string | null;
    tax_id: string | null;
  };
  task_text: string;
  priority: ClientOperationsTodoPriority | null;
  priority_presentation_token: 'p1' | 'p2' | 'p3' | 'p4' | 'none';
  assigned_to: { user_id: string; display_name: string };
  created_at: string;
  created_by: { user_id: string | null; display_name: string | null };
  completed_at: string | null;
  completed_by: { user_id: string | null; display_name: string | null };
  allowed_actions: string[];
};

export type ClientOperationsTodoBoardAggregate = {
  title_he: string;
  workspace: ReturnType<typeof workspaceAggregateContract>;
  summary: {
    active_total: number;
    page_size: number;
  };
  pagination: ReturnType<typeof buildTodoPagination>;
  ordering: {
    primary: 'priority_asc_nulls_last';
    secondary: 'created_at_asc';
    tertiary: 'id_asc';
  };
  tasks: ClientOperationsTodoCard[];
  available_clients_hint: {
    search_endpoint: 'todo_client_options';
    note_he: string;
  };
  available_assignees_hint: {
    search_endpoint: 'todo_assignee_options';
    note_he: string;
  };
  allowed_actions: string[];
  query: {
    page: number;
    q: string | null;
    workspace_scope: string | null;
    workspace_subject_user_id: string | null;
  };
};

export type ClientOperationsTodoArchiveAggregate = {
  title_he: string;
  workspace: ReturnType<typeof workspaceAggregateContract>;
  summary: { archive_total: number; page_size: number };
  pagination: ReturnType<typeof buildTodoPagination>;
  tasks: ClientOperationsTodoCard[];
  allowed_actions: string[];
  query: {
    page: number;
    q: string | null;
    filter_priority: string | null;
    filter_assignee: string | null;
    workspace_scope: string | null;
    workspace_subject_user_id: string | null;
  };
};

export type ClientOperationsTodoClientOption = {
  client_id: string;
  display_name: string | null;
  tax_id: string | null;
};

export type ClientOperationsTodoAssigneeOption = {
  user_id: string;
  display_name: string;
  role_code: string;
};

function mapPriorityError(e: unknown): never {
  if (e instanceof Error) {
    if (e.message === 'INVALID_TODO_PRIORITY') {
      throw badRequest('priority must be 1..4 or null', 'TODO_PRIORITY_INVALID');
    }
    if (e.message === 'TODO_TEXT_REQUIRED') {
      throw badRequest('task_text required', 'TODO_TEXT_REQUIRED');
    }
    if (e.message === 'TODO_TEXT_TOO_LONG') {
      throw badRequest('task_text exceeds maximum length', 'TODO_TEXT_TOO_LONG');
    }
  }
  throw e;
}

function safeNormalizePriority(raw: unknown): ClientOperationsTodoPriority | null {
  try {
    return normalizeTodoPriority(raw);
  } catch (e) {
    mapPriorityError(e);
  }
}

function safeNormalizeText(raw: unknown): string {
  try {
    return normalizeTodoTaskText(raw);
  } catch (e) {
    mapPriorityError(e);
  }
}

async function resolveWorkspace(
  ctx: RequestContext,
  requested?: ClientOperationsWorkspaceRequested | null,
): Promise<{
  orgId: string;
  workspace: ClientOperationsWorkspaceResolution;
  materializationAccess: OrganizationClientAccessScope;
}> {
  const orgId = assertOrg(ctx);
  if (!canViewClientOperations(ctx)) {
    throw forbidden('Client Operations view required', 'CLIENT_OPERATIONS_VIEW_FORBIDDEN');
  }
  const { workspace, materializationAccess } = await resolveClientOperationsWorkspaceScopeFromContext(
    ctx,
    requested,
  );
  return { orgId, workspace, materializationAccess };
}

/** Workspace assignee filter for board/archive task lists. */
function workspaceAssigneeFilter(workspace: ClientOperationsWorkspaceResolution): string | null {
  if (workspace.scope_kind === 'OFFICE') return null;
  return workspace.workspace_subject_user_id;
}

function taskMatchesWorkspaceProjection(
  task: Pick<TodoRow, 'assigned_to_user_id' | 'client_id'>,
  workspace: ClientOperationsWorkspaceResolution,
  materializationAccess: OrganizationClientAccessScope,
): boolean {
  const assigneeFilter = workspaceAssigneeFilter(workspace);
  if (assigneeFilter && task.assigned_to_user_id !== assigneeFilter) return false;
  if (!clientIdIsAuthorized(materializationAccess, task.client_id)) return false;
  return true;
}

async function loadClientIdentityMap(
  orgId: string,
  clientIds: string[],
): Promise<Map<string, { display_name: string | null; tax_id: string | null }>> {
  const map = new Map<string, { display_name: string | null; tax_id: string | null }>();
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw new Error(error.message ?? 'Failed to load clients');
  for (const row of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    tax_id: string | null;
  }>) {
    map.set(row.id, { display_name: row.display_name, tax_id: row.tax_id });
  }
  return map;
}

function taskAllowedActions(params: {
  ctx: RequestContext;
  task: TodoRow;
  workspace: ClientOperationsWorkspaceResolution;
  materializationAccess: OrganizationClientAccessScope;
}): string[] {
  const { ctx, task, workspace, materializationAccess } = params;
  if (!canEditClientOperations(ctx)) return [];
  if (!taskMatchesWorkspaceProjection(task, workspace, materializationAccess)) return [];

  const role = ctx.membership?.roleCode ?? null;
  const isOfficeManager = roleHasOfficeClientAccess(role);
  const isAssignee = task.assigned_to_user_id === ctx.user.id;
  if (!isOfficeManager && !isAssignee) return [];

  const actions: string[] = [];
  if (task.completed_at == null) {
    actions.push('update_client_operations_todo', 'complete_client_operations_todo');
  } else {
    actions.push('reopen_client_operations_todo');
  }
  return actions;
}

async function hydrateTodoCards(params: {
  ctx: RequestContext;
  orgId: string;
  rows: TodoRow[];
  workspace: ClientOperationsWorkspaceResolution;
  materializationAccess: OrganizationClientAccessScope;
}): Promise<ClientOperationsTodoCard[]> {
  const { ctx, orgId, rows, workspace, materializationAccess } = params;
  const clientMap = await loadClientIdentityMap(
    orgId,
    rows.map((r) => r.client_id),
  );
  const userIds = rows.flatMap((r) => [
    r.assigned_to_user_id,
    r.created_by_user_id,
    r.completed_by_user_id,
  ]);
  const names = await loadMemberDisplayNamesByUserIds(userIds.filter(Boolean) as string[]);

  return rows.map((r) => {
    const client = clientMap.get(r.client_id);
    const priority =
      r.priority === 1 || r.priority === 2 || r.priority === 3 || r.priority === 4
        ? (r.priority as ClientOperationsTodoPriority)
        : null;
    return {
      id: r.id,
      client: {
        id: r.client_id,
        display_name: client?.display_name ?? null,
        tax_id: client?.tax_id ?? null,
      },
      task_text: r.task_text,
      priority,
      priority_presentation_token: presentationPriorityToken(priority),
      assigned_to: {
        user_id: r.assigned_to_user_id,
        display_name: names.get(r.assigned_to_user_id) ?? r.assigned_to_user_id,
      },
      created_at: r.created_at,
      created_by: {
        user_id: r.created_by_user_id,
        display_name: r.created_by_user_id
          ? names.get(r.created_by_user_id) ?? null
          : null,
      },
      completed_at: r.completed_at,
      completed_by: {
        user_id: r.completed_by_user_id,
        display_name: r.completed_by_user_id
          ? names.get(r.completed_by_user_id) ?? null
          : null,
      },
      allowed_actions: taskAllowedActions({ ctx, task: r, workspace, materializationAccess }),
    };
  });
}

async function loadOrgTodos(params: {
  orgId: string;
  active: boolean;
  authorizedClientIds: string[] | null;
}): Promise<TodoRow[]> {
  if (params.authorizedClientIds && params.authorizedClientIds.length === 0) return [];
  let q = supabaseAdmin
    .from('client_operations_todos')
    .select(
      'id, organization_id, client_id, assigned_to_user_id, task_text, priority, created_at, created_by_user_id, updated_at, updated_by_user_id, completed_at, completed_by_user_id',
    )
    .eq('organization_id', params.orgId);
  if (params.authorizedClientIds) q = q.in('client_id', params.authorizedClientIds);
  if (params.active) q = q.is('completed_at', null);
  else q = q.not('completed_at', 'is', null);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Failed to load todos');
  return (data ?? []) as TodoRow[];
}

async function excludeArchivedClientTodos(
  orgId: string,
  rows: TodoRow[],
  access: OrganizationClientAccessScope,
): Promise<TodoRow[]> {
  if (access.kind === 'OFFICE' || access.authorized_client_ids !== null || rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('id', ids);
  if (error) throw new Error(error.message ?? 'Failed to filter todo clients');
  const live = new Set((data ?? []).map((row) => String((row as { id: string }).id)));
  return rows.filter((r) => live.has(r.client_id));
}

function filterTodosForWorkspace(
  rows: TodoRow[],
  workspace: ClientOperationsWorkspaceResolution,
  materializationAccess: OrganizationClientAccessScope,
): TodoRow[] {
  return rows.filter((r) => taskMatchesWorkspaceProjection(r, workspace, materializationAccess));
}

function boardAllowedActions(ctx: RequestContext): string[] {
  if (!canEditClientOperations(ctx)) return ['view_todo_board', 'view_todo_archive'];
  return [
    'view_todo_board',
    'view_todo_archive',
    'create_client_operations_todo',
    'update_client_operations_todo',
    'complete_client_operations_todo',
    'reopen_client_operations_todo',
  ];
}

export async function getClientOperationsTodoBoard(
  ctx: RequestContext,
  query: ClientOperationsWorkspaceRequested & { page?: unknown; q?: string | null } = {},
): Promise<ClientOperationsTodoBoardAggregate> {
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, query);
  const pageReq = normalizeTodoPage(query.page);
  const q = String(query.q ?? '').trim().toLowerCase();
  const allActive = await excludeArchivedClientTodos(
    orgId,
    await loadOrgTodos({
      orgId,
      active: true,
      authorizedClientIds: materializationAccess.authorized_client_ids,
    }),
    materializationAccess,
  );
  let scoped = filterTodosForWorkspace(allActive, workspace, materializationAccess);

  if (q) {
    const clientMap = await loadClientIdentityMap(
      orgId,
      scoped.map((r) => r.client_id),
    );
    scoped = scoped.filter((r) => {
      const c = clientMap.get(r.client_id);
      const hay = [r.task_text, c?.display_name ?? '', c?.tax_id ?? ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  scoped = scoped.sort(compareTodosForBoardOrder);
  const pagination = buildTodoPagination({ total: scoped.length, page: pageReq });
  const pageRows = sliceTodoPage(scoped, pagination.page);
  const tasks = await hydrateTodoCards({
    ctx,
    orgId,
    rows: pageRows,
    workspace,
    materializationAccess,
  });

  return {
    title_he: 'ToDo List',
    workspace: workspaceAggregateContract(workspace),
    summary: {
      active_total: scoped.length,
      page_size: CLIENT_OPERATIONS_TODO_PAGE_SIZE,
    },
    pagination,
    ordering: {
      primary: 'priority_asc_nulls_last',
      secondary: 'created_at_asc',
      tertiary: 'id_asc',
    },
    tasks,
    available_clients_hint: {
      search_endpoint: 'todo_client_options',
      note_he: 'חיפוש לקוחות מורשה לפי מרחב העבודה',
    },
    available_assignees_hint: {
      search_endpoint: 'todo_assignee_options',
      note_he: 'אפשרויות אחראי לפי לקוח ומרחב עבודה',
    },
    allowed_actions: boardAllowedActions(ctx),
    query: {
      page: pagination.page,
      q: q || null,
      workspace_scope:
        workspace.scope_kind === 'OFFICE'
          ? 'office'
          : workspace.scope_kind === 'MY'
            ? 'my'
            : 'staff',
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  };
}

export async function getClientOperationsTodoArchive(
  ctx: RequestContext,
  query: ClientOperationsWorkspaceRequested & {
    page?: unknown;
    q?: string | null;
    filter_priority?: string | null;
    filter_assignee?: string | null;
  } = {},
): Promise<ClientOperationsTodoArchiveAggregate> {
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, query);
  const pageReq = normalizeTodoPage(query.page);
  const q = String(query.q ?? '').trim().toLowerCase();
  const filterPriorityRaw = String(query.filter_priority ?? '').trim();
  const filterAssignee = String(query.filter_assignee ?? '').trim() || null;

  let filterPriority: number | null | 'none' | undefined;
  if (!filterPriorityRaw || filterPriorityRaw === 'all') filterPriority = undefined;
  else if (filterPriorityRaw === 'none') filterPriority = 'none';
  else filterPriority = safeNormalizePriority(filterPriorityRaw);

  const allDone = await excludeArchivedClientTodos(
    orgId,
    await loadOrgTodos({
      orgId,
      active: false,
      authorizedClientIds: materializationAccess.authorized_client_ids,
    }),
    materializationAccess,
  );
  let scoped = filterTodosForWorkspace(allDone, workspace, materializationAccess);

  if (filterAssignee) {
    scoped = scoped.filter((r) => r.assigned_to_user_id === filterAssignee);
  }
  if (filterPriority === 'none') {
    scoped = scoped.filter((r) => r.priority == null);
  } else if (typeof filterPriority === 'number') {
    scoped = scoped.filter((r) => r.priority === filterPriority);
  }

  // Hydrate for search on client name / tax_id / task text (authorized set only).
  const clientMap = await loadClientIdentityMap(
    orgId,
    scoped.map((r) => r.client_id),
  );
  if (q) {
    scoped = scoped.filter((r) => {
      const c = clientMap.get(r.client_id);
      const hay = [
        r.task_text,
        c?.display_name ?? '',
        c?.tax_id ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  scoped = scoped.sort((a, b) => {
    const ca = String(a.completed_at ?? '');
    const cb = String(b.completed_at ?? '');
    if (ca !== cb) return ca > cb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });

  const pagination = buildTodoPagination({ total: scoped.length, page: pageReq });
  const pageRows = sliceTodoPage(scoped, pagination.page);
  const tasks = await hydrateTodoCards({
    ctx,
    orgId,
    rows: pageRows,
    workspace,
    materializationAccess,
  });

  return {
    title_he: 'ארכיון ToDo',
    workspace: workspaceAggregateContract(workspace),
    summary: {
      archive_total: scoped.length,
      page_size: CLIENT_OPERATIONS_TODO_PAGE_SIZE,
    },
    pagination,
    tasks,
    allowed_actions: boardAllowedActions(ctx).filter(
      (a) => a === 'view_todo_archive' || a === 'reopen_client_operations_todo',
    ),
    query: {
      page: pagination.page,
      q: q || null,
      filter_priority: filterPriorityRaw || null,
      filter_assignee: filterAssignee,
      workspace_scope:
        workspace.scope_kind === 'OFFICE'
          ? 'office'
          : workspace.scope_kind === 'MY'
            ? 'my'
            : 'staff',
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  };
}

export async function searchClientOperationsTodoClientOptions(
  ctx: RequestContext,
  query: ClientOperationsWorkspaceRequested & { q?: string | null; limit?: unknown } = {},
): Promise<{ options: ClientOperationsTodoClientOption[] }> {
  const { orgId, materializationAccess } = await resolveWorkspace(ctx, query);
  const q = String(query.q ?? '').trim().toLowerCase();
  const limitRaw = Number(query.limit ?? 30);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 30;

  let clientQuery = supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name', { ascending: true })
    .limit(200);

  if (materializationAccess.authorized_client_ids !== null) {
    if (materializationAccess.authorized_client_ids.length === 0) {
      return { options: [] };
    }
    clientQuery = clientQuery.in('id', materializationAccess.authorized_client_ids);
  }

  const { data, error } = await clientQuery;
  if (error) throw new Error(error.message ?? 'Failed to search clients');

  let rows = (data ?? []) as Array<{ id: string; display_name: string | null; tax_id: string | null }>;
  if (q) {
    rows = rows.filter((r) => {
      const hay = `${r.display_name ?? ''} ${r.tax_id ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return {
    options: rows.slice(0, limit).map((r) => ({
      client_id: r.id,
      display_name: r.display_name,
      tax_id: r.tax_id,
    })),
  };
}

/**
 * Assignees eligible for a client under current workspace + Stage 3 access.
 * Staff: self only. Owner/Admin OFFICE: eligible members who can access client.
 * Owner/Admin MY/STAFF: typically workspace subject (and self if office manager).
 */
export async function listClientOperationsTodoAssigneeOptions(
  ctx: RequestContext,
  query: ClientOperationsWorkspaceRequested & { client_id?: string | null } = {},
): Promise<{ options: ClientOperationsTodoAssigneeOption[]; default_assignee_user_id: string | null }> {
  const { orgId, workspace } = await resolveWorkspace(ctx, query);
  const clientId = String(query.client_id ?? '').trim();
  if (!clientId) throw badRequest('client_id required', 'TODO_CLIENT_REQUIRED');

  await assertCanAccessClientFromContext(ctx, clientId);

  const role = ctx.membership?.roleCode ?? null;
  const isOfficeManager = roleHasOfficeClientAccess(role);
  const eligible = await listActiveHandlerEligibleMembers(orgId);

  const canAccessClientAsAssignee = async (userId: string, roleCode: string): Promise<boolean> => {
    const scope = await resolveOrganizationClientAccessScope({
      organizationId: orgId,
      viewerUserId: userId,
      roleCode,
    });
    if (!clientIdIsAuthorized(scope, clientId)) return false;
    if (scope.kind === 'OFFICE') return true;
    const { data } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .eq('is_archived', false)
      .maybeSingle();
    return Boolean(data);
  };

  let candidates = eligible;
  if (!isOfficeManager) {
    candidates = eligible.filter((m) => m.user_id === ctx.user.id);
  } else if (workspace.scope_kind !== 'OFFICE') {
    const subject = workspace.workspace_subject_user_id;
    // Subject + other office managers who retain access; Staff only subject unless reassignment.
    candidates = eligible.filter(
      (m) => m.user_id === subject || roleHasOfficeClientAccess(m.role_code),
    );
  }

  const options: ClientOperationsTodoAssigneeOption[] = [];
  for (const m of candidates) {
    if (!(await canAccessClientAsAssignee(m.user_id, m.role_code))) continue;
    options.push({
      user_id: m.user_id,
      display_name: m.display_name,
      role_code: m.role_code,
    });
  }

  let default_assignee_user_id: string | null = null;
  if (workspace.scope_kind === 'OFFICE') {
    default_assignee_user_id = null; // require explicit
  } else {
    default_assignee_user_id = workspace.workspace_subject_user_id;
  }

  return { options, default_assignee_user_id };
}

async function assertAssigneeCanAccessClient(params: {
  organizationId: string;
  assigneeUserId: string;
  clientId: string;
}): Promise<void> {
  await assertUserIsActiveHandlerEligible(params.organizationId, params.assigneeUserId);
  const members = await listActiveHandlerEligibleMembers(params.organizationId);
  const member = members.find((m) => m.user_id === params.assigneeUserId);
  if (!member) throw forbidden('Assignee not eligible', 'TODO_ASSIGNEE_FORBIDDEN');
  if (roleHasOfficeClientAccess(member.role_code)) return;
  const scope = await resolveOrganizationClientAccessScope({
    organizationId: params.organizationId,
    viewerUserId: params.assigneeUserId,
    roleCode: member.role_code,
  });
  if (!clientIdIsAuthorized(scope, params.clientId)) {
    throw forbidden('Assignee cannot access client', 'TODO_ASSIGNEE_CLIENT_ACCESS_FORBIDDEN');
  }
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('id', params.clientId)
    .eq('is_archived', false)
    .maybeSingle();
  if (!data) throw forbidden('Assignee cannot access client', 'TODO_ASSIGNEE_CLIENT_ACCESS_FORBIDDEN');
}

async function loadTodoOrForbidden(orgId: string, todoId: string): Promise<TodoRow> {
  const id = String(todoId ?? '').trim();
  if (!id) throw forbidden('ToDo not found');
  const { data, error } = await supabaseAdmin
    .from('client_operations_todos')
    .select(
      'id, organization_id, client_id, assigned_to_user_id, task_text, priority, created_at, created_by_user_id, updated_at, updated_by_user_id, completed_at, completed_by_user_id',
    )
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message ?? 'Failed to load todo');
  if (!data) throw forbidden('ToDo not found');
  return data as TodoRow;
}

function assertCanMutateTodo(params: {
  ctx: RequestContext;
  task: TodoRow;
  workspace: ClientOperationsWorkspaceResolution;
  materializationAccess: OrganizationClientAccessScope;
}): void {
  const { ctx, task, workspace, materializationAccess } = params;
  if (!canEditClientOperations(ctx)) {
    throw forbidden('Client Operations edit required', 'CLIENT_OPERATIONS_EDIT_FORBIDDEN');
  }
  if (!taskMatchesWorkspaceProjection(task, workspace, materializationAccess)) {
    throw forbidden('ToDo not found');
  }
  const isOfficeManager = roleHasOfficeClientAccess(ctx.membership?.roleCode);
  const isAssignee = task.assigned_to_user_id === ctx.user.id;
  if (!isOfficeManager && !isAssignee) {
    throw forbidden('ToDo not found');
  }
}

function resolveCreateAssignee(params: {
  ctx: RequestContext;
  workspace: ClientOperationsWorkspaceResolution;
  requestedAssignee: string | null;
}): string {
  const { ctx, workspace, requestedAssignee } = params;
  const isOfficeManager = roleHasOfficeClientAccess(ctx.membership?.roleCode);

  if (!isOfficeManager) {
    // Staff: self only.
    if (requestedAssignee && requestedAssignee !== ctx.user.id) {
      throw forbidden('Staff may only assign ToDo to self', 'TODO_ASSIGNEE_FORBIDDEN');
    }
    return ctx.user.id;
  }

  if (workspace.scope_kind === 'OFFICE') {
    if (!requestedAssignee) {
      throw badRequest('assigned_to_user_id required in OFFICE workspace', 'TODO_ASSIGNEE_REQUIRED');
    }
    return requestedAssignee;
  }

  // MY / STAFF: default workspace subject; allow explicit override among permitted.
  const defaultAssignee = workspace.workspace_subject_user_id ?? ctx.user.id;
  return requestedAssignee || defaultAssignee;
}

export async function createClientOperationsTodo(
  ctx: RequestContext,
  body: {
    client_id?: unknown;
    task_text?: unknown;
    priority?: unknown;
    assigned_to_user_id?: unknown;
    workspace_scope?: unknown;
    workspace_subject_user_id?: unknown;
    page?: unknown;
    q?: unknown;
  },
): Promise<ClientOperationsTodoBoardAggregate> {
  if (!canEditClientOperations(ctx)) {
    throw forbidden('Client Operations edit required', 'CLIENT_OPERATIONS_EDIT_FORBIDDEN');
  }
  const requested: ClientOperationsWorkspaceRequested = {
    workspace_scope: typeof body.workspace_scope === 'string' ? body.workspace_scope : null,
    workspace_subject_user_id:
      typeof body.workspace_subject_user_id === 'string' ? body.workspace_subject_user_id : null,
  };
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, requested);

  const clientId = String(body.client_id ?? '').trim();
  if (!clientId) throw badRequest('client_id required', 'TODO_CLIENT_REQUIRED');
  await assertCanAccessClientFromContext(ctx, clientId, materializationAccess);
  if (!clientIdIsAuthorized(materializationAccess, clientId)) {
    throw forbidden('Client not found');
  }

  const taskText = safeNormalizeText(body.task_text);
  const priority =
    body.priority === undefined ? null : safeNormalizePriority(body.priority === '' ? null : body.priority);
  const requestedAssigneeRaw =
    body.assigned_to_user_id == null || body.assigned_to_user_id === undefined
      ? null
      : String(body.assigned_to_user_id).trim() || null;
  const assigneeId = resolveCreateAssignee({
    ctx,
    workspace,
    requestedAssignee: requestedAssigneeRaw,
  });

  await assertAssigneeCanAccessClient({
    organizationId: orgId,
    assigneeUserId: assigneeId,
    clientId,
  });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('client_operations_todos')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      assigned_to_user_id: assigneeId,
      task_text: taskText,
      priority,
      created_at: now,
      created_by_user_id: ctx.user.id,
      updated_at: now,
      updated_by_user_id: ctx.user.id,
      completed_at: null,
      completed_by_user_id: null,
    })
    .select('id')
    .single();
  if (error) throw new AppError(500, error.message || 'Failed to create todo', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_todo',
    entityId: String((data as { id: string }).id),
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_TODO_CREATED,
    payload: {
      todo_id: (data as { id: string }).id,
      client_id: clientId,
      assigned_to_user_id: assigneeId,
      priority,
      workspace_scope_kind: workspace.scope_kind,
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  });

  return getClientOperationsTodoBoard(ctx, { ...requested, page: body.page, q: typeof body.q === 'string' ? body.q : null });
}

export async function updateClientOperationsTodo(
  ctx: RequestContext,
  body: {
    todo_id?: unknown;
    task_text?: unknown;
    priority?: unknown;
    assigned_to_user_id?: unknown;
    workspace_scope?: unknown;
    workspace_subject_user_id?: unknown;
    page?: unknown;
    q?: unknown;
  },
): Promise<ClientOperationsTodoBoardAggregate> {
  const requested: ClientOperationsWorkspaceRequested = {
    workspace_scope: typeof body.workspace_scope === 'string' ? body.workspace_scope : null,
    workspace_subject_user_id:
      typeof body.workspace_subject_user_id === 'string' ? body.workspace_subject_user_id : null,
  };
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, requested);
  const todoId = String(body.todo_id ?? '').trim();
  const task = await loadTodoOrForbidden(orgId, todoId);
  assertCanMutateTodo({ ctx, task, workspace, materializationAccess });
  if (task.completed_at != null) {
    throw badRequest('Cannot update completed ToDo; reopen first', 'TODO_ALREADY_COMPLETED');
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by_user_id: ctx.user.id,
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let reassigned = false;

  if (body.task_text !== undefined) {
    const text = safeNormalizeText(body.task_text);
    if (text !== task.task_text) {
      before.task_text = task.task_text;
      after.task_text = text;
      patch.task_text = text;
    }
  }
  if (body.priority !== undefined) {
    const priority = safeNormalizePriority(body.priority === '' ? null : body.priority);
    if (priority !== task.priority) {
      before.priority = task.priority;
      after.priority = priority;
      patch.priority = priority;
    }
  }
  if (body.assigned_to_user_id !== undefined) {
    const isOfficeManager = roleHasOfficeClientAccess(ctx.membership?.roleCode);
    if (!isOfficeManager) {
      throw forbidden('Staff cannot reassign ToDo', 'TODO_REASSIGN_FORBIDDEN');
    }
    const nextAssignee = String(body.assigned_to_user_id ?? '').trim();
    if (!nextAssignee) throw badRequest('assigned_to_user_id required', 'TODO_ASSIGNEE_REQUIRED');
    if (nextAssignee !== task.assigned_to_user_id) {
      await assertAssigneeCanAccessClient({
        organizationId: orgId,
        assigneeUserId: nextAssignee,
        clientId: task.client_id,
      });
      before.assigned_to_user_id = task.assigned_to_user_id;
      after.assigned_to_user_id = nextAssignee;
      patch.assigned_to_user_id = nextAssignee;
      reassigned = true;
    }
  }

  if (Object.keys(after).length === 0) {
    return getClientOperationsTodoBoard(ctx, { ...requested, page: body.page, q: typeof body.q === 'string' ? body.q : null });
  }

  const { error } = await supabaseAdmin
    .from('client_operations_todos')
    .update(patch)
    .eq('organization_id', orgId)
    .eq('id', todoId);
  if (error) throw new AppError(500, error.message || 'Failed to update todo', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_todo',
    entityId: todoId,
    action: reassigned
      ? AUDIT_ACTIONS.CLIENT_OPERATIONS_TODO_REASSIGNED
      : AUDIT_ACTIONS.CLIENT_OPERATIONS_TODO_UPDATED,
    payload: {
      todo_id: todoId,
      client_id: task.client_id,
      before,
      after,
      workspace_scope_kind: workspace.scope_kind,
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  });

  return getClientOperationsTodoBoard(ctx, { ...requested, page: body.page, q: typeof body.q === 'string' ? body.q : null });
}

export async function completeClientOperationsTodo(
  ctx: RequestContext,
  body: {
    todo_id?: unknown;
    workspace_scope?: unknown;
    workspace_subject_user_id?: unknown;
    page?: unknown;
    q?: unknown;
  },
): Promise<ClientOperationsTodoBoardAggregate> {
  const requested: ClientOperationsWorkspaceRequested = {
    workspace_scope: typeof body.workspace_scope === 'string' ? body.workspace_scope : null,
    workspace_subject_user_id:
      typeof body.workspace_subject_user_id === 'string' ? body.workspace_subject_user_id : null,
  };
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, requested);
  const todoId = String(body.todo_id ?? '').trim();
  const task = await loadTodoOrForbidden(orgId, todoId);
  assertCanMutateTodo({ ctx, task, workspace, materializationAccess });
  if (task.completed_at != null) {
    return getClientOperationsTodoBoard(ctx, { ...requested, page: body.page, q: typeof body.q === 'string' ? body.q : null });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('client_operations_todos')
    .update({
      completed_at: now,
      completed_by_user_id: ctx.user.id,
      updated_at: now,
      updated_by_user_id: ctx.user.id,
    })
    .eq('organization_id', orgId)
    .eq('id', todoId);
  if (error) throw new AppError(500, error.message || 'Failed to complete todo', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_todo',
    entityId: todoId,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_TODO_COMPLETED,
    payload: {
      todo_id: todoId,
      client_id: task.client_id,
      assigned_to_user_id: task.assigned_to_user_id,
      completed_at: now,
      workspace_scope_kind: workspace.scope_kind,
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  });

  return getClientOperationsTodoBoard(ctx, { ...requested, page: body.page, q: typeof body.q === 'string' ? body.q : null });
}

/** Refreshed truth after reopen — both surfaces when archive context is requested. */
export type ClientOperationsTodoReopenResult = {
  board: ClientOperationsTodoBoardAggregate;
  archive: ClientOperationsTodoArchiveAggregate;
};

export async function reopenClientOperationsTodo(
  ctx: RequestContext,
  body: {
    todo_id?: unknown;
    workspace_scope?: unknown;
    workspace_subject_user_id?: unknown;
    page?: unknown;
    q?: unknown;
    return_archive?: unknown;
    query?: unknown;
    board_page?: unknown;
    board_q?: unknown;
  },
): Promise<ClientOperationsTodoBoardAggregate | ClientOperationsTodoReopenResult> {
  const requested: ClientOperationsWorkspaceRequested = {
    workspace_scope: typeof body.workspace_scope === 'string' ? body.workspace_scope : null,
    workspace_subject_user_id:
      typeof body.workspace_subject_user_id === 'string' ? body.workspace_subject_user_id : null,
  };
  const { orgId, workspace, materializationAccess } = await resolveWorkspace(ctx, requested);
  const todoId = String(body.todo_id ?? '').trim();
  const task = await loadTodoOrForbidden(orgId, todoId);
  assertCanMutateTodo({ ctx, task, workspace, materializationAccess });

  const qObj =
    body.query && typeof body.query === 'object' && !Array.isArray(body.query)
      ? (body.query as Record<string, unknown>)
      : {};
  const boardPage = body.board_page ?? qObj.board_page ?? body.page;
  const boardQ =
    typeof body.board_q === 'string'
      ? body.board_q
      : typeof qObj.board_q === 'string'
        ? qObj.board_q
        : typeof body.q === 'string'
          ? body.q
          : null;

  if (task.completed_at == null) {
    if (body.return_archive === true) {
      const [board, archive] = await Promise.all([
        getClientOperationsTodoBoard(ctx, { ...requested, page: boardPage, q: boardQ }),
        getClientOperationsTodoArchive(ctx, {
          ...requested,
          page: body.page,
          q: typeof body.q === 'string' ? body.q : typeof qObj.q === 'string' ? qObj.q : null,
          filter_priority:
            typeof qObj.filter_priority === 'string' ? qObj.filter_priority : null,
          filter_assignee:
            typeof qObj.filter_assignee === 'string' ? qObj.filter_assignee : null,
        }),
      ]);
      return { board, archive };
    }
    return getClientOperationsTodoBoard(ctx, { ...requested, page: boardPage, q: boardQ });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('client_operations_todos')
    .update({
      completed_at: null,
      completed_by_user_id: null,
      updated_at: now,
      updated_by_user_id: ctx.user.id,
    })
    .eq('organization_id', orgId)
    .eq('id', todoId);
  if (error) throw new AppError(500, error.message || 'Failed to reopen todo', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_todo',
    entityId: todoId,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_TODO_REOPENED,
    payload: {
      todo_id: todoId,
      client_id: task.client_id,
      assigned_to_user_id: task.assigned_to_user_id,
      previous_completed_at: task.completed_at,
      previous_completed_by_user_id: task.completed_by_user_id,
      workspace_scope_kind: workspace.scope_kind,
      workspace_subject_user_id: workspace.workspace_subject_user_id,
    },
  });

  if (body.return_archive === true) {
    const [board, archive] = await Promise.all([
      getClientOperationsTodoBoard(ctx, { ...requested, page: boardPage, q: boardQ }),
      getClientOperationsTodoArchive(ctx, {
        ...requested,
        page: body.page,
        q: typeof body.q === 'string' ? body.q : typeof qObj.q === 'string' ? qObj.q : null,
        filter_priority:
          typeof qObj.filter_priority === 'string' ? qObj.filter_priority : null,
        filter_assignee:
          typeof qObj.filter_assignee === 'string' ? qObj.filter_assignee : null,
      }),
    ]);
    return { board, archive };
  }
  return getClientOperationsTodoBoard(ctx, { ...requested, page: boardPage, q: boardQ });
}

export type ClientOperationsTodoCommandBody = {
  command?: unknown;
  todo_id?: unknown;
  client_id?: unknown;
  task_text?: unknown;
  priority?: unknown;
  assigned_to_user_id?: unknown;
  workspace_scope?: unknown;
  workspace_subject_user_id?: unknown;
  page?: unknown;
  q?: unknown;
  return_archive?: unknown;
  query?: unknown;
};

function workspaceFromCommandBody(body: ClientOperationsTodoCommandBody): {
  workspace_scope?: string | null;
  workspace_subject_user_id?: string | null;
  page?: unknown;
  q?: string | null;
} {
  const qObj =
    body.query && typeof body.query === 'object' && !Array.isArray(body.query)
      ? (body.query as Record<string, unknown>)
      : {};
  return {
    workspace_scope:
      typeof body.workspace_scope === 'string'
        ? body.workspace_scope
        : typeof qObj.workspace_scope === 'string'
          ? qObj.workspace_scope
          : null,
    workspace_subject_user_id:
      typeof body.workspace_subject_user_id === 'string'
        ? body.workspace_subject_user_id
        : typeof qObj.workspace_subject_user_id === 'string'
          ? qObj.workspace_subject_user_id
          : null,
    page: body.page ?? qObj.page,
    q:
      typeof body.q === 'string'
        ? body.q
        : typeof qObj.q === 'string'
          ? qObj.q
          : null,
  };
}

export async function executeClientOperationsTodoCommand(
  ctx: RequestContext,
  body: ClientOperationsTodoCommandBody,
) {
  const command = String(body.command ?? '').trim();
  const ws = workspaceFromCommandBody(body);
  if (command === 'create_client_operations_todo') {
    return createClientOperationsTodo(ctx, { ...body, ...ws });
  }
  if (command === 'update_client_operations_todo') {
    return updateClientOperationsTodo(ctx, { ...body, ...ws });
  }
  if (command === 'complete_client_operations_todo') {
    return completeClientOperationsTodo(ctx, { ...body, ...ws });
  }
  if (command === 'reopen_client_operations_todo') {
    return reopenClientOperationsTodo(ctx, { ...body, ...ws });
  }
  throw badRequest(`Unknown ToDo command: ${command || '(empty)'}`);
}

/**
 * Block client handler reassignment when active ToDos would become inaccessible
 * to their assignees under Stage 3 after the change.
 */
export async function assertNoIncompatibleActiveTodosForHandlerChange(params: {
  organizationId: string;
  clientId: string;
  afterHandlerUserId: string | null;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_todos')
    .select('id, assigned_to_user_id, task_text')
    .eq('organization_id', params.organizationId)
    .eq('client_id', params.clientId)
    .is('completed_at', null);
  if (error) throw new Error(error.message ?? 'Failed to load active todos for handler check');

  const rows = (data ?? []) as Array<{
    id: string;
    assigned_to_user_id: string;
    task_text: string;
  }>;
  if (!rows.length) return;

  const assigneeIds = [...new Set(rows.map((r) => r.assigned_to_user_id))];
  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_memberships')
    .select('user_id, role_code, status')
    .eq('organization_id', params.organizationId)
    .in('user_id', assigneeIds);
  if (memErr) throw new Error(memErr.message ?? 'Failed to load assignee memberships');

  const roleByUser = new Map<string, string>();
  for (const m of (memberships ?? []) as Array<{
    user_id: string;
    role_code: string;
    status: string;
  }>) {
    if (m.status === 'active') roleByUser.set(m.user_id, m.role_code);
  }

  const conflicting: typeof rows = [];
  for (const r of rows) {
    const role = roleByUser.get(r.assigned_to_user_id) ?? 'staff';
    const scope = await resolveOrganizationClientAccessScope({
      organizationId: params.organizationId,
      viewerUserId: r.assigned_to_user_id,
      roleCode: role,
    });
    const retains = assigneeWouldRetainClientAccessAfterHandlerChange({
      assigneeUserId: r.assigned_to_user_id,
      assigneeHasOfficeAccess: roleHasOfficeClientAccess(role),
      assigneeHasClientVisibility: clientIdIsAuthorized(scope, params.clientId),
      afterHandlerUserId: params.afterHandlerUserId,
    });
    if (!retains) conflicting.push(r);
  }

  if (!conflicting.length) return;

  throw conflict(
    'Active ToDo tasks block client handler reassignment',
    'CLIENT_HANDLER_TODO_CONFLICT',
    {
      client_id: params.clientId,
      conflicting_todo_count: conflicting.length,
      conflicting_todos: conflicting.slice(0, 50).map((t) => ({
        todo_id: t.id,
        assigned_to_user_id: t.assigned_to_user_id,
        task_text_preview: t.task_text.slice(0, 120),
      })),
    },
  );
}
