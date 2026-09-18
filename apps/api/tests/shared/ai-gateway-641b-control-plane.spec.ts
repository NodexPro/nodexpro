import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { inspectAiGatewayBaseUrl } from '../../src/shared/ai-gateway/ai-gateway.endpoint-policy.js';
import {
  isRegisteredAiAdapterType,
  listAiAdapterRegistry,
} from '../../src/shared/ai-gateway/ai-gateway.adapters.js';
import { encryptAiGatewayJson, decryptAiGatewayJson } from '../../src/shared/ai-gateway/ai-gateway.encryption.js';
import {
  asOptionalPinnedModel,
  credentialConfigured,
  digestAiProviderTestConfiguration,
  evaluateAiProviderEnablement,
  parseCreateAiProviderPayload,
  parseRoutingPayload,
  routingRole,
  sanitizeAiGatewayAuditPayload,
  toProviderCard,
  deriveOverallGatewayStatus,
  type AiGatewayControlPlaneProviderRow,
} from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';
import {
  capabilityRequiredForOwnerCommand,
  evaluateOwnerLegalCommandAccess,
} from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { isAiGatewayControlPlaneCommand } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.types.js';
import { assertPlatformOwner } from '../../src/shared/platform-owner.js';

const PROVIDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function row(overrides: Partial<AiGatewayControlPlaneProviderRow> = {}): AiGatewayControlPlaneProviderRow {
  return {
    id: PROVIDER_ID,
    display_name: 'OpenAI',
    adapter_type: 'openai_compatible',
    base_url: null,
    enabled: false,
    pinned_model: 'gpt-4.1-mini',
    credential_configured: false,
    structured_output_certified: false,
    compatibility_status: 'not_tested',
    last_success_at: null,
    last_failure_at: null,
    last_failure_category: null,
    last_test_at: null,
    last_test_outcome: null,
    last_test_configuration_digest: null,
    credential_updated_at: null,
    created_at: '2026-09-17T10:00:00.000Z',
    updated_at: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
}

test('adapter registry ships openai_compatible only and is code-owned', () => {
  const adapters = listAiAdapterRegistry();
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0]?.adapter_type, 'openai_compatible');
  assert.equal(adapters[0]?.supports_custom_base_url, true);
  assert.equal(isRegisteredAiAdapterType('openai_compatible'), true);
  assert.equal(isRegisteredAiAdapterType('anthropic_messages'), false);
});

test('create payload requires a registered adapter, rejects credential, and pins models', () => {
  const parsed = parseCreateAiProviderPayload({
    adapter_type: 'openai_compatible',
    display_name: 'OpenAI',
    pinned_model: 'gpt-4.1-mini',
  });
  assert.equal(parsed.adapter_type, 'openai_compatible');
  assert.throws(
    () => parseCreateAiProviderPayload({ adapter_type: 'made_up', display_name: 'X' }),
    (error: unknown) => error instanceof AppError && error.code === 'AI_ADAPTER_REQUIRED',
  );
  assert.throws(
    () => parseCreateAiProviderPayload({ adapter_type: 'openai_compatible', display_name: 'X', credential: 'sk-test' }),
    (error: unknown) => error instanceof AppError && /credential/.test(error.message),
  );
  assert.throws(
    () => asOptionalPinnedModel('latest'),
    (error: unknown) => error instanceof AppError && error.code === 'AI_MODEL_NOT_PINNED',
  );
  assert.throws(() => asOptionalPinnedModel('gpt-4-latest'));
});

test('SSRF policy rejects dangerous URLs without making a network call', () => {
  assert.equal(inspectAiGatewayBaseUrl('https://api.openai.com/v1').ok, true);
  const blocked = [
    'http://api.openai.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.5/v1',
    'https://192.168.1.8/v1',
    'https://172.16.0.4/v1',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/',
    'https://user:pass@api.openai.com/v1',
    'ftp://api.openai.com/v1',
    'file:///etc/passwd',
  ];
  for (const url of blocked) {
    const result = inspectAiGatewayBaseUrl(url);
    assert.equal(result.ok, false, url);
  }
});

test('enablement is blocked until a matching successful test digest exists', () => {
  const withSecret = row({
    credential_configured: true,
    credential_updated_at: '2026-09-17T10:00:00.000Z',
    enabled: false,
  });
  const blocked = evaluateAiProviderEnablement(withSecret);
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error('expected block');
  assert.equal(blocked.code, 'AI_TEST_REQUIRED');

  const digest = digestAiProviderTestConfiguration({
    adapter_type: withSecret.adapter_type,
    base_url: withSecret.base_url,
    pinned_model: withSecret.pinned_model,
    credential_updated_at: withSecret.credential_updated_at,
  });
  const certified = row({
    credential_configured: true,
    credential_updated_at: '2026-09-17T10:00:00.000Z',
    structured_output_certified: true,
    compatibility_status: 'compatible',
    last_test_outcome: 'passed',
    last_test_configuration_digest: digest,
  });
  assert.equal(evaluateAiProviderEnablement(certified).ok, true);
  const stale = row({
    ...certified,
    pinned_model: 'gpt-4.1',
    last_test_configuration_digest: digest,
  });
  const staleDecision = evaluateAiProviderEnablement(stale);
  assert.equal(staleDecision.ok, false);
});

