import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_ERROR_CODES, AiGatewayError } from '../../src/shared/ai-gateway/ai-gateway.errors.js';
import { assertSafeTelemetryPayload } from '../../src/shared/ai-gateway/ai-gateway.redaction.js';
import {
  extractSafeProviderErrorHint,
  isAuthProviderErrorCode,
  isModelProviderErrorCode,
} from '../../src/shared/ai-gateway/ai-gateway.provider-error.js';
import { createAiGateway } from '../../src/shared/ai-gateway/ai-gateway.service.js';
import {
  createPinnedDnsLookup,
  fetchAiProviderTransportHardened,
  resolveRedirectUrl,
  resolveSafeAiGatewayAddress,
} from '../../src/shared/ai-gateway/ai-gateway.runtime-ssrf.js';
import { inspectAiGatewayBaseUrl } from '../../src/shared/ai-gateway/ai-gateway.endpoint-policy.js';
import { digestAiProviderTestConfiguration, connectionTestSummary, humanFailure } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';
import {
  AI_PROVIDER_CONNECTION_TEST_PURPOSE,
  aiProviderConnectionTestThrottle,
  buildAiProviderConnectionTestRequest,
  buildConnectionTestFailurePatch,
  buildConnectionTestSuccessPatch,
  classifyConnectionTestFailure,
  connectionTestContainsForbiddenData,
  logConnectionTestObservation,
  noteAiProviderConnectionTestAttempt,
  resetAiProviderConnectionTestThrottleForTests,
  successPatchTouchesEnablementOrRouting,
} from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane-test.pure.js';
import { probeAiProviderConnection } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { isAiGatewayControlPlaneCommand } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.types.js';
import { sanitizeAiGatewayAuditPayload } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';
import type { AiProviderTransport } from '../../src/shared/ai-gateway/providers/ai-provider.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function openaiMessage(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

const testConfig = {
  provider: 'openai' as const,
  model: 'gpt-4.1-mini',
  apiKey: 'sk-test-not-used-in-mocks',
  baseUrl: 'https://api.openai.com/v1',
  timeoutMs: 5_000,
};

test('TAX-641C test command is Owner-only, uses the shared gateway, and sends no legal data', () => {
  assert.equal(isAiGatewayControlPlaneCommand('test_ai_provider_connection'), true);
  assert.equal(capabilityRequiredForOwnerCommand('test_ai_provider_connection'), 'platform_owner_only');
  const request = buildAiProviderConnectionTestRequest();
  assert.equal(request.purpose, AI_PROVIDER_CONNECTION_TEST_PURPOSE);
  assert.equal(connectionTestContainsForbiddenData(request), false);
  assert.doesNotMatch(JSON.stringify(request), /legal_text|tax_knowledge|client_id|ordinance/i);
  const commands = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-commands.service.ts',
  );
  const probe = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.ts',
  );
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  assert.match(commands, /test_ai_provider_connection/);
  assert.match(probe, /createAiGateway/);
  assert.match(probe, /completeStructuredJson/);
  assert.match(probe, /AI_CREDENTIAL_REQUIRED/);
  assert.doesNotMatch(probe, /\bfetch\(/);
  assert.doesNotMatch(probe, /TAX_KNOWLEDGE_AI_API_KEY/);
  assert.doesNotMatch(generate, /test_ai_provider_connection/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/642_ai_gateway_connection_test.sql')), false);
});

test('TAX-641C runtime SSRF rejects private DNS and private redirects without a real network call', async () => {
  const requests: string[] = [];
  await assert.rejects(
    async () => resolveSafeAiGatewayAddress('evil.example', async () => [{ address: '127.0.0.1', family: 4 }]),
    { code: 'AI_ENDPOINT_BLOCKED' },
  );
  await assert.rejects(
    async () => resolveSafeAiGatewayAddress('evil.example', async () => [{ address: '10.0.0.8', family: 4 }]),
    { code: 'AI_ENDPOINT_BLOCKED' },
  );
  await assert.rejects(async () => {
    resolveRedirectUrl(new URL('https://api.openai.com/v1/chat/completions'), 'https://169.254.169.254/latest');
  }, { code: 'AI_ENDPOINT_BLOCKED' });

  await assert.rejects(
    () =>
      fetchAiProviderTransportHardened(
        {
          url: 'https://api.openai.com/v1/chat/completions',
          method: 'POST',
          headers: { Authorization: 'Bearer secret' },
          body: '{}',
          timeoutMs: 1000,
          signal: new AbortController().signal,
        },
        {
          lookup: async () => [{ address: '1.1.1.1', family: 4 }],
          request: async (input) => {
            requests.push(input.url.toString());
            return {
              status: 307,
              bodyText: '',
              retryAfterHeader: null,
              location: 'https://127.0.0.1/v1/chat/completions',
            };
          },
        },
      ),
    { code: 'AI_ENDPOINT_BLOCKED' },
  );
  assert.equal(requests.length, 1);
  assert.equal(inspectAiGatewayBaseUrl('https://127.0.0.1/v1').ok, false);
});

