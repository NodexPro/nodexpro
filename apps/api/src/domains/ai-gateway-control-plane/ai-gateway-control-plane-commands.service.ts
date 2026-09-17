import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { AppError, badRequest, notFound } from '../../shared/errors.js';
import { encryptJson } from '../../shared/field-encryption.js';
import { getAiAdapterRegistryEntry } from '../../shared/ai-gateway/ai-gateway.adapters.js';
import { assertSafeAiGatewayBaseUrl } from '../../shared/ai-gateway/ai-gateway.endpoint-policy.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  evaluateAiProviderEnablement,
  parseCreateAiProviderPayload,
  parseCredentialPayload,
  parseProviderIdPayload,
  parseRoutingPayload,
  parseUpdateAiProviderPayload,
  sanitizeAiGatewayAuditPayload,
} from './ai-gateway-control-plane.pure.js';
import { buildOwnerAiGatewayAggregate, loadAiGatewayProvider } from './ai-gateway-control-plane-read.service.js';
import { testAiProviderConnection } from './ai-gateway-control-plane-connection-test.service.js';
import {
  isAiGatewayControlPlaneCommand,
  type AiGatewayControlPlaneCommandName,
  type AiGatewayControlPlaneCommandResponse,
} from './ai-gateway-control-plane.types.js';

const PROVIDER_TABLE = 'ai_gateway_providers';
const ROUTING_TABLE = 'ai_gateway_routing';

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

async function requireProvider(id: string) {
  const row = await loadAiGatewayProvider(id);
  if (!row) throw notFound('AI provider not found');
  return row;
}

async function refreshed(ctx: RequestContext): Promise<AiGatewayControlPlaneCommandResponse['refreshed']> {
  return buildOwnerAiGatewayAggregate(ctx);
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: PROVIDER_TABLE,
    entityId,
    action,
    payload: sanitizeAiGatewayAuditPayload(payload),
  });
}

async function replaceRouting(providerIds: string[]): Promise<void> {
  const { error: delError } = await supabaseAdmin.from(ROUTING_TABLE).delete().gte('position', 1);
  throwIfSchemaMissing(delError);
  if (delError) throw delError;
  if (!providerIds.length) return;
  const { error: insError } = await supabaseAdmin.from(ROUTING_TABLE).insert(
    providerIds.map((provider_id, index) => ({
      position: index + 1,
      provider_id,
    })),
  );
  throwIfSchemaMissing(insError);
  if (insError) throw insError;
}

async function removeProviderFromRouting(providerId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(ROUTING_TABLE)
    .select('position, provider_id')
    .order('position', { ascending: true });
  throwIfSchemaMissing(error);
  if (error) throw error;
  const remaining = (data ?? [])
    .map((row) => String((row as { provider_id: string }).provider_id))
    .filter((id) => id !== providerId);
  await replaceRouting(remaining);
}

export async function executeAiGatewayControlPlaneCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  assertPlatformOwner(ctx);
  if (!isAiGatewayControlPlaneCommand(command)) {
    throw badRequest(`Unsupported AI Gateway command: ${command}`);
  }
  switch (command) {
    case 'create_ai_provider':
      return createAiProvider(ctx, payload);
    case 'update_ai_provider_configuration':
      return updateAiProviderConfiguration(ctx, payload);
    case 'set_ai_provider_credential':
      return setAiProviderCredential(ctx, payload);
    case 'remove_ai_provider_credential':
      return removeAiProviderCredential(ctx, payload);
    case 'enable_ai_provider':
      return enableAiProvider(ctx, payload);
    case 'disable_ai_provider':
      return disableAiProvider(ctx, payload);
    case 'set_ai_provider_routing':
      return setAiProviderRouting(ctx, payload);
    case 'test_ai_provider_connection':
      return testAiProviderConnection(ctx, payload, {
        audit,
        refreshed,
        throwIfSchemaMissing,
      });
    default:
      throw badRequest(`Unsupported AI Gateway command: ${command}`);
  }
}

