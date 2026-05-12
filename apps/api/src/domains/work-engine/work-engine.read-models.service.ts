/**
 * Work Engine read models (Stage 2 foundation).
 * Source of truth: docs/work-engine-aggregates.md (future doc); for now follow the
 * "ready-to-render" rules from docs/work-engine-state-machine.md §8 and the boundary doc.
 *
 * UI consumes aggregates verbatim. UI never recomputes labels, counts, or allowed_actions.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { AllowedAction, WorkItemRow, WorkState } from './work-engine.types.js';
import { WORK_STATES } from './work-engine.types.js';
import { knownEventTypes, MAPPING_REASON } from './work-engine.event-mapping.service.js';

/**
 * Stage 3B: the set of `work_events.processing_outcome` values that signal a
 * pending-mapping outcome (the event was persisted but no work_item was
 * created). Includes the Stage 3A legacy umbrella string so historical rows
 * still count.
 */
const PENDING_MAPPING_OUTCOMES = [
  'accepted_pending_mapping',
  MAPPING_REASON.UNKNOWN_EVENT_MAPPING,
  MAPPING_REASON.MISSING_PERIOD_KEY,
] as const;

function workStateLabel(state: WorkState): string {
  switch (state) {
    case 'new':
      return 'New';
    case 'assigned':
      return 'Assigned';
    case 'waiting_human':
      return 'Waiting (Office)';
    case 'waiting_client':
      return 'Waiting Client';
    case 'client_replied':
      return 'Client Replied';
    case 'review_pending':
      return 'Review Pending';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'overdue':
      return 'Overdue';
    case 'escalated':
      return 'Escalated';
    case 'done':
      return 'Done';
    case 'archived':
      return 'Archived';
    default:
      return state;
  }
}

function slaStatusLabel(s: string): string {
  switch (s) {
    case 'none':
      return 'No SLA';
    case 'on_track':
      return 'On track';
    case 'due_soon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue';
    case 'breached':
      return 'Breached';
    default:
      return s;
  }
}

