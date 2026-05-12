/**
 * Work Engine event intake (Stage 2 foundation).
 * Source of truth: docs/work-engine-event-contract.md.
 *
 * Stage 2 scope (per task spec):
 *   - validate envelope shape;
 *   - enforce org_id / client_id tenancy;
 *   - enforce idempotency by (org_id, event_id) AND (org_id, source_module, idempotency_key);
 *   - store every accepted/duplicate/failed event in work_events;
 *   - DO NOT auto-create work_items here. Routing/dedup logic lands in Stage 3.
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import {
  ACTOR_TYPES,
  type EventProcessingStatus,
  type WorkEventEnvelope,
  type WorkEventIntakeResult,
} from './work-engine.types.js';
import { PERIOD_KEY_REGEX, isUuid } from './work-engine.guards.js';

function validateEnvelope(env: WorkEventEnvelope): void {
  if (!env || typeof env !== 'object') throw badRequest('event envelope is required');
  if (!env.event_id || !isUuid(env.event_id)) {
    throw badRequest('event_id must be a uuid');
  }
  if (!env.org_id || !isUuid(env.org_id)) {
    throw badRequest('org_id must be a uuid');
  }
  if (env.client_id !== null && !isUuid(String(env.client_id))) {
    throw badRequest('client_id must be a uuid or null');
  }
  if (!env.source_module || !String(env.source_module).trim()) {
    throw badRequest('source_module is required');
  }
  if (!env.source_entity_type || !String(env.source_entity_type).trim()) {
    throw badRequest('source_entity_type is required');
  }
  if (!env.source_entity_id || !String(env.source_entity_id).trim()) {
    throw badRequest('source_entity_id is required');
  }
  if (!env.event_type || !String(env.event_type).trim()) {
    throw badRequest('event_type is required');
  }
  if (!env.occurred_at || !Number.isFinite(new Date(env.occurred_at).getTime())) {
    throw badRequest('occurred_at must be an ISO datetime');
  }
  if (!(ACTOR_TYPES as readonly string[]).includes(env.emitted_by_type)) {
    throw badRequest('emitted_by_type must be user|system|rule');
  }
  if (env.emitted_by_id !== null && !isUuid(String(env.emitted_by_id))) {
    throw badRequest('emitted_by_id must be a uuid or null');
  }
  if (
    typeof env.schema_version !== 'number' ||
    !Number.isInteger(env.schema_version) ||
    env.schema_version < 1
  ) {
    throw badRequest('schema_version must be an integer >= 1');
  }
  if (!env.idempotency_key || !String(env.idempotency_key).trim()) {
    throw badRequest('idempotency_key is required');
  }
  if (env.period_key !== null) {
    const pk = String(env.period_key).trim();
    if (pk && !PERIOD_KEY_REGEX.test(pk)) {
      throw badRequest(
        `period_key must match ${PERIOD_KEY_REGEX.source} (see docs/work-engine-dedup-policy.md §8)`,
      );
    }
  }
}

async function findExistingEvent(
  orgId: string,
  eventId: string,
  sourceModule: string,
  idempotencyKey: string,
): Promise<string | null> {
  const byEvent = await supabaseAdmin
    .from('work_events')
    .select('id')
    .eq('org_id', orgId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (byEvent.error) throw byEvent.error;
  if (byEvent.data) return String((byEvent.data as { id: string }).id);

  const byIdem = await supabaseAdmin
    .from('work_events')
    .select('id')
    .eq('org_id', orgId)
    .eq('source_module', sourceModule)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (byIdem.error) throw byIdem.error;
  return byIdem.data ? String((byIdem.data as { id: string }).id) : null;
}

/**
 * Accept a cross-module event envelope.
 *
 * Returns one of:
 *   - `accepted`  — new row written with `processing_status='accepted'`;
 *   - `duplicate` — same `(org_id, event_id)` or `(org_id, source_module, idempotency_key)` already exists;
 *   - `rejected`  — domain-level failure (tenant mismatch, client not found). A `failed` row is still written.
 *
 * Envelope-level validation failures throw `badRequest` and do NOT persist anything.
 */
export async function acceptWorkEngineEvent(
  env: WorkEventEnvelope,
): Promise<WorkEventIntakeResult> {
  validateEnvelope(env);

  const existing = await findExistingEvent(
    env.org_id,
    env.event_id,
    env.source_module,
    env.idempotency_key,
  );
  if (existing) {
    return {
      result: 'duplicate',
      work_event_id: existing,
      processing_status: 'ignored_duplicate',
      processing_outcome: 'ignored_duplicate',
      processing_error: null,
    };
  }

  let processingStatus: EventProcessingStatus = 'accepted';
  let processingOutcome = 'accepted_pending_routing';
  let processingError: string | null = null;

  if (env.client_id) {
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id, organization_id')
      .eq('id', env.client_id)
      .maybeSingle();
    if (error) throw error;
    if (!client) {
      processingStatus = 'failed';
      processingOutcome = 'client_not_found';
      processingError = `client ${env.client_id} not found`;
    } else if (
      (client as { organization_id: string }).organization_id !== env.org_id
    ) {
      processingStatus = 'failed';
      processingOutcome = 'tenant_mismatch';
      processingError = 'client.organization_id does not match envelope org_id';
    }
  }

  // Stage 2: per task spec, do NOT auto-create work_items.
  // Persist envelope for audit; Stage 3 will add the routing/dedup consumer.
  const insertResp = await supabaseAdmin
    .from('work_events')
    .insert({
      event_id: env.event_id,
      org_id: env.org_id,
      direction: 'inbound',
      source_module: env.source_module,
      source_entity_type: env.source_entity_type,
      source_entity_id: env.source_entity_id,
      event_type: env.event_type,
      client_id: env.client_id,
      period_key: env.period_key,
      work_item_id: null,
      occurred_at: env.occurred_at,
      emitted_by_type: env.emitted_by_type,
      emitted_by_id: env.emitted_by_id,
      schema_version: env.schema_version,
      idempotency_key: env.idempotency_key,
      payload:
        env.payload && typeof env.payload === 'object' && !Array.isArray(env.payload)
          ? env.payload
          : {},
      processing_status: processingStatus,
      processing_outcome: processingOutcome,
      processing_error: processingError,
    })
    .select('id')
    .single();
  if (insertResp.error) {
    const code = (insertResp.error as { code?: string }).code;
    if (code === '23505') {
      const again = await findExistingEvent(
        env.org_id,
        env.event_id,
        env.source_module,
        env.idempotency_key,
      );
      return {
        result: 'duplicate',
        work_event_id: again,
        processing_status: 'ignored_duplicate',
        processing_outcome: 'ignored_duplicate',
        processing_error: null,
      };
    }
    throw insertResp.error;
  }

  const id = String((insertResp.data as { id: string | number }).id);

  if (processingStatus === 'failed') {
    return {
      result: 'rejected',
      work_event_id: id,
      processing_status: 'failed',
      processing_outcome: processingOutcome,
      processing_error: processingError,
    };
  }
  return {
    result: 'accepted',
    work_event_id: id,
    processing_status: 'accepted',
    processing_outcome: processingOutcome,
    processing_error: null,
  };
}
