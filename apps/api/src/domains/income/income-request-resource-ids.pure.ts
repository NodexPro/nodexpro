/**
 * Stage 5.5 — direct-id attack surface for Income requests (pure).
 *
 * Income routes/commands accept resource ids (draft, issued document, customer, work item) that
 * resolve to a represented client LATER inside the service. A guessed id must never bypass the
 * Stage 5.1 client ACL, so the router resolves every id found in query/body/payload to its
 * represented client BEFORE the handler runs.
 */

export type IncomeRequestIds = {
  client_ids: string[];
  draft_ids: string[];
  income_document_ids: string[];
  income_customer_ids: string[];
  work_item_ids: string[];
  /** Work Engine reminder candidates resolve to a client through their work item. */
  reminder_candidate_ids: string[];
};

function add(set: Set<string>, v: unknown): void {
  if (typeof v !== 'string') return;
  const t = v.trim();
  if (t) set.add(t);
}

export function collectIncomeRequestIds(input: {
  path?: string | null;
  query?: Record<string, unknown> | null;
  body?: Record<string, unknown> | null;
}): IncomeRequestIds {
  const clients = new Set<string>();
  const drafts = new Set<string>();
  const docs = new Set<string>();
  const customers = new Set<string>();
  const workItems = new Set<string>();
  const candidates = new Set<string>();

  const scan = (src: Record<string, unknown> | null | undefined) => {
    if (!src || typeof src !== 'object') return;
    add(clients, src.client_id);
    add(clients, src.represented_client_id);
    add(drafts, src.draft_id);
    add(docs, src.income_document_id);
    add(customers, src.income_customer_id);
    add(customers, src.end_customer_id);
    add(workItems, src.work_item_id);
    add(workItems, src.linked_work_item_id);
    add(candidates, src.reminder_candidate_id);
  };

  const body = input.body ?? {};
  scan(input.query ?? null);
  scan(body);
  const payload = body.payload;
  if (payload && typeof payload === 'object') scan(payload as Record<string, unknown>);
  for (const holder of [body, payload]) {
    const review =
      holder && typeof holder === 'object' ? (holder as Record<string, unknown>).recurring_cycle_review : null;
    if (review && typeof review === 'object') scan(review as Record<string, unknown>);
  }

  const m = /^\/documents\/([^/]+)\/download\/?$/.exec(String(input.path ?? ''));
  if (m) add(docs, decodeURIComponent(m[1]!));

  return {
    client_ids: [...clients],
    draft_ids: [...drafts],
    income_document_ids: [...docs],
    income_customer_ids: [...customers],
    work_item_ids: [...workItems],
    reminder_candidate_ids: [...candidates],
  };
}

export function incomeRequestHasResourceIds(ids: IncomeRequestIds): boolean {
  return (
    ids.client_ids.length > 0 ||
    ids.draft_ids.length > 0 ||
    ids.income_document_ids.length > 0 ||
    ids.income_customer_ids.length > 0 ||
    ids.work_item_ids.length > 0 ||
    ids.reminder_candidate_ids.length > 0
  );
}