function workItemAllowedActions(state: WorkState): AllowedAction[] {
  const archived = state === 'archived';
  return [
    {
      command: 'assign_work_item',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'change_work_state',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'set_work_deadline',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'apply_work_override',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    { command: 'append_work_event', enabled: true, reason: null },
  ];
}

type CountsScanRow = { work_state: string };

export async function buildWorkEngineFoundationAggregate(params: {
  orgId: string;
}): Promise<Record<string, unknown>> {
  const { orgId } = params;

  // Counts: bounded scan; Stage 2 has no rule worker, so cardinality is small.
  const countsResp = await supabaseAdmin
    .from('work_items')
    .select('work_state')
    .eq('org_id', orgId)
    .limit(5000);
  if (countsResp.error) throw countsResp.error;
  const countsRows = (countsResp.data ?? []) as CountsScanRow[];

  const counts: Record<string, number> = {};
  for (const s of WORK_STATES) counts[s] = 0;
  let totalActive = 0;
  for (const r of countsRows) {
    const st = r.work_state as WorkState;
    counts[st] = (counts[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') totalActive += 1;
  }
  const totalLoaded = countsRows.length;

  const recentResp = await supabaseAdmin
    .from('work_items')
    .select(
      'id, client_id, module_key, work_type, period_key, work_state, owner_user_id, assigned_user_id, reviewer_user_id, escalation_owner_id, due_at, sla_status, override_active, version, created_at, updated_at',
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(25);
  if (recentResp.error) throw recentResp.error;
  const recentItems = (recentResp.data ?? []) as Array<
    Pick<
      WorkItemRow,
      | 'id'
      | 'client_id'
      | 'module_key'
      | 'work_type'
      | 'period_key'
      | 'work_state'
      | 'owner_user_id'
      | 'assigned_user_id'
      | 'reviewer_user_id'
      | 'escalation_owner_id'
      | 'due_at'
      | 'sla_status'
      | 'override_active'
      | 'version'
      | 'created_at'
      | 'updated_at'
    >
  >;

  // Stage 3B: pending_mapping totals + recent rows. Backend-owned: the UI
  // never recomputes counts and never inspects work_events directly.
  const pendingCountResp = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[]);
  if (pendingCountResp.error) throw pendingCountResp.error;
  const pendingMappingCount = pendingCountResp.count ?? 0;

  const pendingRecentResp = await supabaseAdmin
    .from('work_events')
    .select(
      'id, event_id, event_type, source_module, source_entity_type, source_entity_id, client_id, period_key, processing_outcome, received_at, occurred_at',
    )
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[])
    .order('received_at', { ascending: false })
    .limit(25);
  if (pendingRecentResp.error) throw pendingRecentResp.error;
  type PendingRow = {
    id: string;
    event_id: string;
    event_type: string;
    source_module: string;
    source_entity_type: string;
    source_entity_id: string;
    client_id: string | null;
    period_key: string | null;
    processing_outcome: string;
    received_at: string;
    occurred_at: string;
  };
  const pendingRecentRows = (pendingRecentResp.data ?? []) as PendingRow[];

  return {
    aggregate_key: 'work_engine_foundation_aggregate',
    org_id: orgId,
    generated_at: new Date().toISOString(),
    counts: {
      by_state: counts,
      total_active: totalActive,
      total_loaded: totalLoaded,
      pending_mapping: pendingMappingCount,
    },
    pending_mapping_count: pendingMappingCount,
    recent_items: recentItems.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      module_key: r.module_key,
      work_type: r.work_type,
      period_key: r.period_key,
      work_state: r.work_state,
      work_state_label: workStateLabel(r.work_state),
      sla_status: r.sla_status,
      sla_status_label: slaStatusLabel(r.sla_status),
      due_at: r.due_at,
      owner_user_id: r.owner_user_id,
      assigned_user_id: r.assigned_user_id,
      reviewer_user_id: r.reviewer_user_id,
      escalation_owner_id: r.escalation_owner_id,
      override_active: r.override_active,
      version: r.version,
      created_at: r.created_at,
      updated_at: r.updated_at,
      allowed_actions: workItemAllowedActions(r.work_state),
    })),
    recent_pending_mappings: pendingRecentRows.map((p) => ({
      id: p.id,
      event_id: p.event_id,
      event_type: p.event_type,
      source_module: p.source_module,
      source_entity_type: p.source_entity_type,
      source_entity_id: p.source_entity_id,
      client_id: p.client_id,
      period_key: p.period_key,
      pending_reason: p.processing_outcome,
      pending_reason_label: pendingReasonLabel(p.processing_outcome),
      received_at: p.received_at,
      occurred_at: p.occurred_at,
    })),
    backend_owned_state_catalog: WORK_STATES.map((s) => ({
      value: s,
      label: workStateLabel(s),
      terminal: s === 'done' || s === 'archived',
    })),
    backend_owned_event_mapping_catalog: {
      // Static allowlist surfaced to the UI for read-only rendering (e.g.
      // "known event types"). UI must not extend or override this list.
      known_event_types: knownEventTypes(),
      pending_reasons: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },
  };
}

function pendingReasonLabel(reason: string): string {
  switch (reason) {
    case MAPPING_REASON.UNKNOWN_EVENT_MAPPING:
      return 'Unknown event type';
    case MAPPING_REASON.MISSING_PERIOD_KEY:
      return 'Missing period_key';
    case 'accepted_pending_mapping':
      return 'Pending mapping (legacy)';
    default:
      return reason;
  }
}

// ============================================================================
// Stage 3D — work_engine_queue_aggregate
// ============================================================================

const QUEUE_DEFAULT_LIMIT = 50;
const QUEUE_MAX_LIMIT = 200;

export type WorkEngineQueueFilters = {
  state?: string | null;
  module_key?: string | null;
  assigned_user_id?: string | null;
  reviewer_user_id?: string | null;
  client_id?: string | null;
  period_key?: string | null;
  limit?: number | null;
  offset?: number | null;
};

