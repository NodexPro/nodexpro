export type NestedDraftNode<T extends { id: string; parent_draft_id: string | null }> = T & {
  children: NestedDraftNode<T>[];
};

export function nestLegalTextDrafts<T extends { id: string; parent_draft_id: string | null }>(
  rows: T[],
): NestedDraftNode<T>[] {
  const ids = new Set(rows.map((row) => row.id));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parent_draft_id && ids.has(row.parent_draft_id) ? row.parent_draft_id : null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  const walk = (parentId: string | null): NestedDraftNode<T>[] =>
    (byParent.get(parentId) ?? []).map((row) => ({ ...row, children: walk(row.id) }));
  return walk(null);
}

export type NestedReviewNode<T extends { id: string; parent_id: string | null }> = T & {
  children: NestedReviewNode<T>[];
};

export function nestLegalTextReviewNodes<T extends { id: string; parent_id: string | null }>(
  rows: T[],
): NestedReviewNode<T>[] {
  const ids = new Set(rows.map((row) => row.id));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parent_id && ids.has(row.parent_id) ? row.parent_id : null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  const walk = (parentId: string | null): NestedReviewNode<T>[] =>
    (byParent.get(parentId) ?? []).map((row) => ({ ...row, children: walk(row.id) }));
  return walk(null);
}
