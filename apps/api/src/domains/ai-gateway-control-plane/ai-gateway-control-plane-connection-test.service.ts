import { decryptJson } from '../../shared/field-encryption.js';
import { AppError, badRequest, notFound } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { getAiAdapterRegistryEntry } from '../../shared/ai-gateway/ai-gateway.adapters.js';
import { assertSafeAiGatewayBaseUrl } from '../../shared/ai-gateway/ai-gateway.endpoint-policy.js';
import {
  AI_GATEWAY_DEFAULT_BASE_URL,
  AI_GATEWAY_PROVIDER_OPENAI,
  createAiGateway,
  fetchAiProviderTransport,
} from '../../shared/ai-gateway/index.js';
import { isPinnedAiModel } from '../../shared/ai-gateway/ai-gateway.config.js';
import type { AiGatewayResolvedConfig } from '../../shared/ai-gateway/ai-gateway.types.js';
import type { AiProviderTransport } from '../../shared/ai-gateway/providers/ai-provider.types.js';
import { supabaseAdmin } from '../../db/client.js';
import { digestAiProviderTestConfiguration, parseProviderIdPayload } from './ai-gateway-control-plane.pure.js';
import {
  AI_PROVIDER_TEST_MAX_ATTEMPTS,
  AI_PROVIDER_TEST_TIMEOUT_MS,
  aiProviderConnectionTestThrottle,
  buildAiProviderConnectionTestRequest,
  buildConnectionTestFailurePatch,
  buildConnectionTestSuccessPatch,
  classifyConnectionTestFailure,
  connectionTestContainsForbiddenData,
  isSuccessfulConnectionTestJson,
  noteAiProviderConnectionTestAttempt,
} from './ai-gateway-control-plane-test.pure.js';
import { loadAiGatewayProvider, loadAiGatewayProviderCiphertext } from './ai-gateway-control-plane-read.service.js';
import type { AiGatewayControlPlaneCommandResponse } from './ai-gateway-control-plane.types.js';

type ProbeDeps = {
  transport?: AiProviderTransport;
  now?: () => number;
};

export async function probeAiProviderConnection(
  config: AiGatewayResolvedConfig,
  deps: ProbeDeps = {},
): Promise<
  | { ok: true; latency_ms: number }
  | { ok: false; latency_ms: number; category: ReturnType<typeof classifyConnectionTestFailure>['category']; structuredOutputFailed: boolean }
> {
  const request = buildAiProviderConnectionTestRequest();
  if (connectionTestContainsForbiddenData(request)) {
    throw new AppError(500, 'Connection test payload is invalid.', 'AI_TEST_PAYLOAD_INVALID');
  }
  let lastStatus: number | null = null;
  const started = (deps.now ?? Date.now)();
  const inner: AiProviderTransport = deps.transport ?? fetchAiProviderTransport;
  const gateway = createAiGateway({
    invocationConfig: config,
    maxAttempts: AI_PROVIDER_TEST_MAX_ATTEMPTS,
    transport: async (req) => {
      const response = await inner(req);
      lastStatus = response.status;
      return response;
    },
    log: () => undefined,
  });
  try {
    const result = await gateway.completeStructuredJson(request);
    if (!isSuccessfulConnectionTestJson(result.json)) {
      return {
        ok: false,
        latency_ms: result.latency_ms,
        category: 'structured_output_invalid',
        structuredOutputFailed: true,
      };
    }
    return { ok: true, latency_ms: result.latency_ms };
  } catch (error) {
    const classified = classifyConnectionTestFailure({ error, lastStatus });
    return {
      ok: false,
      latency_ms: (deps.now ?? Date.now)() - started,
      category: classified.category,
      structuredOutputFailed: classified.structuredOutputFailed,
    };
  }
}

