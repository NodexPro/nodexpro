import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_ERROR_CODES,
  AI_GATEWAY_CIRCUIT_COOLDOWN_MS,
  AI_GATEWAY_MAX_ATTEMPTS,
  AI_GATEWAY_MAX_ROUTE_TARGETS,
  AiGatewayError,
  createAiGateway,
  createAiGatewayCircuitBreaker,
  isAiGatewayFailoverErrorCode,
} from '../../src/shared/ai-gateway/index.js';
import { isOwnerRouteEligible } from '../../src/shared/ai-gateway/ai-gateway.owner-routing.js';
import type { AiGatewayRouteTarget } from '../../src/shared/ai-gateway/ai-gateway.owner-routing.js';
import type { AiGatewayCompleteStructuredJsonInput, AiGatewayResolvedConfig } from '../../src/shared/ai-gateway/ai-gateway.types.js';
import {
  digestAiProviderTestConfiguration,
  deriveAiProviderHealth,
  toProviderCard,
  type AiGatewayControlPlaneProviderRow,
} from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const SECRET_ENV = 'sk-env-not-a-real-key-1234567890';
const SECRET_PRIMARY = 'sk-owner-primary-not-real-1234567890';
const SECRET_FALLBACK = 'sk-owner-fallback-not-real-1234567890';
const SECRET_FALLBACK_2 = 'sk-owner-fallback2-not-real-1234567890';
const SOURCE_TEXT = 'UNTRUSTED_SOURCE_DO_NOT_LOG';

const ENV = {
  TAX_KNOWLEDGE_AI_PROVIDER: 'openai',
  TAX_KNOWLEDGE_AI_MODEL: 'gpt-4.1-mini',
  TAX_KNOWLEDGE_AI_API_KEY: SECRET_ENV,
};

const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const FALLBACK_ID = '22222222-2222-4222-8222-222222222222';
const FALLBACK2_ID = '33333333-3333-4333-8333-333333333333';
const EXTRA_ID = '44444444-4444-4444-8444-444444444444';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function sampleInput(): AiGatewayCompleteStructuredJsonInput {
  return {
    purpose: 'test_structured_json',
    messages: [
      { role: 'system', content: 'Return JSON only.' },
      { role: 'user', content: SOURCE_TEXT },
    ],
    outputSchema: {
      name: 'test_outcome',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['extraction_outcome'],
        properties: { extraction_outcome: { type: 'string' } },
      },
    },
    promptContractVersion: 'tax_knowledge_proposal_extract_v1',
    outputContract: 'tax_knowledge_proposal_v1',
    outputSchemaVersion: 1,
    includesUntrustedSourceText: true,
  };
}

function openaiMessageBody(payload: unknown): string {
  return JSON.stringify({
    choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
  });
}

function okBody(): string {
  return openaiMessageBody({ extraction_outcome: 'no_rules' });
}

function config(apiKey: string, model: string): AiGatewayResolvedConfig {
  return {
    provider: 'openai',
    model,
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    timeoutMs: 4_000,
  };
}

function target(
  id: string,
  position: number,
  apiKey: string,
  model: string,
): AiGatewayRouteTarget {
  return {
    id,
    position,
    routing_source: 'owner',
    config: config(apiKey, model),
  };
}

function ownerRoutes(list: AiGatewayRouteTarget[]) {
  return async () => list;
}

function bearer(request: { headers: Record<string, string> }): string {
  return request.headers.Authorization ?? '';
}

