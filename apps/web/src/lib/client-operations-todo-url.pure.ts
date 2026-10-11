/**
 * Client Operations ToDo API URLs (Stage 5B).
 * Kept outside endpoints.ts (unrelated OWNER WIP must stay untouched).
 */

export type ClientOperationsTodoWorkspaceQuery = {
  workspace_scope?: string | null;
  workspace_subject_user_id?: string | null;
};

function appendWs(sp: URLSearchParams, ws?: ClientOperationsTodoWorkspaceQuery | null): void {
  const scope = String(ws?.workspace_scope ?? '').trim();
  const subject = String(ws?.workspace_subject_user_id ?? '').trim();
  if (scope) sp.set('workspace_scope', scope);
  if (subject) sp.set('workspace_subject_user_id', subject);
}

export function moduleClientOperationsTodoBoard(params?: ClientOperationsTodoWorkspaceQuery & {
  page?: number | null;
  q?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params?.page && params.page > 1) sp.set('page', String(params.page));
  if (params?.q?.trim()) sp.set('q', params.q.trim());
  appendWs(sp, params);
  const qs = sp.toString();
  return qs ? `/m/client-operations/todo/board?${qs}` : '/m/client-operations/todo/board';
}

export function moduleClientOperationsTodoArchive(params?: ClientOperationsTodoWorkspaceQuery & {
  page?: number | null;
  q?: string | null;
  filter_priority?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params?.page && params.page > 1) sp.set('page', String(params.page));
  if (params?.q?.trim()) sp.set('q', params.q.trim());
  if (params?.filter_priority?.trim()) sp.set('filter_priority', params.filter_priority.trim());
  appendWs(sp, params);
  const qs = sp.toString();
  return qs ? `/m/client-operations/todo/archive?${qs}` : '/m/client-operations/todo/archive';
}

export function moduleClientOperationsTodoClientOptions(params?: ClientOperationsTodoWorkspaceQuery & {
  q?: string | null;
  limit?: number | null;
}): string {
  const sp = new URLSearchParams();
  if (params?.q?.trim()) sp.set('q', params.q.trim());
  if (params?.limit) sp.set('limit', String(params.limit));
  appendWs(sp, params);
  const qs = sp.toString();
  return qs
    ? `/m/client-operations/todo/client-options?${qs}`
    : '/m/client-operations/todo/client-options';
}

export function moduleClientOperationsTodoCommands(): string {
  return '/m/client-operations/todo/commands';
}
