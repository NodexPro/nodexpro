/**
 * Append Stage 4 workspace query params to a CO registry URL.
 * Kept outside endpoints.ts (unrelated OWNER WIP must stay untouched).
 */

export type ClientOperationsWorkspaceQuery = {
  workspace_scope?: string | null;
  workspace_subject_user_id?: string | null;
};

export function appendClientOperationsWorkspaceQuery(
  url: string,
  workspace?: ClientOperationsWorkspaceQuery | null,
): string {
  const scope = String(workspace?.workspace_scope ?? '').trim();
  const subject = String(workspace?.workspace_subject_user_id ?? '').trim();
  if (!scope && !subject) return url;

  const [path, existingQs = ''] = url.split('?', 2);
  const sp = new URLSearchParams(existingQs);
  if (scope) sp.set('workspace_scope', scope);
  else sp.delete('workspace_scope');
  if (subject) sp.set('workspace_subject_user_id', subject);
  else sp.delete('workspace_subject_user_id');
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Stable option value for selector (not business truth). */
export function encodeClientOperationsWorkspaceOptionValue(option: {
  scope_kind: string;
  subject_user_id?: string | null;
}): string {
  const kind = String(option.scope_kind ?? '').trim().toUpperCase();
  if (kind === 'STAFF') {
    return `STAFF:${String(option.subject_user_id ?? '').trim()}`;
  }
  return kind === 'MY' ? 'MY' : 'OFFICE';
}

export function decodeClientOperationsWorkspaceOptionValue(raw: string): {
  workspace_scope: 'office' | 'my' | 'staff';
  workspace_subject_user_id: string | null;
} {
  const v = String(raw ?? '').trim();
  if (v === 'MY') return { workspace_scope: 'my', workspace_subject_user_id: null };
  if (v.startsWith('STAFF:')) {
    return {
      workspace_scope: 'staff',
      workspace_subject_user_id: v.slice('STAFF:'.length).trim() || null,
    };
  }
  return { workspace_scope: 'office', workspace_subject_user_id: null };
}
