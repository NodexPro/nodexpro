import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_ERROR_CODES, AiGatewayError } from '../../src/shared/ai-gateway/ai-gateway.errors.js';
import { createAiGateway } from '../../src/shared/ai-gateway/ai-gateway.service.js';
import {
  fetchAiProviderTransportHardened,
  resolveRedirectUrl,
  resolveSafeAiGatewayAddress,
} from '../../src/shared/ai-gateway/ai-gateway.runtime-ssrf.js';
import { inspectAiGatewayBaseUrl } from '../../src/shared/ai-gateway/ai-gateway.endpoint-policy.js';
import { digestAiProviderTestConfiguration, connectionTestSummary } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';
import {
  AI_PROVIDER_CONNECTION_TEST_PURPOSE,
  aiProviderConnectionTestThrottle,
  buildAiProviderConnectionTestRequest,
  buildConnectionTestFailurePatch,
  buildConnectionTestSuccessPatch,
  classifyConnectionTestFailure,
  connectionTestContainsForbiddenData,
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

test('TAX-641C mocked provider outcomes are sanitized and do not certify failures', async () => {
  const auth = await probeAiProviderConnection(testConfig, {
    transport: async () => ({ status: 401, bodyText: '{"error":"invalid_api_key"}', retryAfterMs: null }),
  });
  assert.equal(auth.ok, false);
  if (auth.ok) throw new Error('expected failure');
  assert.equal(auth.category, 'auth_rejected');

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
    /Test failed: The API key was rejected/,
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