test('pinned DNS lookup supports Node 22 lookup { all: true } without ERR_INVALID_IP_ADDRESS', async () => {
  const pin = { address: '203.0.113.10', family: 4 as const };
  const lookup = createPinnedDnsLookup(pin);

  const allAddresses = await new Promise<unknown>((resolve, reject) => {
    lookup('api.openai.com', { all: true, hints: 0 }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
  assert.deepEqual(allAddresses, [{ address: '203.0.113.10', family: 4 }]);
  assert.equal(Array.isArray(allAddresses), true);
  assert.equal((allAddresses as { address: string }[])[0]?.address, '203.0.113.10');

  const one = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup('api.openai.com', { family: 4 }, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address: address as string, family: family as number });
    });
  });
  assert.equal(one.address, '203.0.113.10');
  assert.equal(one.family, 4);

  const error = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'api.openai.com',
        servername: 'api.openai.com',
        port: 1,
        path: '/',
        method: 'GET',
        lookup: createPinnedDnsLookup({ address: '127.0.0.1', family: 4 }),
      },
      (res) => {
        res.resume();
        reject(new Error(`unexpected HTTP ${res.statusCode}`));
      },
    );
    req.on('error', (err) => resolve(err as NodeJS.ErrnoException));
    req.end();
  });
  assert.notEqual(error.code, 'ERR_INVALID_IP_ADDRESS');
  assert.notEqual(error.message, 'Invalid IP address: undefined');
});

test('TAX-641C mocked provider outcomes are sanitized and do not certify failures', async () => {
  const auth = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 401, bodyText: '{"error":"invalid_api_key"}', retryAfterMs: null }),
  });
  assert.equal(auth.ok, false);
  if (auth.ok) throw new Error('expected failure');
  assert.equal(auth.category, 'auth_rejected');
  assert.equal(auth.http_status, 401);

  const timeout = await probeAiProviderConnection(testConfig, {
    transport: async () => {
      const error = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      throw error;
    },
  });
  assert.equal(timeout.ok, false);
  if (timeout.ok) throw new Error('expected failure');
  assert.equal(timeout.category, 'timeout');

  const rate = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 429, bodyText: 'slow down', retryAfterMs: 100 }),
  });
  assert.equal(rate.ok, false);
  if (rate.ok) throw new Error('expected failure');
  assert.equal(rate.category, 'rate_limited');
  assert.equal(rate.http_status, 429);

  const incompatible = await probeAiProviderConnection(testConfig, {
    transport: async () => ({
      status: 200,
      bodyText: openaiMessage('{"status":"nope"}'),
      retryAfterMs: null,
    }),
  });
  assert.equal(incompatible.ok, false);
  if (incompatible.ok) throw new Error('expected failure');
  assert.equal(incompatible.category, 'structured_output_invalid');
  assert.equal(incompatible.structuredOutputFailed, true);

  const classified = classifyConnectionTestFailure({
    error: new AiGatewayError(AI_ERROR_CODES.AI_ENDPOINT_BLOCKED),
    lastStatus: null,
  });
  assert.equal(classified.category, 'endpoint_blocked');
});

