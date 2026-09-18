import { supabaseAdmin } from '../../db/client.js';
import { decryptAiGatewayJson, isAiGatewayEncryptionNotConfiguredError } from './ai-gateway.encryption.js';
import { isSupabaseMissingTableError } from '../supabase-errors.js';
import {
  AI_GATEWAY_DEFAULT_BASE_URL,
  AI_GATEWAY_MAX_ROUTE_TARGETS,
  AI_GATEWAY_PROVIDER_OPENAI,
  type AiGatewayResolvedConfig,
  type AiGatewayRoutingSource,
} from './ai-gateway.types.js';
import { getAiAdapterRegistryEntry } from './ai-gateway.adapters.js';
import { evaluateAiProviderEnablement } from '../../domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';
import type { AiGatewayControlPlaneProviderRow } from '../../domains/ai-gateway-control-plane/ai-gateway-control-plane.types.js';

export type AiGatewayRouteTarget = {
  id: string | null;
  position: number | null;
  routing_source: AiGatewayRoutingSource;
  config: AiGatewayResolvedConfig;
};

const PROVIDER_TABLE = 'ai_gateway_providers';
const ROUTING_TABLE = 'ai_gateway_routing';

function mapRow(row: Record<string, unknown>): AiGatewayControlPlaneProviderRow & { credential_ciphertext: string | null } {
  return {
    id: String(row.id),
    display_name: String(row.display_name),
    adapter_type: String(row.adapter_type),
    base_url: row.base_url == null ? null : String(row.base_url),
    enabled: Boolean(row.enabled),
    pinned_model: row.pinned_model == null ? null : String(row.pinned_model),
    credential_configured: Boolean(row.credential_ciphertext && String(row.credential_ciphertext).trim()),
    structured_output_certified: Boolean(row.structured_output_certified),
    compatibility_status: String(row.compatibility_status ?? 'not_tested'),
    last_success_at: row.last_success_at == null ? null : String(row.last_success_at),
    last_failure_at: row.last_failure_at == null ? null : String(row.last_failure_at),
    last_failure_category: row.last_failure_category == null ? null : String(row.last_failure_category),
    last_test_at: row.last_test_at == null ? null : String(row.last_test_at),
    last_test_outcome: row.last_test_outcome == null ? null : String(row.last_test_outcome),
    last_test_configuration_digest:
      row.last_test_configuration_digest == null ? null : String(row.last_test_configuration_digest),
    credential_updated_at: row.credential_updated_at == null ? null : String(row.credential_updated_at),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    credential_ciphertext: row.credential_ciphertext == null ? null : String(row.credential_ciphertext),
  };
}

export function isOwnerRouteEligible(row: AiGatewayControlPlaneProviderRow): boolean {
  if (!row.enabled) return false;
  return evaluateAiProviderEnablement(row).ok;
}

function decryptApiKey(ciphertext: string | null): string | null {
  if (!ciphertext || !ciphertext.trim()) return null;
  try {
    const payload = decryptAiGatewayJson<{ value?: unknown }>(ciphertext);
    if (typeof payload.value !== 'string' || !payload.value.trim()) return null;
    return payload.value.trim();
  } catch (error) {
    if (isAiGatewayEncryptionNotConfiguredError(error)) throw error;
    return null;
  }
}

export function envBootstrapRouteTarget(config: AiGatewayResolvedConfig): AiGatewayRouteTarget {
  return {
    id: null,
    position: null,
    routing_source: 'env',
    config,
  };
}

export function pinnedInvocationRouteTarget(config: AiGatewayResolvedConfig): AiGatewayRouteTarget {
  return {
    id: null,
    position: null,
    routing_source: 'pinned',
    config,
  };
}

export async function loadEligibleOwnerRouteTargets(): Promise<AiGatewayRouteTarget[]> {
  const { data: routing, error: routingError } = await supabaseAdmin
    .from(ROUTING_TABLE)
    .select('position, provider_id')
    .order('position', { ascending: true });
  if (routingError) {
    if (isSupabaseMissingTableError(routingError, ROUTING_TABLE)) return [];
    return [];
  }
  const ordered = (routing ?? [])
    .map((row) => ({
      position: Number((row as { position: number }).position),
      provider_id: String((row as { provider_id: string }).provider_id),
    }))
    .filter((row) => Number.isFinite(row.position) && row.position >= 1)
    .slice(0, AI_GATEWAY_MAX_ROUTE_TARGETS);
  if (!ordered.length) return [];

  const { data: providers, error: providerError } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .select(
      'id, display_name, adapter_type, base_url, enabled, pinned_model, credential_ciphertext, structured_output_certified, compatibility_status, last_success_at, last_failure_at, last_failure_category, last_test_at, last_test_outcome, last_test_configuration_digest, credential_updated_at, created_at, updated_at',
    )
    .in(
      'id',
      ordered.map((row) => row.provider_id),
    );
  if (providerError) {
    if (isSupabaseMissingTableError(providerError, PROVIDER_TABLE)) return [];
    return [];
  }
  const byId = new Map(
    (providers ?? []).map((row) => {
      const mapped = mapRow(row as Record<string, unknown>);
      return [mapped.id, mapped] as const;
    }),
  );

  const targets: AiGatewayRouteTarget[] = [];
  const seen = new Set<string>();
  for (const route of ordered) {
    if (seen.has(route.provider_id)) continue;
    seen.add(route.provider_id);
    const row = byId.get(route.provider_id);
    if (!row) continue;
    if (!isOwnerRouteEligible(row)) continue;
    const adapter = getAiAdapterRegistryEntry(row.adapter_type);
    if (!adapter) continue;
    const apiKey = decryptApiKey(row.credential_ciphertext);
    if (!apiKey || !row.pinned_model) continue;
    targets.push({
      id: row.id,
      position: route.position,
      routing_source: 'owner',
      config: {
        provider: AI_GATEWAY_PROVIDER_OPENAI,
        model: row.pinned_model,
        apiKey,
        baseUrl: (row.base_url || AI_GATEWAY_DEFAULT_BASE_URL).replace(/\/+$/, ''),
        timeoutMs: 30_000,
      },
    });
  }
  return targets;
}
