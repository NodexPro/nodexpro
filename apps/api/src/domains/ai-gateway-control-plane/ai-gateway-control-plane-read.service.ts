import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { AppError } from '../../shared/errors.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { supabaseAdmin } from '../../db/client.js';
import { listAiAdapterRegistry } from '../../shared/ai-gateway/ai-gateway.adapters.js';
import { loadAiGatewayPublicConfig } from '../../shared/ai-gateway/ai-gateway.config.js';
import {
  deriveOverallGatewayStatus,
  sortProvidersForAggregate,
  toProviderCard,
} from './ai-gateway-control-plane.pure.js';
import type {
  AiGatewayControlPlaneProviderRow,
  AiGatewayRoutingRow,
  OwnerAiGatewayAggregate,
} from './ai-gateway-control-plane.types.js';

const PROVIDER_TABLE = 'ai_gateway_providers';
const ROUTING_TABLE = 'ai_gateway_routing';

const PROVIDER_SELECT =
  'id, display_name, adapter_type, base_url, enabled, pinned_model, credential_ciphertext, structured_output_certified, compatibility_status, last_success_at, last_failure_at, last_failure_category, last_test_at, last_test_outcome, last_test_configuration_digest, credential_updated_at, created_at, updated_at';

function throwIfSchemaMissing(error: unknown): void {
  if (
    error &&
    (isSupabaseMissingTableError(error as { message?: string; code?: string }, PROVIDER_TABLE) ||
      isSupabaseMissingTableError(error as { message?: string; code?: string }, ROUTING_TABLE))
  ) {
    throw new AppError(
      400,
      'AI Gateway Control Plane schema is not applied. Migration 641 is required on DEV.',
      'BAD_REQUEST',
    );
  }
}

function mapProviderRow(row: Record<string, unknown>): AiGatewayControlPlaneProviderRow {
  return {
    id: String(row.id),
    display_name: String(row.display_name),
    adapter_type: String(row.adapter_type),
    base_url: row.base_url == null ? null : String(row.base_url),
    enabled: Boolean(row.enabled),
    pinned_model: row.pinned_model == null ? null : String(row.pinned_model),
    credential_configured: Boolean(
      row.credential_ciphertext && String(row.credential_ciphertext).trim(),
    ),
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
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function loadAiGatewayProviders(): Promise<AiGatewayControlPlaneProviderRow[]> {
  const { data, error } = await supabaseAdmin.from(PROVIDER_TABLE).select(PROVIDER_SELECT).order('created_at');
  throwIfSchemaMissing(error);
  if (error) throw error;
  return (data ?? []).map((row) => mapProviderRow(row as Record<string, unknown>));
}

export async function loadAiGatewayRouting(): Promise<AiGatewayRoutingRow[]> {
  const { data, error } = await supabaseAdmin
    .from(ROUTING_TABLE)
    .select('position, provider_id')
    .order('position', { ascending: true });
  throwIfSchemaMissing(error);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    position: Number((row as { position: number }).position),
    provider_id: String((row as { provider_id: string }).provider_id),
  }));
}

export async function loadAiGatewayProvider(id: string): Promise<AiGatewayControlPlaneProviderRow | null> {
  const { data, error } = await supabaseAdmin.from(PROVIDER_TABLE).select(PROVIDER_SELECT).eq('id', id).maybeSingle();
  throwIfSchemaMissing(error);
  if (error) throw error;
  if (!data) return null;
  return mapProviderRow(data as Record<string, unknown>);
}

export async function loadAiGatewayProviderCiphertext(id: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .select('credential_ciphertext')
    .eq('id', id)
    .maybeSingle();
  throwIfSchemaMissing(error);
  if (error) throw error;
  const value = data && (data as { credential_ciphertext?: unknown }).credential_ciphertext;
  if (typeof value !== 'string' || !value.trim()) return null;
  return value;
}

export async function buildOwnerAiGatewayAggregate(ctx: RequestContext): Promise<OwnerAiGatewayAggregate> {
  assertPlatformOwner(ctx);
  const [providers, routing] = await Promise.all([loadAiGatewayProviders(), loadAiGatewayRouting()]);
  const routingByProvider = new Map(routing.map((row) => [row.provider_id, row.position]));
  const ordered = sortProvidersForAggregate(providers, routing);
  const cards = ordered.map((row) => toProviderCard(row, routingByProvider));
  const overall = deriveOverallGatewayStatus(cards);
  const env = loadAiGatewayPublicConfig();
  return {
    aggregate_key: 'owner_ai_gateway_aggregate',
    overall_status: overall.status,
    overall_reason: overall.reason,
    providers: cards,
    routing: routing.map((row) => ({
      position: row.position,
      role: row.position === 1 ? 'Primary' : `Fallback ${row.position - 1}`,
      provider_id: row.provider_id,
    })),
    available_adapter_types: listAiAdapterRegistry(),
    env_bootstrap: {
      configured: Boolean(env.apiKeyConfigured && env.provider && env.model),
      provider: env.provider,
      model: env.model,
      api_key_configured: env.apiKeyConfigured,
      used_for_owner_routing: false,
    },
    allowed_actions: [
      {
        action_key: 'create_ai_provider',
        enabled: true,
        reason: null,
        payload: {
          adapter_type: 'openai_compatible',
          display_name: 'string',
          pinned_model: 'optional pinned model id',
          base_url: 'optional https endpoint when adapter allows',
        },
      },
      {
        action_key: 'update_ai_provider_configuration',
        enabled: cards.length > 0,
        reason: cards.length ? null : 'Create a provider first.',
        payload: {
          ai_provider_id: 'uuid',
          display_name: 'optional string',
          pinned_model: 'optional pinned model id',
          base_url: 'optional https endpoint',
        },
      },
      {
        action_key: 'set_ai_provider_credential',
        enabled: cards.length > 0,
        reason: cards.length ? null : 'Create a provider first.',
        payload: { ai_provider_id: 'uuid', credential: 'write-only secret; never returned' },
      },
      {
        action_key: 'remove_ai_provider_credential',
        enabled: cards.some((card) => card.credential_configured),
        reason: cards.some((card) => card.credential_configured) ? null : 'No credential is configured.',
        payload: { ai_provider_id: 'uuid' },
      },
      {
        action_key: 'test_ai_provider_connection',
        enabled: cards.some((card) => card.credential_configured),
        reason: cards.some((card) => card.credential_configured)
          ? null
          : 'Configure a credential before testing.',
        payload: { ai_provider_id: 'uuid' },
      },
      {
        action_key: 'enable_ai_provider',
        enabled: cards.some((card) => card.can_enable),
        reason: cards.some((card) => card.can_enable)
          ? null
          : 'Connection test has not passed for the current configuration.',
        payload: { ai_provider_id: 'uuid' },
      },
      {
        action_key: 'disable_ai_provider',
        enabled: cards.some((card) => card.enabled),
        reason: cards.some((card) => card.enabled) ? null : 'No provider is enabled.',
        payload: { ai_provider_id: 'uuid' },
      },
      {
        action_key: 'set_ai_provider_routing',
        enabled: cards.some((card) => card.eligible_for_routing),
        reason: cards.some((card) => card.eligible_for_routing)
          ? null
          : 'No eligible enabled provider. Connection test is required before routing.',
        payload: { provider_ids: 'ordered uuid array; max 3' },
      },
    ],
  };
}
