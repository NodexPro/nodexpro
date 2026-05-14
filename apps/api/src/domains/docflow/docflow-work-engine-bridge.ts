/**
 * Stage 5 — DocFlow → Work Engine bridge.
 *
 * Emits `docflow.thread_needs_attention` through `intakeWorkEvent` only (no direct
 * work_items / work_events writes). DocFlow tables remain the communication truth;
 * Work Engine owns projected workflow rows.
 *
 * STRICT:
 *   - Never throws into DocFlow command handlers (additive only).
 *   - No financial truth, no legal/country period semantics. `period_key` is a
 *     synthetic workflow bucket `docflow:thread:<thread_id>` (see dedup policy),
 *     not a reporting period.
 *   - `event_type` must stay allowlisted in `work-engine.event-mapping.service.ts`.
 */

import type { RequestContext } from '../../shared/context.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
import type { IntakeWorkEventMeta } from '../work-engine/work-engine.types.js';

const SOURCE_MODULE = 'docflow';
const SOURCE_ENTITY_TYPE = 'client_message_thread';
const EVENT_TYPE = 'docflow.thread_needs_attention';
const SCHEMA_VERSION = 1;

/** Synthetic period bucket per thread — satisfies work_items.period_key NOT NULL + regex. */
export function docflowThreadWorkPeriodKey(threadId: string): string {
  return `docflow:thread:${threadId}`;
}

export type DocflowThreadNeedsAttentionSignal = {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  threadId: string;
  threadStatus: string;
  threadType: string;
  moduleKey?: string | null;
};

function buildDocflowThreadNeedsAttentionIntakePayload(signal: DocflowThreadNeedsAttentionSignal): Record<string, unknown> {
  const periodKey = docflowThreadWorkPeriodKey(signal.threadId);
  return {
    org_id: signal.orgId,
    client_id: signal.clientId,
    source_module: SOURCE_MODULE,
    source_entity_type: SOURCE_ENTITY_TYPE,
    source_entity_id: signal.threadId,
    event_type: EVENT_TYPE,
    period_key: periodKey,
    occurred_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    emitted_by_type: 'system',
    emitted_by_id: null,
    payload: {
      thread_id: signal.threadId,
      thread_status: signal.threadStatus,
      thread_type: signal.threadType,
      ...(signal.moduleKey ? { module_key: signal.moduleKey } : {}),
    },
  };
}

/**
 * Same intake envelope as `emitDocflowThreadNeedsAttention`, but returns intake outcome
 * (used by Stage 6 backfill for metrics). Does not log on failure — caller decides.
 */
export async function emitDocflowThreadNeedsAttentionWithIntakeResult(
  signal: DocflowThreadNeedsAttentionSignal,
): Promise<{ ok: true; intake: IntakeWorkEventMeta } | { ok: false; error: string }> {
  const body = buildDocflowThreadNeedsAttentionIntakePayload(signal);
  try {
    const intake = await intakeWorkEvent(signal.ctx, body);
    return { ok: true, intake };
  } catch (err) {
    return {
      ok: false,
      error: (err as { message?: string })?.message ?? String(err),
    };
  }
}

/**
 * Fire-and-forget intake for a DocFlow thread that should surface on the Work Engine queue.
 * Idempotent at the Work Engine layer (stable dedup tuple + active work_item reuse).
 */
export async function emitDocflowThreadNeedsAttention(signal: DocflowThreadNeedsAttentionSignal): Promise<void> {
  const r = await emitDocflowThreadNeedsAttentionWithIntakeResult(signal);
  if (r.ok) return;
  // eslint-disable-next-line no-console
  console.warn('[docflow → work_engine] intake failed for docflow.thread_needs_attention', {
    org_id: signal.orgId,
    client_id: signal.clientId,
    thread_id: signal.threadId,
    error: r.error,
  });
}