test('TAX-641C successful tiny structured response certifies the current digest and does not enable or route', async () => {
  const transport: AiProviderTransport = async () => ({
    status: 200,
    bodyText: openaiMessage('{"status":"ok"}'),
    retryAfterMs: null,
  });
  const result = await probeAiProviderConnection(testConfig, { transport });
  assert.equal(result.ok, true);
  const digest = digestAiProviderTestConfiguration({
    adapter_type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    pinned_model: 'gpt-4.1-mini',
    credential_updated_at: '2026-09-17T12:00:00.000Z',
  });
  const patch = buildConnectionTestSuccessPatch('2026-09-17T12:01:00.000Z', digest);
  assert.equal(patch.structured_output_certified, true);
  assert.equal(patch.compatibility_status, 'compatible');
  assert.equal(patch.last_test_outcome, 'passed');
  assert.equal(patch.last_test_configuration_digest, digest);
  assert.equal(successPatchTouchesEnablementOrRouting(patch), false);
  assert.equal('enabled' in patch, false);
  const stale = digestAiProviderTestConfiguration({
    adapter_type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    pinned_model: 'gpt-4.1',
    credential_updated_at: '2026-09-17T12:00:00.000Z',
  });
  assert.notEqual(stale, digest);
  const failure = buildConnectionTestFailurePatch({
    enabled: false,
    nowIso: '2026-09-17T12:02:00.000Z',
    category: 'auth_rejected',
    structuredOutputFailed: false,
  });
  assert.equal(failure.enabled, undefined);
  assert.equal(failure.last_test_outcome, 'failed');
  assert.equal(connectionTestSummary({
    last_test_at: '2026-09-17T12:01:00.000Z',
    last_test_outcome: 'passed',
    last_success_at: '2026-09-17T12:01:00.000Z',
    last_failure_at: null,
    last_failure_category: null,
  }), 'Tested successfully');
  assert.match(
    connectionTestSummary({
      last_test_at: '2026-09-17T12:02:00.000Z',
      last_test_outcome: 'failed',
      last_success_at: null,
      last_failure_at: '2026-09-17T12:02:00.000Z',
      last_failure_category: 'auth_rejected',
    }),
    /Test failed: Authentication failed/,
  );
});

test('TAX-641C audit sanitizer and throttle keep secrets and raw bodies out', () => {
  resetAiProviderConnectionTestThrottleForTests();
  const cleaned = sanitizeAiGatewayAuditPayload({
    ai_provider_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    outcome: 'failed',
    failure_category: 'auth_rejected',
    credential: 'sk-live-secret-value',
    prompt: 'hidden',
    completion: openaiMessage('secret'),
  });
  assert.equal(cleaned.outcome, 'failed');
  assert.equal('credential' in cleaned, false);
  assert.equal('prompt' in cleaned, false);
  assert.equal('completion' in cleaned, false);
  assert.doesNotMatch(JSON.stringify(cleaned), /sk-live|choices/);
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const t0 = Date.parse('2026-09-17T12:00:00.000Z');
  assert.equal(aiProviderConnectionTestThrottle(id, null, t0).throttled, false);
  noteAiProviderConnectionTestAttempt(id, t0);
  const again = aiProviderConnectionTestThrottle(id, null, t0 + 1000);
  assert.equal(again.throttled, true);
  assert.equal(aiProviderConnectionTestThrottle(id, null, t0 + 21_000).throttled, false);
});

test('TAX-641C instance probe does not use env bootstrap or fallback routing', async () => {
  const probe = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.ts',
  );
  const service = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts');
  assert.match(probe, /invocationConfig/);
  assert.doesNotMatch(probe, /TAX_KNOWLEDGE_AI_/);
  assert.doesNotMatch(probe, /ai_gateway_routing/);
  assert.doesNotMatch(probe, /enabled:\s*true/);
  assert.match(service, /invocationConfig/);
  const gateway = createAiGateway({
    invocationConfig: testConfig,
    maxAttempts: 1,
    resolveOwnerRoutes: async () => {
      throw new Error('test connection must not load owner routing');
    },
    transport: async () => ({
      status: 200,
      bodyText: openaiMessage('{"status":"ok"}'),
      retryAfterMs: null,
    }),
  });
  assert.equal(typeof gateway.completeStructuredJson, 'function');
  const result = await gateway.completeStructuredJson(buildAiProviderConnectionTestRequest());
  assert.equal(result.outcome, 'success');
  assert.equal(result.telemetry.routing_source, 'pinned');
  assert.equal(result.telemetry.failover_occurred, false);
});