export async function testAiProviderConnection(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  helpers: {
    audit: (
      ctx: RequestContext,
      action: string,
      entityId: string | null,
      payload: Record<string, unknown>,
    ) => Promise<void>;
    refreshed: (ctx: RequestContext) => Promise<AiGatewayControlPlaneCommandResponse['refreshed']>;
    throwIfSchemaMissing: (error: unknown) => void;
    transport?: AiProviderTransport;
    now?: () => number;
  },
): Promise<AiGatewayControlPlaneCommandResponse> {
  const id = parseProviderIdPayload(payload);
  const row = await loadAiGatewayProvider(id);
  if (!row) throw notFound('AI provider not found');
  const now = helpers.now ?? Date.now;
  const nowMs = now();
  const throttle = aiProviderConnectionTestThrottle(id, row.last_test_at, nowMs);
  if (throttle.throttled) {
    throw new AppError(429, 'Connection test was throttled. Try again shortly.', 'AI_TEST_THROTTLED', {
      retry_after_ms: throttle.retry_after_ms,
    });
  }
  noteAiProviderConnectionTestAttempt(id, nowMs);

  const adapter = getAiAdapterRegistryEntry(row.adapter_type);
  if (!adapter) {
    throw badRequest('Adapter required. This protocol is not registered.', 'AI_ADAPTER_REQUIRED');
  }
  if (!row.credential_configured) {
    throw badRequest('Credential is not configured.', 'AI_CREDENTIAL_REQUIRED');
  }
  if (!row.pinned_model || !isPinnedAiModel(row.pinned_model)) {
    throw badRequest('A pinned model is required.', 'AI_MODEL_NOT_PINNED');
  }

  const nowIso = new Date(nowMs).toISOString();
  const digest = digestAiProviderTestConfiguration({
    adapter_type: row.adapter_type,
    base_url: row.base_url,
    pinned_model: row.pinned_model,
    credential_updated_at: row.credential_updated_at,
  });

  let baseUrl: string;
  try {
    baseUrl = row.base_url ? assertSafeAiGatewayBaseUrl(row.base_url) ?? AI_GATEWAY_DEFAULT_BASE_URL : AI_GATEWAY_DEFAULT_BASE_URL;
  } catch {
    await persistTestSnapshot(id, buildConnectionTestFailurePatch({
      enabled: row.enabled,
      nowIso,
      category: 'endpoint_blocked',
      structuredOutputFailed: false,
    }), helpers);
    await helpers.audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CONNECTION_TESTED, id, {
      ai_provider_id: id,
      adapter_type: row.adapter_type,
      pinned_model: row.pinned_model,
      outcome: 'failed',
      latency_ms: 0,
      failure_category: 'endpoint_blocked',
      configuration_digest: digest,
    });
    return { ok: true, command: 'test_ai_provider_connection', refreshed: await helpers.refreshed(ctx) };
  }

  const ciphertext = await loadAiGatewayProviderCiphertext(id);
  if (!ciphertext) {
    throw badRequest('Credential is not configured.', 'AI_CREDENTIAL_REQUIRED');
  }
  let apiKey: string;
  try {
    const secret = decryptJson<{ value?: unknown }>(ciphertext);
    if (typeof secret.value !== 'string' || !secret.value.trim()) {
      throw new Error('empty');
    }
    apiKey = secret.value.trim();
  } catch {
    await persistTestSnapshot(id, buildConnectionTestFailurePatch({
      enabled: row.enabled,
      nowIso,
      category: 'not_configured',
      structuredOutputFailed: false,
    }), helpers);
    await helpers.audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CONNECTION_TESTED, id, {
      ai_provider_id: id,
      adapter_type: row.adapter_type,
      pinned_model: row.pinned_model,
      outcome: 'failed',
      latency_ms: 0,
      failure_category: 'not_configured',
      configuration_digest: digest,
    });
    return { ok: true, command: 'test_ai_provider_connection', refreshed: await helpers.refreshed(ctx) };
  }

  const result = await probeAiProviderConnection(
    {
      provider: AI_GATEWAY_PROVIDER_OPENAI,
      model: row.pinned_model,
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      timeoutMs: AI_PROVIDER_TEST_TIMEOUT_MS,
    },
    { transport: helpers.transport, now },
  );

  if (result.ok) {
    const patch = buildConnectionTestSuccessPatch(nowIso, digest);
    await persistTestSnapshot(id, patch, helpers);
    await helpers.audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CONNECTION_TESTED, id, {
      ai_provider_id: id,
      adapter_type: row.adapter_type,
      pinned_model: row.pinned_model,
      outcome: 'passed',
      latency_ms: result.latency_ms,
      failure_category: null,
      configuration_digest: digest,
    });
    return { ok: true, command: 'test_ai_provider_connection', refreshed: await helpers.refreshed(ctx) };
  }

  const patch = buildConnectionTestFailurePatch({
    enabled: row.enabled,
    nowIso,
    category: result.category,
    structuredOutputFailed: result.structuredOutputFailed,
  });
  await persistTestSnapshot(id, patch, helpers);
  await helpers.audit(ctx, AUDIT_ACTIONS.AI_PROVIDER_CONNECTION_TESTED, id, {
    ai_provider_id: id,
    adapter_type: row.adapter_type,
    pinned_model: row.pinned_model,
    outcome: 'failed',
    latency_ms: result.latency_ms,
    failure_category: result.category,
    configuration_digest: digest,
  });
  return { ok: true, command: 'test_ai_provider_connection', refreshed: await helpers.refreshed(ctx) };
}

async function persistTestSnapshot(
  id: string,
  patch: Record<string, unknown>,
  helpers: { throwIfSchemaMissing: (error: unknown) => void },
): Promise<void> {
  const { error } = await supabaseAdmin.from('ai_gateway_providers').update(patch).eq('id', id);
  helpers.throwIfSchemaMissing(error);
  if (error) throw error;
}
