import { createHash } from 'node:crypto';
import { badRequest } from '../../shared/errors.js';
import { isPinnedAiModel } from '../../shared/ai-gateway/ai-gateway.config.js';
import {
  getAiAdapterRegistryEntry,
  isRegisteredAiAdapterType,
} from '../../shared/ai-gateway/ai-gateway.adapters.js';
import {
  aiGatewayBaseUrlSafeDisplay,
  assertSafeAiGatewayBaseUrl,
} from '../../shared/ai-gateway/ai-gateway.endpoint-policy.js';
import {
  AI_GATEWAY_MAX_ROUTING_LENGTH,
  type AiGatewayControlPlaneProviderRow,
  type AiGatewayProviderHealthStatus,
  type AiGatewayRoutingRow,
  type OwnerAiGatewayProviderCard,
} from './ai-gateway-control-plane.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CREATE_AI_PROVIDER_FORBIDDEN_FIELDS = [
  'credential',
  'api_key',
  'credential_ciphertext',
  'enabled',
  'routing',
  'provider_ids',
  'prompt',
  'structured_output_certified',
  'compatibility_status',
] as const;

export function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

export function asRequiredName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) throw badRequest(`${field} is too long`);
  return trimmed;
}

export function asOptionalPinnedModel(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('pinned_model is invalid');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isPinnedAiModel(trimmed)) {
    throw badRequest('pinned_model must be an explicit pinned id, not latest/current/default', 'AI_MODEL_NOT_PINNED');
  }
  return trimmed;
}