async function createAiProvider(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const parsed = parseCreateAiProviderPayload(payload);
  const { data, error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .insert({
      display_name: parsed.display_name,
      adapter_type: parsed.adapter_type,
      base_url: parsed.base_url,
      pinned_model: parsed.pinned_model,
      enabled: false,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select('id, enabled')
    .single();
  throwIfSchemaMissing(error);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CREATED, String(data.id), {
    ai_provider_id: String(data.id),
    adapter_type: parsed.adapter_type,
    display_name: parsed.display_name,
    pinned_model: parsed.pinned_model,
    has_custom_base_url: Boolean(parsed.base_url),
    enabled: false,
  });
  return { ok: true, command: 'create_ai_provider', refreshed: await refreshed(ctx) };
}

async function updateAiProviderConfiguration(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const parsed = parseUpdateAiProviderPayload(payload);
  const existing = await requireProvider(parsed.ai_provider_id);
  const adapter = getAiAdapterRegistryEntry(existing.adapter_type);
  if (parsed.base_url && !adapter?.supports_custom_base_url) {
    throw badRequest('This adapter does not allow a custom endpoint.', 'AI_ENDPOINT_NOT_SUPPORTED');
  }
  if (parsed.base_url) assertSafeAiGatewayBaseUrl(parsed.base_url);
  const patch: Record<string, unknown> = { updated_by: ctx.user.id };
  if (parsed.display_name !== undefined) patch.display_name = parsed.display_name;
  if (parsed.pinned_model !== undefined) patch.pinned_model = parsed.pinned_model;
  if (parsed.base_url !== undefined) patch.base_url = parsed.base_url;
  const { error } = await supabaseAdmin.from(PROVIDER_TABLE).update(patch).eq('id', parsed.ai_provider_id);
  throwIfSchemaMissing(error);
  if (error) throw error;
  if (parsed.pinned_model !== undefined || parsed.base_url !== undefined) {
    await removeProviderFromRouting(parsed.ai_provider_id);
  }
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CONFIGURATION_CHANGED, parsed.ai_provider_id, {
    ai_provider_id: parsed.ai_provider_id,
    changed_display_name: parsed.display_name !== undefined,
    changed_pinned_model: parsed.pinned_model !== undefined,
    changed_base_url: parsed.base_url !== undefined,
  });
  return { ok: true, command: 'update_ai_provider_configuration', refreshed: await refreshed(ctx) };
}

async function setAiProviderCredential(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const parsed = parseCredentialPayload(payload);
  await requireProvider(parsed.ai_provider_id);
  const ciphertext = encryptJson({ value: parsed.credential });
  const { error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .update({
      credential_ciphertext: ciphertext,
      updated_by: ctx.user.id,
    })
    .eq('id', parsed.ai_provider_id);
  throwIfSchemaMissing(error);
  if (error) throw error;
  await removeProviderFromRouting(parsed.ai_provider_id);
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CREDENTIAL_SET, parsed.ai_provider_id, {
    ai_provider_id: parsed.ai_provider_id,
    credential_configured: true,
  });
  return { ok: true, command: 'set_ai_provider_credential', refreshed: await refreshed(ctx) };
}

async function removeAiProviderCredential(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const id = parseProviderIdPayload(payload);
  await requireProvider(id);
  const { error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .update({
      credential_ciphertext: null,
      updated_by: ctx.user.id,
    })
    .eq('id', id);
  throwIfSchemaMissing(error);
  if (error) throw error;
  await removeProviderFromRouting(id);
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CREDENTIAL_REMOVED, id, {
    ai_provider_id: id,
    credential_configured: false,
  });
  return { ok: true, command: 'remove_ai_provider_credential', refreshed: await refreshed(ctx) };
}

async function enableAiProvider(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const id = parseProviderIdPayload(payload);
  const row = await requireProvider(id);
  const decision = evaluateAiProviderEnablement(row);
  if (!decision.ok) {
    throw badRequest(decision.reason, decision.code);
  }
  const { error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .update({ enabled: true, updated_by: ctx.user.id })
    .eq('id', id);
  throwIfSchemaMissing(error);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_ENABLED, id, { ai_provider_id: id, enabled: true });
  return { ok: true, command: 'enable_ai_provider', refreshed: await refreshed(ctx) };
}

async function disableAiProvider(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const id = parseProviderIdPayload(payload);
  await requireProvider(id);
  const { error } = await supabaseAdmin
    .from(PROVIDER_TABLE)
    .update({ enabled: false, updated_by: ctx.user.id })
    .eq('id', id);
  throwIfSchemaMissing(error);
  if (error) throw error;
  await removeProviderFromRouting(id);
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_DISABLED, id, { ai_provider_id: id, enabled: false });
  return { ok: true, command: 'disable_ai_provider', refreshed: await refreshed(ctx) };
}

async function setAiProviderRouting(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<AiGatewayControlPlaneCommandResponse> {
  const ids = parseRoutingPayload(payload);
  const rows = await Promise.all(ids.map((id) => requireProvider(id)));
  for (const row of rows) {
    if (!row.enabled) {
      throw badRequest('Routing may include only enabled providers.', 'AI_ROUTING_PROVIDER_DISABLED');
    }
    const decision = evaluateAiProviderEnablement(row);
    if (!decision.ok) {
      throw badRequest(decision.reason, decision.code);
    }
  }
  await replaceRouting(ids);
  await audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_ROUTING_CHANGED, ids[0] ?? null, {
    provider_ids: ids,
    positions: ids.map((_, index) => index + 1),
  });
  return { ok: true, command: 'set_ai_provider_routing', refreshed: await refreshed(ctx) };
}

export { isAiGatewayControlPlaneCommand };
export type { AiGatewayControlPlaneCommandName };
