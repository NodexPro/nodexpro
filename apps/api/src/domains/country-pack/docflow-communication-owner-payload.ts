import { badRequest } from '../../shared/errors.js';

const DOCFLOW_COMMUNICATION_TYPE = 'docflow_communication';

export function isDocflowCommunicationOwnerPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return (raw as { type?: string }).type === DOCFLOW_COMMUNICATION_TYPE;
}

/**
 * Validates Owner Panel JSON for country_legal_value_versions.value_payload_json.
 * Kept in country-pack (no dependency on DocFlow module).
 */
export function assertValidDocflowCommunicationOwnerPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('docflow_communication payload must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (o.type !== DOCFLOW_COMMUNICATION_TYPE) {
    throw badRequest('docflow template type must be docflow_communication');
  }
  const messageTemplate = typeof o.message_template === 'string' ? o.message_template.trim() : '';
  if (!messageTemplate) throw badRequest('message_template is required');

  const messageType = o.message_type === 'system' ? 'system' : 'reminder';
  const reviewRequired = o.review_required !== false;

  let targetFilter: string | Record<string, unknown> = 'all';
  if (o.target_filter !== undefined && o.target_filter !== null) {
    if (typeof o.target_filter === 'string') targetFilter = o.target_filter;
    else if (typeof o.target_filter === 'object' && !Array.isArray(o.target_filter)) {
      targetFilter = o.target_filter as Record<string, unknown>;
    } else throw badRequest('target_filter must be string or object');
  }

  let conditionConfig: Record<string, unknown> = { require_active_obligation: true, obligation_types: [] };
  if (o.condition_config !== undefined) {
    if (typeof o.condition_config !== 'object' || o.condition_config === null || Array.isArray(o.condition_config)) {
      throw badRequest('condition_config must be an object');
    }
    conditionConfig = { ...(o.condition_config as Record<string, unknown>) };
    if (conditionConfig.obligation_types !== undefined && !Array.isArray(conditionConfig.obligation_types)) {
      throw badRequest('condition_config.obligation_types must be an array');
    }
  }

  let scheduleConfig: Record<string, unknown> = { kind: 'manual', hint: '' };
  if (o.schedule_config !== undefined) {
    if (typeof o.schedule_config !== 'object' || o.schedule_config === null || Array.isArray(o.schedule_config)) {
      throw badRequest('schedule_config must be an object');
    }
    scheduleConfig = { ...(o.schedule_config as Record<string, unknown>) };
  }

  return {
    type: DOCFLOW_COMMUNICATION_TYPE,
    message_template: messageTemplate,
    review_required: reviewRequired,
    target_filter: targetFilter,
    condition_config: conditionConfig,
    schedule_config: scheduleConfig,
    message_type: messageType,
  };
}

export function normalizeLegalValuePayloadJsonInput(input: unknown): unknown {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      throw badRequest('value_payload_json must be valid JSON');
    }
  }
  return input;
}

export function validateLegalValueVersionPayloadIfDocflow(valuePayloadJson: unknown): unknown {
  const normalized = normalizeLegalValuePayloadJsonInput(valuePayloadJson);
  if (normalized === null) return null;
  if (isDocflowCommunicationOwnerPayload(normalized)) {
    return assertValidDocflowCommunicationOwnerPayload(normalized);
  }
  return normalized;
}