export function digestAiProviderTestConfiguration(input: {
  adapter_type: string;
  base_url: string | null;
  pinned_model: string | null;
  credential_updated_at: string | null;
}): string {
  const payload = JSON.stringify({
    adapter_type: input.adapter_type,
    base_url: input.base_url,
    pinned_model: input.pinned_model,
    credential_updated_at: input.credential_updated_at,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function credentialConfigured(row: Pick<AiGatewayControlPlaneProviderRow, 'credential_configured'>): boolean {
  return Boolean(row.credential_configured);
}

export type EnablementDecision = { ok: true } | { ok: false; reason: string; code: string };

export function evaluateAiProviderEnablement(row: AiGatewayControlPlaneProviderRow): EnablementDecision {
  const adapter = getAiAdapterRegistryEntry(row.adapter_type);
  if (!adapter) {
    return { ok: false, reason: 'Adapter required. This protocol is not registered.', code: 'AI_ADAPTER_REQUIRED' };
  }
  if (!credentialConfigured(row)) {
    return { ok: false, reason: 'Credential is not configured.', code: 'AI_CREDENTIAL_REQUIRED' };
  }
  if (!row.pinned_model || !isPinnedAiModel(row.pinned_model)) {
    return { ok: false, reason: 'A pinned model is required.', code: 'AI_MODEL_NOT_PINNED' };
  }
  if (row.base_url) {
    if (!adapter.supports_custom_base_url) {
      return { ok: false, reason: 'This adapter does not allow a custom endpoint.', code: 'AI_ENDPOINT_NOT_SUPPORTED' };
    }
    try {
      assertSafeAiGatewayBaseUrl(row.base_url);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Endpoint is not allowed.',
        code: 'AI_ENDPOINT_BLOCKED',
      };
    }
  }
  if (row.compatibility_status !== 'compatible' || row.structured_output_certified !== true) {
    return {
      ok: false,
      reason: 'Connection test has not certified the current configuration.',
      code: 'AI_TEST_REQUIRED',
    };
  }
  if (row.last_test_outcome !== 'passed' || !row.last_test_configuration_digest) {
    return {
      ok: false,
      reason: 'Connection test has not passed for the current configuration.',
      code: 'AI_TEST_REQUIRED',
    };
  }
  const currentDigest = digestAiProviderTestConfiguration({
    adapter_type: row.adapter_type,
    base_url: row.base_url,
    pinned_model: row.pinned_model,
    credential_updated_at: row.credential_updated_at,
  });
  if (row.last_test_configuration_digest !== currentDigest) {
    return {
      ok: false,
      reason: 'The last successful test does not match the current configuration.',
      code: 'AI_TEST_STALE',
    };
  }
  return { ok: true };
}

export function routingRole(position: number | null): string {
  if (position == null) return 'Not routed';
  if (position === 1) return 'Primary';
  return `Fallback ${position - 1}`;
}

export function deriveAiProviderHealth(
  row: AiGatewayControlPlaneProviderRow,
): { status: AiGatewayProviderHealthStatus; reason: string } {
  const adapter = getAiAdapterRegistryEntry(row.adapter_type);
  if (!adapter) {
    return { status: 'incompatible', reason: 'Adapter required. This protocol is not registered.' };
  }
  if (!credentialConfigured(row) || !row.pinned_model) {
    return { status: 'not_configured', reason: 'Credential or pinned model is missing.' };
  }
  if (row.compatibility_status === 'stale') {
    return { status: 'incompatible', reason: 'Configuration changed. Previous test is no longer valid.' };
  }
  if (row.compatibility_status === 'incompatible') {
    return { status: 'incompatible', reason: 'Structured output compatibility failed.' };
  }
  if (!row.enabled) {
    return { status: 'disabled', reason: 'Provider is disabled.' };
  }
  const enablement = evaluateAiProviderEnablement(row);
  if (!enablement.ok) {
    return { status: 'unavailable', reason: enablement.reason };
  }
  if (row.last_failure_at && (!row.last_success_at || row.last_failure_at > row.last_success_at)) {
    if (row.last_failure_category === 'timeout' || row.last_failure_category === 'rate_limited') {
      return { status: 'degraded', reason: humanFailure(row.last_failure_category) };
    }
    if (row.last_failure_category === 'provider_unavailable' || row.last_failure_category === 'auth_rejected') {
      return { status: 'unavailable', reason: humanFailure(row.last_failure_category) };
    }
  }
  return { status: 'healthy', reason: 'Ready for routing after a successful connection test.' };
}

export function humanFailure(category: string | null): string {
  switch (category) {
    case 'timeout':
      return 'The last check timed out.';
    case 'rate_limited':
      return 'The provider rate-limited the last check.';
    case 'provider_unavailable':
      return 'The provider was unavailable.';
    case 'auth_rejected':
      return 'The API key was rejected.';
    case 'malformed_output':
      return 'The provider returned malformed output.';
    case 'structured_output_invalid':
      return 'Structured output is not compatible.';
    case 'endpoint_blocked':
      return 'The endpoint is not allowed.';
    default:
      return 'The last check failed.';
  }
}

export function connectionTestSummary(row: Pick<
  AiGatewayControlPlaneProviderRow,
  'last_test_at' | 'last_test_outcome' | 'last_success_at' | 'last_failure_at' | 'last_failure_category'
>): string {
  if (!row.last_test_at) return 'Not tested yet.';
  const successNewer =
    row.last_test_outcome === 'passed' &&
    Boolean(row.last_success_at) &&
    (!row.last_failure_at || (row.last_success_at as string) >= row.last_failure_at);
  if (successNewer) return 'Tested successfully';
  return `Test failed: ${humanFailure(row.last_failure_category)}`;
}

export function toProviderCard(
  row: AiGatewayControlPlaneProviderRow,
  routingByProvider: Map<string, number>,
): OwnerAiGatewayProviderCard {
  const adapter = getAiAdapterRegistryEntry(row.adapter_type);
  const position = routingByProvider.get(row.id) ?? null;
  const health = deriveAiProviderHealth(row);
  const enablement = evaluateAiProviderEnablement(row);
  return {
    id: row.id,
    display_name: row.display_name,
    adapter_type: row.adapter_type,
    adapter_label: adapter?.label ?? 'Adapter required',
    role: routingRole(position),
    routing_position: position,
    base_url_display: row.base_url ? aiGatewayBaseUrlSafeDisplay(row.base_url) : null,
    enabled: row.enabled,
    pinned_model: row.pinned_model,
    credential_configured: credentialConfigured(row),
    credential_updated_at: row.credential_updated_at,
    structured_output_certified: row.structured_output_certified,
    compatibility_status: row.compatibility_status,
    health_status: health.status,
    health_reason: health.reason,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    last_failure_category: row.last_failure_category,
    last_test_at: row.last_test_at,
    last_test_outcome: row.last_test_outcome,
    connection_test_summary: connectionTestSummary(row),
    eligible_for_routing: row.enabled && enablement.ok,
    can_enable: !row.enabled && enablement.ok,
  };
}

export function deriveOverallGatewayStatus(cards: OwnerAiGatewayProviderCard[]): {
  status: AiGatewayProviderHealthStatus;
  reason: string;
} {
  if (!cards.length) {
    return { status: 'not_configured', reason: 'No Owner-managed AI providers yet.' };
  }
  const routed = cards
    .filter((card) => card.routing_position != null)
    .sort((a, b) => (a.routing_position ?? 99) - (b.routing_position ?? 99));
  if (!routed.length) {
    return {
      status: 'not_configured',
      reason: 'No routing target. Enable a certified provider, then set routing.',
    };
  }
  const primary = routed[0];
  if (!primary.eligible_for_routing) {
    return { status: 'unavailable', reason: primary.health_reason };
  }
  return { status: primary.health_status, reason: primary.health_reason };
}

export function parseCreateAiProviderPayload(payload: Record<string, unknown>): {
  adapter_type: string;
  display_name: string;
  base_url: string | null;
  pinned_model: string | null;
} {
  for (const field of CREATE_AI_PROVIDER_FORBIDDEN_FIELDS) {
    if (field in payload && payload[field] !== undefined) {
      throw badRequest(`${field} cannot be supplied on create_ai_provider`);
    }
  }
  const adapterType = asRequiredName(payload.adapter_type, 'adapter_type');
  if (!isRegisteredAiAdapterType(adapterType)) {
    throw badRequest('Adapter required. This protocol is not registered.', 'AI_ADAPTER_REQUIRED');
  }
  const adapter = getAiAdapterRegistryEntry(adapterType)!;
  const displayName = asRequiredName(payload.display_name, 'display_name');
  const pinnedModel = asOptionalPinnedModel(payload.pinned_model);
  let baseUrl: string | null = null;
  if (payload.base_url !== undefined && payload.base_url !== null && payload.base_url !== '') {
    if (!adapter.supports_custom_base_url) {
      throw badRequest('This adapter does not allow a custom endpoint.', 'AI_ENDPOINT_NOT_SUPPORTED');
    }
    baseUrl = assertSafeAiGatewayBaseUrl(String(payload.base_url));
  }
  return {
    adapter_type: adapterType,
    display_name: displayName,
    base_url: baseUrl,
    pinned_model: pinnedModel,
  };
}

export function parseUpdateAiProviderPayload(payload: Record<string, unknown>): {
  ai_provider_id: string;
  display_name?: string;
  pinned_model?: string | null;
  base_url?: string | null;
} {
  if ('credential' in payload || 'api_key' in payload || 'credential_ciphertext' in payload) {
    throw badRequest('Use set_ai_provider_credential to change credentials');
  }
  if ('adapter_type' in payload && payload.adapter_type !== undefined) {
    throw badRequest('adapter_type cannot be changed after create');
  }
  if ('enabled' in payload && payload.enabled !== undefined) {
    throw badRequest('Use enable_ai_provider or disable_ai_provider');
  }
  const id = asUuid(payload.ai_provider_id ?? payload.provider_id, 'ai_provider_id');
  const out: {
    ai_provider_id: string;
    display_name?: string;
    pinned_model?: string | null;
    base_url?: string | null;
  } = { ai_provider_id: id };
  if ('display_name' in payload) out.display_name = asRequiredName(payload.display_name, 'display_name');
  if ('pinned_model' in payload) out.pinned_model = asOptionalPinnedModel(payload.pinned_model);
  if ('base_url' in payload) {
    out.base_url =
      payload.base_url === null || payload.base_url === ''
        ? null
        : assertSafeAiGatewayBaseUrl(String(payload.base_url));
  }
  if (out.display_name === undefined && out.pinned_model === undefined && out.base_url === undefined) {
    throw badRequest('No configuration fields to update');
  }
  return out;
}

export function parseCredentialPayload(payload: Record<string, unknown>): { ai_provider_id: string; credential: string } {
  const id = asUuid(payload.ai_provider_id ?? payload.provider_id, 'ai_provider_id');
  if (typeof payload.credential !== 'string' || !payload.credential.trim()) {
    throw badRequest('credential is required');
  }
  return { ai_provider_id: id, credential: payload.credential.trim() };
}

export function parseProviderIdPayload(payload: Record<string, unknown>): string {
  return asUuid(payload.ai_provider_id ?? payload.provider_id, 'ai_provider_id');
}

export function parseRoutingPayload(payload: Record<string, unknown>): string[] {
  const raw = payload.provider_ids ?? payload.ai_provider_ids;
  if (!Array.isArray(raw) || !raw.length) {
    throw badRequest('provider_ids must be a non-empty array');
  }
  if (raw.length > AI_GATEWAY_MAX_ROUTING_LENGTH) {
    throw badRequest(`Routing may include at most ${AI_GATEWAY_MAX_ROUTING_LENGTH} providers`, 'AI_ROUTING_CAP');
  }
  const ids = raw.map((value, index) => asUuid(value, `provider_ids[${index}]`));
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw badRequest('Routing cannot include the same provider twice', 'AI_ROUTING_DUPLICATE');
  }
  return ids;
}

export function sortProvidersForAggregate(
  rows: AiGatewayControlPlaneProviderRow[],
  routing: AiGatewayRoutingRow[],
): AiGatewayControlPlaneProviderRow[] {
  const position = new Map(routing.map((row) => [row.provider_id, row.position]));
  return [...rows].sort((a, b) => {
    const pa = position.get(a.id);
    const pb = position.get(b.id);
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function sanitizeAiGatewayAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/credential|api_key|secret|password|ciphertext|prompt|completion/i.test(key)) continue;
    if (typeof value === 'string' && /sk-[a-zA-Z0-9_-]{8,}/.test(value)) continue;
    out[key] = value;
  }
  return out;
}
