/**
 * Work Engine work-type policies (Stage 10). Defaults when no DB row exists.
 */

import { supabaseAdmin } from '../../db/client.js';

export type ReviewGate = 'none' | 'required' | 'allowed';

export type WorkTypeWorkflowPolicy = {
  allow_staff_pickup_unassigned: boolean;
  review_gate: ReviewGate;
};

export type WorkTypeSlaPolicy = {
  response_sla_minutes: number;
  review_sla_minutes: number;
  waiting_client_timeout_minutes: number;
  due_soon_threshold_minutes: number;
};

export type WorkTypeEnginePolicy = WorkTypeWorkflowPolicy & WorkTypeSlaPolicy;

const DEFAULT_WORKFLOW: WorkTypeWorkflowPolicy = {
  allow_staff_pickup_unassigned: true,
  review_gate: 'allowed',
};

/** Operational SLA defaults (minutes) — not legal/regulatory deadlines. */
export const DEFAULT_SLA_POLICY: WorkTypeSlaPolicy = {
  response_sla_minutes: 240,
  review_sla_minutes: 2880,
  waiting_client_timeout_minutes: 10080,
  due_soon_threshold_minutes: 60,
};

const DEFAULT_POLICY: WorkTypeEnginePolicy = {
  ...DEFAULT_WORKFLOW,
  ...DEFAULT_SLA_POLICY,
};

function coerceReviewGate(raw: unknown): ReviewGate {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'none' || s === 'required' || s === 'allowed') return s;
  return 'allowed';
}

function coercePositiveMinutes(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallback;
}

function rowToEnginePolicy(r: {
  allow_staff_pickup_unassigned: boolean | null;
  review_gate?: string | null;
  response_sla_minutes?: number | null;
  review_sla_minutes?: number | null;
  waiting_client_timeout_minutes?: number | null;
  due_soon_threshold_minutes?: number | null;
}): WorkTypeEnginePolicy {
  return {
    allow_staff_pickup_unassigned: r.allow_staff_pickup_unassigned !== false,
    review_gate: coerceReviewGate(r.review_gate),
    response_sla_minutes: coercePositiveMinutes(
      r.response_sla_minutes,
      DEFAULT_SLA_POLICY.response_sla_minutes,
    ),
    review_sla_minutes: coercePositiveMinutes(
      r.review_sla_minutes,
      DEFAULT_SLA_POLICY.review_sla_minutes,
    ),
    waiting_client_timeout_minutes: coercePositiveMinutes(
      r.waiting_client_timeout_minutes,
      DEFAULT_SLA_POLICY.waiting_client_timeout_minutes,
    ),
    due_soon_threshold_minutes: coercePositiveMinutes(
      r.due_soon_threshold_minutes,
      DEFAULT_SLA_POLICY.due_soon_threshold_minutes,
    ),
  };
}

export async function resolveWorkTypeWorkflowPolicy(
  orgId: string,
  workType: string,
): Promise<WorkTypeWorkflowPolicy> {
  const full = await resolveWorkTypeEnginePolicy(orgId, workType);
  return {
    allow_staff_pickup_unassigned: full.allow_staff_pickup_unassigned,
    review_gate: full.review_gate,
  };
}

export async function resolveWorkTypeSlaPolicy(
  orgId: string,
  workType: string,
): Promise<WorkTypeSlaPolicy> {
  const full = await resolveWorkTypeEnginePolicy(orgId, workType);
  return {
    response_sla_minutes: full.response_sla_minutes,
    review_sla_minutes: full.review_sla_minutes,
    waiting_client_timeout_minutes: full.waiting_client_timeout_minutes,
    due_soon_threshold_minutes: full.due_soon_threshold_minutes,
  };
}

export async function resolveWorkTypeEnginePolicy(
  orgId: string,
  workType: string,
): Promise<WorkTypeEnginePolicy> {
  const map = await resolveWorkTypePoliciesBatch(orgId, [workType]);
  return map.get(workType) ?? DEFAULT_POLICY;
}

/** Batch-load policies for queue row projection (one query per aggregate build). */
export async function resolveWorkTypePoliciesBatch(
  orgId: string,
  workTypes: string[],
): Promise<Map<string, WorkTypeEnginePolicy>> {
  const map = new Map<string, WorkTypeEnginePolicy>();
  const uniq = [...new Set(workTypes.filter(Boolean))];
  for (const wt of uniq) map.set(wt, DEFAULT_POLICY);
  if (uniq.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('work_engine_work_type_policies')
    .select(
      'work_type, allow_staff_pickup_unassigned, review_gate, response_sla_minutes, review_sla_minutes, waiting_client_timeout_minutes, due_soon_threshold_minutes',
    )
    .eq('org_id', orgId)
    .in('work_type', uniq);
  if (error) throw error;
  for (const row of data ?? []) {
    const r = row as {
      work_type: string;
      allow_staff_pickup_unassigned: boolean | null;
      review_gate?: string | null;
      response_sla_minutes?: number | null;
      review_sla_minutes?: number | null;
      waiting_client_timeout_minutes?: number | null;
      due_soon_threshold_minutes?: number | null;
    };
    map.set(r.work_type, rowToEnginePolicy(r));
  }
  return map;
}

export function canStaffPickUpUnassigned(
  policy: WorkTypeWorkflowPolicy,
  roleCode: string,
): boolean {
  if (roleCode === 'owner' || roleCode === 'admin') return true;
  if (roleCode === 'staff' || roleCode === 'senior') return policy.allow_staff_pickup_unassigned;
  return false;
}