test('connection-test observability classifies HTTP status without logging secrets or bodies', async () => {
  const secret = 'sk-live-secret-observability-1234567890';
  const authBody = JSON.stringify({
    error: {
      message: `Incorrect API key provided: ${secret}`,
      type: 'invalid_request_error',
      code: 'invalid_api_key',
      param: null,
    },
  });
  const auth = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 401, bodyText: authBody, retryAfterMs: null }),
  });
  assert.equal(auth.ok, false);
  if (auth.ok) throw new Error('expected failure');
  assert.equal(auth.category, 'auth_rejected');
  assert.equal(auth.http_status, 401);
  assert.equal(auth.provider_error_code, 'invalid_api_key');

  const modelBody = JSON.stringify({
    error: {
      message: 'The model `gpt-5.4-2026-03-05` does not exist or you do not have access to it.',
      type: 'invalid_request_error',
      param: 'model',
      code: 'model_not_found',
    },
  });
  const model = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 400, bodyText: modelBody, retryAfterMs: null }),
  });
  assert.equal(model.ok, false);
  if (model.ok) throw new Error('expected failure');
  assert.equal(model.category, 'model_unavailable');
  assert.equal(model.http_status, 400);
  assert.equal(model.provider_error_code, 'model_not_found');

  const missing = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 404, bodyText: '{"error":{"code":"not_found"}}', retryAfterMs: null }),
  });
  assert.equal(missing.ok, false);
  if (missing.ok) throw new Error('expected failure');
  assert.equal(missing.category, 'model_unavailable');
  assert.equal(missing.http_status, 404);

  const unavailable = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 503, bodyText: `provider down ${secret}`, retryAfterMs: null }),
  });
  assert.equal(unavailable.ok, false);
  if (unavailable.ok) throw new Error('expected failure');
  assert.equal(unavailable.category, 'provider_unavailable');
  assert.equal(unavailable.http_status, 503);

  const hint = extractSafeProviderErrorHint(authBody);
  assert.equal(hint.code, 'invalid_api_key');
  assert.equal(isAuthProviderErrorCode(hint.code), true);
  assert.doesNotMatch(JSON.stringify(hint), new RegExp(secret));
  assert.equal(isModelProviderErrorCode('model_not_found', null), true);
  assert.equal(
    extractSafeProviderErrorHint('{"error":{"message":"leak this legal_text ordinance","code":"sk-not-a-code"}}').code,
    null,
  );

  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const logged = logConnectionTestObservation(
    {
      correlation_id: 'corr-test-641g',
      http_status: 401,
      provider_error_code: 'invalid_api_key',
      failure_category: 'auth_rejected',
      outcome: 'failed',
      latency_ms: 12,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      endpoint: 'POST /chat/completions',
    },
    (event, payload) => events.push({ event, payload }),
  );
  assert.equal(events[0]?.event, '[ai-gateway]');
  assert.equal(logged.purpose, AI_PROVIDER_CONNECTION_TEST_PURPOSE);
  assert.equal(logged.correlation_id, 'corr-test-641g');
  assert.equal(logged.http_status, 401);
  assert.equal(logged.provider_error_code, 'invalid_api_key');
  assert.equal(logged.failure_category, 'auth_rejected');
  assert.equal(logged.endpoint, 'POST /chat/completions');
  assertSafeTelemetryPayload(logged);
  const encoded = JSON.stringify(events);
  assert.doesNotMatch(encoded, new RegExp(secret));
  assert.doesNotMatch(encoded, /Authorization|Bearer |legal_text|"choices"/i);
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'body'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'bodyText'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'prompt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'completion'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'headers'), false);
  assert.throws(() => assertSafeTelemetryPayload({ body: authBody, prompt: 'nope' }));

  assert.equal(humanFailure('auth_rejected'), 'Authentication failed.');
  assert.equal(humanFailure('model_unavailable'), 'Model unavailable.');
  assert.equal(humanFailure('rate_limited'), 'Rate limited.');
  assert.equal(humanFailure('provider_unavailable'), 'Provider unavailable.');
  assert.match(
    connectionTestSummary({
      last_test_at: '2026-09-18T12:00:00.000Z',
      last_test_outcome: 'failed',
      last_success_at: null,
      last_failure_at: '2026-09-18T12:00:00.000Z',
      last_failure_category: 'model_unavailable',
    }),
    /Test failed: Model unavailable/,
  );

  const classified400 = classifyConnectionTestFailure({
    error: new AiGatewayError(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE),
    lastStatus: 400,
    providerErrorCode: 'model_not_found',
    providerErrorParam: 'model',
  });
  assert.equal(classified400.category, 'model_unavailable');

  const probeSource = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.ts',
  );
  const hop = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts');
  assert.match(probeSource, /logConnectionTestObservation/);
  assert.match(probeSource, /log:\s*\(\)\s*=>\s*undefined/);
  assert.doesNotMatch(probeSource, /lastBodyText[,;].*console/);
  assert.match(hop, /if \(response\.status === 401 \|\| response\.status === 403\)/);
  assert.match(hop, /code: AI_ERROR_CODES\.AI_PROVIDER_UNAVAILABLE/);
});