test('routing payload is backend-owned, capped, and rejects duplicates', () => {
  const ids = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ];
  assert.deepEqual(parseRoutingPayload({ provider_ids: ids }), ids);
  assert.equal(routingRole(1), 'Primary');
  assert.equal(routingRole(2), 'Fallback 1');
  assert.equal(routingRole(null), 'Not routed');
  assert.throws(
    () => parseRoutingPayload({ provider_ids: [ids[0], ids[0]] }),
    (error: unknown) => error instanceof AppError && error.code === 'AI_ROUTING_DUPLICATE',
  );
  assert.throws(
    () =>
      parseRoutingPayload({
        provider_ids: [ids[0], ids[1], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
      }),
    (error: unknown) => error instanceof AppError && error.code === 'AI_ROUTING_CAP',
  );
});

test('disabled and uncertified providers are not eligible for routing', () => {
  const card = toProviderCard(row({ enabled: true, credential_configured: true }), new Map([[PROVIDER_ID, 1]]));
  assert.equal(card.eligible_for_routing, false);
  assert.equal(card.credential_configured, true);
  assert.equal(card.circuit_state, null);
  assert.equal('credential_ciphertext' in card, false);
  const overall = deriveOverallGatewayStatus([card]);
  assert.equal(overall.status, 'unavailable');
});

test('audit sanitizer drops credentials and secret-like values', () => {
  const cleaned = sanitizeAiGatewayAuditPayload({
    ai_provider_id: PROVIDER_ID,
    credential: 'sk-live-secret-value',
    api_key: 'secret',
    credential_ciphertext: 'aaa',
    adapter_type: 'openai_compatible',
  });
  assert.equal('credential' in cleaned, false);
  assert.equal('api_key' in cleaned, false);
  assert.equal('credential_ciphertext' in cleaned, false);
  assert.equal(cleaned.adapter_type, 'openai_compatible');
  assert.doesNotMatch(JSON.stringify(cleaned), /sk-live/);
});

test('credentials encrypt with dedicated AI Gateway AES-256-GCM and are not treated as configured when missing', () => {
  const previousAi = process.env.AI_GATEWAY_ENCRYPTION_KEY;
  const previousClient = process.env.CLIENT_DATA_ENCRYPTION_KEY;
  process.env.AI_GATEWAY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  delete process.env.CLIENT_DATA_ENCRYPTION_KEY;
  try {
    const ciphertext = encryptAiGatewayJson({ value: 'sk-test-not-returned' });
    assert.notEqual(ciphertext, 'sk-test-not-returned');
    assert.doesNotMatch(ciphertext, /sk-test-not-returned/);
    const roundTrip = decryptAiGatewayJson<{ value: string }>(ciphertext);
    assert.equal(roundTrip.value, 'sk-test-not-returned');
    assert.equal(credentialConfigured(row({ credential_configured: true })), true);
    assert.equal(credentialConfigured(row({ credential_configured: false })), false);
  } finally {
    if (previousAi == null) delete process.env.AI_GATEWAY_ENCRYPTION_KEY;
    else process.env.AI_GATEWAY_ENCRYPTION_KEY = previousAi;
    if (previousClient == null) delete process.env.CLIENT_DATA_ENCRYPTION_KEY;
    else process.env.CLIENT_DATA_ENCRYPTION_KEY = previousClient;
  }
});

test('AI Gateway commands are Platform Owner only; tenant context is denied', () => {
  assert.equal(isAiGatewayControlPlaneCommand('create_ai_provider'), true);
  assert.equal(isAiGatewayControlPlaneCommand('test_ai_provider_connection'), true);
  assert.equal(capabilityRequiredForOwnerCommand('create_ai_provider'), 'platform_owner_only');
  assert.equal(capabilityRequiredForOwnerCommand('test_ai_provider_connection'), 'platform_owner_only');
  assert.equal(capabilityRequiredForOwnerCommand('set_ai_provider_routing'), 'platform_owner_only');
  const none = { kind: 'none' as const, capabilitiesByCountry: {} };
  const editor = {
    kind: 'country_legal_maintainer' as const,
    capabilitiesByCountry: { IL: ['legal_knowledge.draft_create'] },
  };
  const owner = { kind: 'platform_owner' as const, capabilitiesByCountry: {} };
  assert.equal(evaluateOwnerLegalCommandAccess(none, 'create_ai_provider', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(editor, 'create_ai_provider', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'create_ai_provider', 'IL').ok, true);
  const tenant = {
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      authUserId: 'x',
      email: 'tenant@example.com',
      fullName: null,
      status: 'active' as const,
      uiLanguage: 'en' as const,
    },
    membership: {
      organizationId: '00000000-0000-0000-0000-000000000088',
      userId: '00000000-0000-0000-0000-000000000099',
      roleId: 'r',
      roleCode: 'admin',
      permissions: ['*'],
    },
    organizationId: '00000000-0000-0000-0000-000000000088',
  };
  assert.throws(
    () => assertPlatformOwner(tenant),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );
});