async function expectAiError(run: () => Promise<unknown>, code: string): Promise<AiGatewayError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AiGatewayError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${code}`);
}

function certifiedRow(overrides: Partial<AiGatewayControlPlaneProviderRow> = {}): AiGatewayControlPlaneProviderRow {
  const base: AiGatewayControlPlaneProviderRow = {
    id: PRIMARY_ID,
    display_name: 'Primary',
    adapter_type: 'openai_compatible',
    base_url: null,
    enabled: true,
    pinned_model: 'gpt-4.1-mini',
    credential_configured: true,
    structured_output_certified: true,
    compatibility_status: 'compatible',
    last_success_at: '2026-09-17T10:00:00.000Z',
    last_failure_at: null,
    last_failure_category: null,
    last_test_at: '2026-09-17T10:00:00.000Z',
    last_test_outcome: 'passed',
    last_test_configuration_digest: null,
    credential_updated_at: '2026-09-17T09:00:00.000Z',
    created_at: '2026-09-17T09:00:00.000Z',
    updated_at: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
  return {
    ...base,
    last_test_configuration_digest:
      overrides.last_test_configuration_digest ??
      digestAiProviderTestConfiguration({
        adapter_type: base.adapter_type,
        base_url: base.base_url,
        pinned_model: base.pinned_model,
        credential_updated_at: base.credential_updated_at,
      }),
  };
}

test('TAX-641D keeps routing in the shared gateway without Redis, UI, or a new migration', () => {
  const service = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts');
  const circuit = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.circuit.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const probe = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.ts',
  );
  assert.match(service, /resolveOwnerRoutes/);
  assert.match(service, /ai_gateway_routing|loadEligibleOwnerRouteTargets/);
  assert.match(circuit, /half_open/);
  assert.doesNotMatch(circuit, /supabaseAdmin|from\('/);
  assert.doesNotMatch(circuit, /redis/i);
  assert.doesNotMatch(service, /redis/i);
  assert.doesNotMatch(generate, /TAX_KNOWLEDGE_AI_/);
  assert.doesNotMatch(generate, /ai_gateway_routing/);
  assert.match(generate, /completeStructuredJson/);
  assert.match(probe, /invocationConfig/);
  assert.doesNotMatch(probe, /resolveOwnerRoutes/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/642_ai_gateway_runtime_routing.sql')), false);
  assert.equal(isAiGatewayFailoverErrorCode(AI_ERROR_CODES.AI_TIMEOUT), true);
  assert.equal(isAiGatewayFailoverErrorCode(AI_ERROR_CODES.AI_NOT_CONFIGURED), false);
});

test('disabled, uncertified, and stale providers are not eligible Owner routing targets', () => {
  assert.equal(isOwnerRouteEligible(certifiedRow()), true);
  assert.equal(isOwnerRouteEligible(certifiedRow({ enabled: false })), false);
  assert.equal(
    isOwnerRouteEligible(certifiedRow({ structured_output_certified: false, compatibility_status: 'not_tested' })),
    false,
  );
  assert.equal(isOwnerRouteEligible(certifiedRow({ last_test_configuration_digest: 'stale' })), false);
  assert.equal(isOwnerRouteEligible(certifiedRow({ credential_configured: false })), false);
});

test('primary success does not call fallback', async () => {
  const models: string[] = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      models.push(JSON.parse(request.body).model);
      assert.match(bearer(request), /sk-owner-primary/);
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(result.telemetry.failover_occurred, false);
  assert.equal(result.telemetry.routing_source, 'owner');
  assert.equal(result.telemetry.routing_position, 1);
  assert.equal(result.telemetry.provider_id, PRIMARY_ID);
  assert.deepEqual(models, ['gpt-4.1-mini']);
  assert.doesNotMatch(JSON.stringify(result.telemetry), new RegExp(SECRET_PRIMARY));
  assert.doesNotMatch(JSON.stringify(result.telemetry), new RegExp(SOURCE_TEXT));
});

test('primary timeout failovers to fallback and returns the actual fallback model', async () => {
  const models: string[] = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      const model = JSON.parse(request.body).model as string;
      models.push(model);
      if (model === 'gpt-4.1-mini') {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.model, 'gpt-4.1');
  assert.equal(result.provider, 'openai');
  assert.equal(result.telemetry.failover_occurred, true);
  assert.equal(result.telemetry.provider_id, FALLBACK_ID);
  assert.deepEqual(models, ['gpt-4.1-mini', 'gpt-4.1']);
});

test('primary 429 failovers after the bounded same-provider retry', async () => {
  const statuses: number[] = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      if (bearer(request).includes('primary')) {
        statuses.push(429);
        return { status: 429, bodyText: '{"error":"rate"}', retryAfterMs: 10 };
      }
      statuses.push(200);
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.model, 'gpt-4.1');
  assert.equal(result.telemetry.failover_occurred, true);
  assert.equal(statuses.filter((status) => status === 429).length, AI_GATEWAY_MAX_ATTEMPTS);
  assert.equal(result.telemetry.providers_attempted, 2);
});

test('primary 5xx failovers to fallback', async () => {
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      if (bearer(request).includes('primary')) {
        return { status: 503, bodyText: 'unavailable', retryAfterMs: null };
      }
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.model, 'gpt-4.1');
  assert.equal(result.telemetry.failover_occurred, true);
});

test('at most three provider instances are attempted and duplicate ids do not loop', async () => {
  const keys: string[] = [];
  const routes = [
    target(PRIMARY_ID, 1, SECRET_PRIMARY, 'model-a'),
    target(FALLBACK_ID, 2, SECRET_FALLBACK, 'model-b'),
    target(FALLBACK2_ID, 3, SECRET_FALLBACK_2, 'model-c'),
    target(EXTRA_ID, 4, 'sk-owner-extra-not-real-1234567890', 'model-d'),
    target(PRIMARY_ID, 1, SECRET_PRIMARY, 'model-a'),
  ];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes(routes),
    transport: async (request) => {
      keys.push(bearer(request));
      return { status: 503, bodyText: 'down', retryAfterMs: null };
    },
  });
  await expectAiError(() => gateway.completeStructuredJson(sampleInput()), AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  assert.equal(keys.length, AI_GATEWAY_MAX_ROUTE_TARGETS * AI_GATEWAY_MAX_ATTEMPTS);
  assert.equal(keys.some((key) => key.includes('extra')), false);
  assert.equal(new Set(keys).size, AI_GATEWAY_MAX_ROUTE_TARGETS);
});

test('all Owner providers unavailable returns controlled failure and never uses env', async () => {
  const keys: string[] = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini')]),
    transport: async (request) => {
      keys.push(bearer(request));
      return { status: 503, bodyText: `secret ${SECRET_ENV}`, retryAfterMs: null };
    },
  });
  const error = await expectAiError(
    () => gateway.completeStructuredJson(sampleInput()),
    AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
  );
  assert.equal(keys.some((key) => key.includes(SECRET_ENV)), false);
  assert.doesNotMatch(error.message, new RegExp(SECRET_ENV));
  assert.doesNotMatch(error.message, new RegExp(SECRET_PRIMARY));
});

test('Owner routing and env bootstrap are never silently merged', async () => {
  const models: string[] = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1')]),
    transport: async (request) => {
      models.push(JSON.parse(request.body).model);
      assert.match(bearer(request), /sk-owner-primary/);
      assert.doesNotMatch(bearer(request), new RegExp(SECRET_ENV));
      return { status: 503, bodyText: 'down', retryAfterMs: null };
    },
  });
  await expectAiError(() => gateway.completeStructuredJson(sampleInput()), AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  assert.deepEqual(models, ['gpt-4.1', 'gpt-4.1']);
});

test('env bootstrap is used only when no Owner route exists', async () => {
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([]),
    transport: async (request) => {
      assert.match(bearer(request), new RegExp(SECRET_ENV));
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.telemetry.routing_source, 'env');
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(result.telemetry.provider_id, null);
});

test('valid structured output is returned immediately and is not retried', async () => {
  let calls = 0;
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async () => {
      calls += 1;
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.json.extraction_outcome, 'no_rules');
  assert.equal(calls, 1);
});

test('circuit opens after three eligible transport failures and then failovers', async () => {
  const circuitBreaker = createAiGatewayCircuitBreaker();
  let nowMs = 1_000;
  const primaryCalls: number[] = [];
  const gateway = createAiGateway({
    env: ENV,
    now: () => nowMs,
    circuitBreaker,
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      if (bearer(request).includes('primary')) {
        primaryCalls.push(nowMs);
        return { status: 503, bodyText: 'down', retryAfterMs: null };
      }
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  await gateway.completeStructuredJson(sampleInput());
  await gateway.completeStructuredJson(sampleInput());
  await gateway.completeStructuredJson(sampleInput());
  assert.equal(circuitBreaker.snapshot(PRIMARY_ID)?.state, 'open');
  const before = primaryCalls.length;
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.model, 'gpt-4.1');
  assert.equal(result.telemetry.failover_occurred, true);
  assert.equal(primaryCalls.length, before);
});

test('half-open permits a single in-process probe and success closes the circuit', async () => {
  const circuitBreaker = createAiGatewayCircuitBreaker();
  let nowMs = 5_000;
  let primaryInFlight = 0;
  let primaryStarted = 0;
  let releasePrimary: (() => void) | null = null;
  const gateway = createAiGateway({
    env: ENV,
    now: () => nowMs,
    circuitBreaker,
    sleep: async () => undefined,
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      if (bearer(request).includes('primary')) {
        primaryStarted += 1;
        if (circuitBreaker.snapshot(PRIMARY_ID)?.state === 'half_open' || primaryInFlight > 0) {
          primaryInFlight += 1;
          await new Promise<void>((resolve) => {
            releasePrimary = resolve;
          });
          primaryInFlight -= 1;
          return { status: 200, bodyText: okBody(), retryAfterMs: null };
        }
        return { status: 503, bodyText: 'down', retryAfterMs: null };
      }
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  await gateway.completeStructuredJson(sampleInput());
  await gateway.completeStructuredJson(sampleInput());
  await gateway.completeStructuredJson(sampleInput());
  nowMs += AI_GATEWAY_CIRCUIT_COOLDOWN_MS + 1;
  const first = gateway.completeStructuredJson(sampleInput());
  const second = gateway.completeStructuredJson(sampleInput());
  for (let i = 0; i < 50 && primaryInFlight === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(primaryInFlight, 1);
  assert.equal(primaryStarted, 7);
  releasePrimary?.();
  const [probeResult, skippedResult] = await Promise.all([first, second]);
  assert.equal(probeResult.model, 'gpt-4.1-mini');
  assert.equal(skippedResult.model, 'gpt-4.1');
  assert.equal(circuitBreaker.snapshot(PRIMARY_ID)?.state, 'closed');
});

test('circuit is not opened by a structurally valid response that a caller later rejects', async () => {
  const circuitBreaker = createAiGatewayCircuitBreaker();
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker,
    resolveOwnerRoutes: ownerRoutes([target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini')]),
    transport: async () => ({ status: 200, bodyText: okBody(), retryAfterMs: null }),
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  assert.equal(result.outcome, 'success');
  assert.equal(circuitBreaker.snapshot(PRIMARY_ID)?.state, 'closed');
  assert.equal(circuitBreaker.snapshot(PRIMARY_ID)?.consecutive_failures, 0);
});

test('pinned test-connection invocation never failovers to Owner routing', async () => {
  let ownerLoads = 0;
  const gateway = createAiGateway({
    env: ENV,
    maxAttempts: 1,
    invocationConfig: config(SECRET_PRIMARY, 'gpt-4.1-mini'),
    resolveOwnerRoutes: async () => {
      ownerLoads += 1;
      return [target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1')];
    },
    transport: async () => ({ status: 503, bodyText: 'down', retryAfterMs: null }),
  });
  await expectAiError(() => gateway.completeStructuredJson(sampleInput()), AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  assert.equal(ownerLoads, 0);
});

test('telemetry stays sanitized across Owner failover', async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const gateway = createAiGateway({
    env: ENV,
    circuitBreaker: createAiGatewayCircuitBreaker(),
    sleep: async () => undefined,
    log: (event, payload) => logs.push({ event, payload }),
    resolveOwnerRoutes: ownerRoutes([
      target(PRIMARY_ID, 1, SECRET_PRIMARY, 'gpt-4.1-mini'),
      target(FALLBACK_ID, 2, SECRET_FALLBACK, 'gpt-4.1'),
    ]),
    transport: async (request) => {
      if (bearer(request).includes('primary')) {
        return { status: 401, bodyText: `invalid api key ${SECRET_PRIMARY}`, retryAfterMs: null };
      }
      return { status: 200, bodyText: okBody(), retryAfterMs: null };
    },
  });
  const result = await gateway.completeStructuredJson(sampleInput());
  const encoded = JSON.stringify({ result: result.telemetry, logs });
  assert.doesNotMatch(encoded, new RegExp(SECRET_PRIMARY));
  assert.doesNotMatch(encoded, new RegExp(SECRET_FALLBACK));
  assert.doesNotMatch(encoded, new RegExp(SECRET_ENV));
  assert.doesNotMatch(encoded, new RegExp(SOURCE_TEXT));
  assert.doesNotMatch(encoded, /invalid api key/);
  for (const forbidden of ['prompt', 'raw_prompt', 'completion', 'raw_completion', 'apiKey', 'credential']) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.telemetry, forbidden), false);
  }
  assert.equal(result.telemetry.failover_occurred, true);
  assert.equal(typeof result.telemetry.latency_ms, 'number');
});

test('aggregate overlay reports process-local circuit state without changing eligibility', () => {
  const row = certifiedRow();
  const card = toProviderCard(row, new Map([[PRIMARY_ID, 1]]), 'open');
  assert.equal(card.circuit_state, 'open');
  assert.equal(card.eligible_for_routing, true);
  assert.equal(card.health_status, 'unavailable');
  const health = deriveAiProviderHealth(row, 'half_open');
  assert.equal(health.status, 'degraded');
});