/**
 * Coerce `payload.aggregate_filters` (or any nested object) into
 * `WorkEngineQueueFilters` for Stage 3E command responses.
 */
export function coerceWorkEngineQueueFilters(v: unknown): WorkEngineQueueFilters {
  const o =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const str = (k: string): string | null => {
    const x = o[k];
    return typeof x === 'string' ? x : null;
  };
  const num = (k: string): number | null => {
    const x = o[k];
    if (x === undefined || x === null) return null;
    const n = typeof x === 'number' ? x : Number(String(x).trim());
    return Number.isFinite(n) ? n : null;
  };
  return {
    state: str('state'),
    module_key: str('module_key'),
    assigned_user_id: str('assigned_user_id'),
    reviewer_user_id: str('reviewer_user_id'),
    client_id: str('client_id'),
    period_key: str('period_key'),
    limit: num('limit'),
    offset: num('offset'),
  };
}

/**
 * Humanize a snake_case / kebab-case key into a Title Case label. Used as the
 * fallback when no explicit label is known. Backend-owned; UI never humanizes.
 */
function humanizeKey(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function moduleLabel(key: string): string {
  switch (key) {
    case 'payroll':
      return 'Payroll';
    case 'vat':
      return 'VAT';
    case 'annual_report':
      return 'Annual Report';
    case 'income_tax':
      return 'Income Tax';
    case 'national_insurance':
      return 'National Insurance';
    case 'client_obligations':
      return 'Client Obligations';
    case 'docflow':
      return 'DocFlow';
    case 'work_engine':
      return 'Work Engine';
    default:
      return humanizeKey(key);
  }
}

function workTypeLabel(key: string): string {
  switch (key) {
    case 'payroll_document_collection':
      return 'Payroll Documents';
    case 'vat_document_collection':
      return 'VAT Documents';
    case 'annual_report_document_collection':
      return 'Annual Report Documents';
    default:
      return humanizeKey(key);
  }
}

/**
 * Queue-level allowed_actions. These are SEMANTIC actions a UI can offer
 * (assign / change_state / set_deadline / apply_override / archive) and are
 * NOT the same vocabulary as low-level command names (`assign_work_item`
 * etc.). The mapping action → command lives in the routes/commands layer.
 *
 * `done` is a terminal state for normal transitions; the only path out is
 * `archive` (or `apply_override` for reopen). `archived` is fully terminal.
 */
export type QueueAllowedActionCommand =
  | 'assign'
  | 'change_state'
  | 'set_deadline'
  | 'apply_override'
  | 'archive';

export type QueueAllowedAction = {
  command: QueueAllowedActionCommand;
  enabled: boolean;
  reason: string | null;
};

/** Exported for Stage 3E command-side validation (must match queue aggregate rows). */
export function queueAllowedActions(state: WorkState): QueueAllowedAction[] {
  const archived = state === 'archived';
  const done = state === 'done';
  return [
    {
      command: 'assign',
      enabled: !archived && !done,
      reason: archived
        ? 'Work item is archived'
        : done
          ? 'Work item is done'
          : null,
    },
    {
      command: 'change_state',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'set_deadline',
      enabled: !archived && !done,
      reason: archived
        ? 'Work item is archived'
        : done
          ? 'Work item is done'
          : null,
    },
    {
      command: 'apply_override',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'archive',
      enabled: done,
      reason: done
        ? null
        : archived
          ? 'Work item is already archived'
          : 'Archive requires override unless work item is done',
    },
  ];
}

function overrideSummary(row: {
  override_active: boolean;
  override_summary_json: Record<string, unknown> | null;
}): string | null {
  if (!row.override_active) return null;
  const j = row.override_summary_json;
  if (j && typeof j === 'object') {
    const s = (j as { summary?: unknown }).summary;
    if (typeof s === 'string' && s.trim()) return s;
    const kind = (j as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind.trim()) return `Override: ${kind}`;
  }
  return 'Override active';
}

/** Parse queue filter input (HTTP query or command `aggregate_filters`). */
export function parseWorkEngineQueueFilters(raw: WorkEngineQueueFilters): {
  state: WorkState | null;
  module_key: string | null;
  assigned_user_id: string | null;
  reviewer_user_id: string | null;
  client_id: string | null;
  period_key: string | null;
  limit: number;
  offset: number;
} {
  const stateRaw = raw.state ? String(raw.state).trim() : '';
  const state =
    stateRaw && (WORK_STATES as readonly string[]).includes(stateRaw)
      ? (stateRaw as WorkState)
      : null;

  const moduleKey = raw.module_key ? String(raw.module_key).trim() : '';
  const assignedUserId = raw.assigned_user_id
    ? String(raw.assigned_user_id).trim()
    : '';
  const reviewerUserId = raw.reviewer_user_id
    ? String(raw.reviewer_user_id).trim()
    : '';
  const clientId = raw.client_id ? String(raw.client_id).trim() : '';
  const periodKey = raw.period_key ? String(raw.period_key).trim() : '';

  let limit = Number(raw.limit ?? QUEUE_DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = QUEUE_DEFAULT_LIMIT;
  if (limit > QUEUE_MAX_LIMIT) limit = QUEUE_MAX_LIMIT;
  limit = Math.floor(limit);

  let offset = Number(raw.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  return {
    state,
    module_key: moduleKey || null,
    assigned_user_id: assignedUserId || null,
    reviewer_user_id: reviewerUserId || null,
    client_id: clientId || null,
    period_key: periodKey || null,
    limit,
    offset,
  };
}

type QueueWorkItemRow = Pick<
  WorkItemRow,
  | 'id'
  | 'client_id'
  | 'module_key'
  | 'work_type'
  | 'period_key'
  | 'work_state'
  | 'assigned_user_id'
  | 'reviewer_user_id'
  | 'due_at'
  | 'sla_status'
  | 'override_active'
  | 'override_summary_json'
  | 'version'
  | 'updated_at'
>;

/**
 * Build the Stage 3D queue aggregate.
 *
 * Returns ready-to-render rows, summary cards, filter options (with labels),
 * pagination info, allowed_actions per row, and the pending-mapping section.
 * The UI consumes this verbatim. No re-derivation in the frontend.
 */
export async function buildWorkEngineQueueAggregate(params: {
  orgId: string;
  filters?: WorkEngineQueueFilters;
}): Promise<Record<string, unknown>> {
  const { orgId } = params;
  const f = parseWorkEngineQueueFilters(params.filters ?? {});

  // ---- 1. Counts for summary cards (bounded scan).
  const countsResp = await supabaseAdmin
    .from('work_items')
    .select('work_state')
    .eq('org_id', orgId)
    .limit(5000);
  if (countsResp.error) throw countsResp.error;
  const countsRows = (countsResp.data ?? []) as Array<{ work_state: string }>;
  const counts: Record<string, number> = {};
  for (const s of WORK_STATES) counts[s] = 0;
  let totalActive = 0;
  for (const r of countsRows) {
    const st = r.work_state as WorkState;
    counts[st] = (counts[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') totalActive += 1;
  }

  // Pending-mapping counts (work_events with no work_item_id).
  const pendingCountResp = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[]);
  if (pendingCountResp.error) throw pendingCountResp.error;
  const pendingMappingCount = pendingCountResp.count ?? 0;

  // ---- 2. Filter option catalogs (backend-owned).
  // Distinct values for module / assignee / reviewer / period_key come from
  // the work_items table for this org — they reflect actual data so the UI
  // never invents filter options.
  const distinctResp = await supabaseAdmin
    .from('work_items')
    .select('module_key, assigned_user_id, reviewer_user_id, period_key')
    .eq('org_id', orgId)
    .limit(5000);
  if (distinctResp.error) throw distinctResp.error;
  const distinctRows = (distinctResp.data ?? []) as Array<{
    module_key: string | null;
    assigned_user_id: string | null;
    reviewer_user_id: string | null;
    period_key: string | null;
  }>;
  const distinctModules = new Set<string>();
  const distinctAssignees = new Set<string>();
  const distinctReviewers = new Set<string>();
  const distinctPeriods = new Set<string>();
  for (const r of distinctRows) {
    if (r.module_key) distinctModules.add(r.module_key);
    if (r.assigned_user_id) distinctAssignees.add(r.assigned_user_id);
    if (r.reviewer_user_id) distinctReviewers.add(r.reviewer_user_id);
    if (r.period_key) distinctPeriods.add(r.period_key);
  }

  // ---- 3. Page query: apply filters, order by updated_at desc, paginate.
  let q = supabaseAdmin
    .from('work_items')
    .select(
      'id, client_id, module_key, work_type, period_key, work_state, assigned_user_id, reviewer_user_id, due_at, sla_status, override_active, override_summary_json, version, updated_at',
      { count: 'exact' },
    )
    .eq('org_id', orgId);
  if (f.state) q = q.eq('work_state', f.state);
  if (f.module_key) q = q.eq('module_key', f.module_key);
  if (f.assigned_user_id) q = q.eq('assigned_user_id', f.assigned_user_id);
  if (f.reviewer_user_id) q = q.eq('reviewer_user_id', f.reviewer_user_id);
  if (f.client_id) q = q.eq('client_id', f.client_id);
  if (f.period_key) q = q.eq('period_key', f.period_key);
  const pageResp = await q
    .order('updated_at', { ascending: false })
    .range(f.offset, f.offset + f.limit - 1);
  if (pageResp.error) throw pageResp.error;
  const rowsRaw = (pageResp.data ?? []) as QueueWorkItemRow[];
  const totalMatching = pageResp.count ?? rowsRaw.length;

  // ---- 4. Batch-fetch display names for client + users referenced by the page.
  const clientIds = Array.from(
    new Set(rowsRaw.map((r) => r.client_id).filter((v): v is string => !!v)),
  );
  const userIdsSet = new Set<string>();
  for (const r of rowsRaw) {
    if (r.assigned_user_id) userIdsSet.add(r.assigned_user_id);
    if (r.reviewer_user_id) userIdsSet.add(r.reviewer_user_id);
  }
  // Also include distinct assignee/reviewer ids so the filter dropdowns show
  // a name, not a UUID.
  for (const id of distinctAssignees) userIdsSet.add(id);
  for (const id of distinctReviewers) userIdsSet.add(id);
  const userIds = Array.from(userIdsSet);

  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const cResp = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', clientIds);
    if (cResp.error) throw cResp.error;
    for (const c of (cResp.data ?? []) as Array<{
      id: string;
      display_name: string | null;
    }>) {
      clientNameById.set(c.id, c.display_name ?? c.id);
    }
  }
  const userNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const uResp = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds);
    if (uResp.error) throw uResp.error;
    for (const u of (uResp.data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      userNameById.set(u.id, u.full_name?.trim() || u.email?.trim() || u.id);
    }
  }

  // ---- 5. Recent pending-mapping rows for the pending section.
  const pendingRecentResp = await supabaseAdmin
    .from('work_events')
    .select(
      'id, event_id, event_type, source_module, source_entity_type, source_entity_id, client_id, period_key, processing_outcome, received_at, occurred_at',
    )
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[])
    .order('received_at', { ascending: false })
    .limit(25);
  if (pendingRecentResp.error) throw pendingRecentResp.error;
  type PendingRow = {
    id: string;
    event_id: string;
    event_type: string;
    source_module: string;
    source_entity_type: string;
    source_entity_id: string;
    client_id: string | null;
    period_key: string | null;
    processing_outcome: string;
    received_at: string;
    occurred_at: string;
  };
  const pendingRecentRows = (pendingRecentResp.data ?? []) as PendingRow[];

  // Hydrate client names for pending rows too (may include clients not in
  // the page set).
  const pendingClientIds = Array.from(
    new Set(
      pendingRecentRows
        .map((p) => p.client_id)
        .filter((v): v is string => !!v),
    ),
  ).filter((id) => !clientNameById.has(id));
  if (pendingClientIds.length > 0) {
    const cResp = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', pendingClientIds);
    if (cResp.error) throw cResp.error;
    for (const c of (cResp.data ?? []) as Array<{
      id: string;
      display_name: string | null;
    }>) {
      clientNameById.set(c.id, c.display_name ?? c.id);
    }
  }

  // ---- 6. Compose row models.
  const rows = rowsRaw.map((r) => ({
    work_item_id: r.id,
    client_id: r.client_id,
    client_name: r.client_id ? (clientNameById.get(r.client_id) ?? null) : null,
    module_key: r.module_key,
    module_label: moduleLabel(r.module_key),
    work_type: r.work_type,
    work_type_label: workTypeLabel(r.work_type),
    period_key: r.period_key,
    work_state: r.work_state,
    work_state_label: workStateLabel(r.work_state),
    assigned_user_id: r.assigned_user_id,
    assigned_user_name: r.assigned_user_id
      ? (userNameById.get(r.assigned_user_id) ?? null)
      : null,
    reviewer_user_id: r.reviewer_user_id,
    reviewer_user_name: r.reviewer_user_id
      ? (userNameById.get(r.reviewer_user_id) ?? null)
      : null,
    due_at: r.due_at,
    sla_status: r.sla_status,
    sla_status_label: slaStatusLabel(r.sla_status),
    override_active: r.override_active,
    override_summary: overrideSummary({
      override_active: r.override_active,
      override_summary_json: r.override_summary_json,
    }),
    allowed_actions: queueAllowedActions(r.work_state),
    version: r.version,
    updated_at: r.updated_at,
  }));

  // ---- 7. Compose response.
  return {
    aggregate_key: 'work_engine_queue_aggregate',
    org_id: orgId,
    generated_at: new Date().toISOString(),

    summary_cards: {
      total_active: totalActive,
      waiting_client: counts.waiting_client ?? 0,
      waiting_human: counts.waiting_human ?? 0,
      review_pending: counts.review_pending ?? 0,
      overdue: counts.overdue ?? 0,
      escalated: counts.escalated ?? 0,
      pending_mapping: pendingMappingCount,
    },

    filters: {
      states: WORK_STATES.map((s) => ({
        value: s,
        label: workStateLabel(s),
        terminal: s === 'done' || s === 'archived',
      })),
      modules: Array.from(distinctModules)
        .sort()
        .map((m) => ({ value: m, label: moduleLabel(m) })),
      assignees: Array.from(distinctAssignees)
        .sort()
        .map((id) => ({
          value: id,
          label: userNameById.get(id) ?? id,
        })),
      reviewers: Array.from(distinctReviewers)
        .sort()
        .map((id) => ({
          value: id,
          label: userNameById.get(id) ?? id,
        })),
      period_keys: Array.from(distinctPeriods)
        .sort()
        .reverse() // newest periods first
        .map((p) => ({ value: p, label: p })),
      pending_mapping_reasons: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },

    applied_filters: {
      state: f.state,
      module_key: f.module_key,
      assigned_user_id: f.assigned_user_id,
      reviewer_user_id: f.reviewer_user_id,
      client_id: f.client_id,
      period_key: f.period_key,
    },

    pagination: {
      limit: f.limit,
      offset: f.offset,
      total_matching: totalMatching,
      returned: rows.length,
    },

    rows,

    pending_mapping_section: {
      pending_mapping_count: pendingMappingCount,
      recent_pending_mappings: pendingRecentRows.map((p) => ({
        id: p.id,
        event_id: p.event_id,
        event_type: p.event_type,
        source_module: p.source_module,
        source_module_label: moduleLabel(p.source_module),
        source_entity_type: p.source_entity_type,
        source_entity_id: p.source_entity_id,
        client_id: p.client_id,
        client_name: p.client_id
          ? (clientNameById.get(p.client_id) ?? null)
          : null,
        period_key: p.period_key,
        pending_reason: p.processing_outcome,
        pending_reason_label: pendingReasonLabel(p.processing_outcome),
        received_at: p.received_at,
        occurred_at: p.occurred_at,
      })),
      reason_catalog: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },
  };
}
