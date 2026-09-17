import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUSINESS_SETUP_AI_OWNER_NAV, parseOwnerWorkspaceNavigation } from '../src/pages/owner-business-setup-ai-nav.ts';
import {
  CreateProviderModal,
  CredentialModal,
  OwnerAiGatewayControlCenter,
} from '../src/pages/owner-ai-gateway-panel.tsx';
import {
  ownerAiGatewayAction,
  ownerAiGatewayRoutingLabel,
  ownerAiGatewayStatusPresentation,
  ownerAiGatewayTestPresentation,
  parseOwnerAiGatewayAggregate,
  parseOwnerAiGatewayCommandRefreshed,
  type OwnerAiGatewayView,
} from '../src/pages/owner-ai-gateway-panel.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const SECRET = 'sk-live-never-render-this-ciphertext';

function sampleAggregate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aggregate_key: 'owner_ai_gateway_aggregate',
    overall_status: 'degraded',
    overall_reason: 'Primary is healthy; fallback is degraded.',
    circuit_state: { openai: 'open' },
    env_bootstrap: { api_key: SECRET },
    providers: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        display_name: 'Primary OpenAI',
        adapter_type: 'openai_compatible',
        adapter_label: 'OpenAI-compatible',
        role: 'Primary',
        routing_position: 1,
        base_url_display: 'https://api.example.test',
        enabled: true,
        pinned_model: 'gpt-4.1-mini',
        credential_configured: true,
        credential_updated_at: '2026-09-17T10:00:00.000Z',
        credential_ciphertext: SECRET,
        credential: SECRET,
        health_status: 'healthy',
        health_reason: 'Last connection test passed.',
        connection_test_summary: 'Tested successfully',
        last_test_outcome: 'passed',
        can_enable: false,
        eligible_for_routing: true,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        display_name: 'Fallback Future',
        adapter_type: 'future_adapter',
        adapter_label: 'Future Labs',
        role: 'Fallback 1',
        routing_position: 2,
        enabled: false,
        pinned_model: 'future-1',
        credential_configured: false,
        credential_updated_at: null,
        health_status: 'not_configured',
        health_reason: 'Credential is not configured.',
        connection_test_summary: 'Not tested yet.',
        last_test_outcome: null,
        can_enable: false,
        eligible_for_routing: false,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        display_name: 'Ready to enable',
        adapter_type: 'openai_compatible',
        adapter_label: 'OpenAI-compatible',
        role: 'Not routed',
        routing_position: null,
        enabled: false,
        pinned_model: 'gpt-4.1-mini',
        credential_configured: true,
        credential_updated_at: '2026-09-17T11:00:00.000Z',
        health_status: 'degraded',
        health_reason: 'Tested, not enabled.',
        connection_test_summary: 'Tested successfully',
        last_test_outcome: 'passed',
        can_enable: true,
        eligible_for_routing: false,
      },
    ],
    routing: [
      { position: 1, role: 'Primary', provider_id: '11111111-1111-4111-8111-111111111111' },
      { position: 2, role: 'Fallback 1', provider_id: '22222222-2222-4222-8222-222222222222' },
    ],
    available_adapter_types: [
      {
        adapter_type: 'openai_compatible',
        label: 'OpenAI-compatible',
        supports_custom_base_url: true,
        requires_structured_output: true,
        requires_pinned_model: true,
      },
      {
        adapter_type: 'future_adapter',
        label: 'Future Labs',
        supports_custom_base_url: false,
        requires_structured_output: true,
        requires_pinned_model: true,
      },
    ],
    allowed_actions: [
      { action_key: 'create_ai_provider', enabled: true, reason: null, payload: {} },
      { action_key: 'update_ai_provider_configuration', enabled: true, reason: null, payload: {} },
      { action_key: 'set_ai_provider_credential', enabled: true, reason: null, payload: {} },
      { action_key: 'test_ai_provider_connection', enabled: true, reason: null, payload: {} },
      { action_key: 'enable_ai_provider', enabled: true, reason: null, payload: {} },
      { action_key: 'disable_ai_provider', enabled: true, reason: null, payload: {} },
      { action_key: 'set_ai_provider_routing', enabled: true, reason: null, payload: {} },
    ],
    ...overrides,
  };
}

function parsedSample(overrides: Record<string, unknown> = {}): OwnerAiGatewayView {
  const parsed = parseOwnerAiGatewayAggregate(sampleAggregate(overrides));
  assert.ok(parsed);
  return parsed;
}

test('sidebar entry is Owner ADMINISTRATION AI Gateway, not tenant AppShell', () => {
  const backendNav = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const nav = readRepo('apps/web/src/pages/owner-business-setup-ai-nav.ts');
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const app = readRepo('apps/web/src/App.tsx');
  const shell = readRepo('apps/web/src/components/layout/AppShell.tsx');
  assert.match(backendNav, /group: 'ADMINISTRATION'/);
  assert.match(backendNav, /id: 'ai-gateway', label: 'AI Gateway'/);
  assert.match(nav, /'ai-gateway'/);
  assert.match(page, /canShowAiGateway/);
  assert.match(page, /OwnerAiGatewayPanel/);
  assert.match(page, /navigate\('\/platform-owner\/ai-gateway'\)/);
  assert.match(app, /path="\/platform-owner\/ai-gateway"/);
  assert.doesNotMatch(shell, /ai-gateway|AI Gateway/);
  assert.equal(
    BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.id)).includes('ai-gateway'),
    false,
  );
  const parsed = parseOwnerWorkspaceNavigation([
    {
      group: 'ADMINISTRATION',
      items: [
        { id: 'access-experts', label: 'Access & Experts' },
        { id: 'ai-gateway', label: 'AI Gateway' },
      ],
    },
  ]);
  assert.equal(parsed?.[0]?.items.some((item) => item.id === 'ai-gateway'), true);
});

test('route is Owner-only chrome, not a separate admin app', () => {
  const app = readRepo('apps/web/src/App.tsx');
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const login = readRepo('apps/web/src/pages/PlatformOwnerLogin.tsx');
  assert.match(app, /path="\/platform-owner\/ai-gateway"/);
  assert.match(app, /<PlatformOwnerLegalControl \/>/);
  assert.doesNotMatch(app, /createBrowserRouter|AdminApp|owner-admin/);
  assert.match(page, /\/platform-owner\/login\?redirect=/);
  assert.match(page, /\/platform-owner\/ai-gateway/);
  assert.match(login, /Access denied\. Platform owner only\./);
});

test('aggregate parser keeps owner_ai_gateway_aggregate truth and drops secrets', () => {
  const parsed = parsedSample();
  assert.equal(parsed.aggregate_key, 'owner_ai_gateway_aggregate');
  assert.equal(parsed.overall_status, 'degraded');
  assert.equal(parsed.providers[0]?.role, 'Primary');
  assert.equal(parsed.providers[1]?.role, 'Fallback 1');
  assert.equal(parsed.providers[2]?.role, 'Not routed');
  assert.equal(JSON.stringify(parsed).includes(SECRET), false);
  assert.equal('circuit_state' in parsed, false);
  assert.equal('env_bootstrap' in parsed, false);
});

test('health and test labels come from backend status, not frontend eligibility math', () => {
  assert.deepEqual(ownerAiGatewayStatusPresentation('healthy'), {
    emoji: '🟢',
    label: 'Operational',
    tone: 'ok',
  });
  assert.deepEqual(ownerAiGatewayStatusPresentation('degraded'), {
    emoji: '🟡',
    label: 'Degraded',
    tone: 'warn',
  });
  assert.deepEqual(ownerAiGatewayStatusPresentation('not_configured'), {
    emoji: '🔴',
    label: 'Not configured',
    tone: 'bad',
  });
  assert.deepEqual(ownerAiGatewayStatusPresentation('unavailable'), {
    emoji: '🔴',
    label: 'Unavailable',
    tone: 'bad',
  });
  assert.deepEqual(ownerAiGatewayTestPresentation('Tested successfully', 'passed'), {
    emoji: '🟢',
    text: 'Tested successfully',
  });
  assert.deepEqual(ownerAiGatewayTestPresentation('Test failed: timeout', 'failed'), {
    emoji: '🔴',
    text: 'Test failed: timeout',
  });
  assert.equal(ownerAiGatewayRoutingLabel(0), 'Primary');
  assert.equal(ownerAiGatewayRoutingLabel(1), 'Fallback 1');
  assert.equal(ownerAiGatewayRoutingLabel(2), 'Fallback 2');
});

test('control center renders provider cards, roles, health, and no ciphertext', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerAiGatewayControlCenter, {
      aggregate: parsedSample(),
      busy: false,
      testingProviderId: null,
      error: '',
      onCommand: async () => undefined,
    }),
  );
  assert.match(html, /AI Gateway/);
  assert.match(html, /Overall status: Degraded/);
  assert.match(html, /Primary OpenAI/);
  assert.match(html, /Fallback Future/);
  assert.match(html, /Ready to enable/);
  assert.match(html, /Primary/);
  assert.match(html, /Fallback 1/);
  assert.match(html, /Not routed/);
  assert.match(html, /Operational/);
  assert.match(html, /Not configured/);
  assert.match(html, /Configured/);
  assert.match(html, /Enabled/);
  assert.match(html, /Disabled/);
  assert.match(html, /Tested successfully/);
  assert.match(html, /gpt-4\.1-mini/);
  assert.match(html, /Future Labs/);
  assert.match(html, /\+ Add provider/);
  assert.match(html, /Test connection/);
  assert.match(html, /Edit/);
  assert.match(html, /Enable/);
  assert.match(html, /Disable/);
  assert.doesNotMatch(html, new RegExp(SECRET));
  assert.doesNotMatch(html, /ciphertext|circuit_state|stack trace|sk-live/i);
  assert.doesNotMatch(html, /\{&quot;adapter_type&quot;/);
});

test('enable and disable buttons follow backend can_enable / enabled flags', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerAiGatewayControlCenter, {
      aggregate: parsedSample(),
      busy: false,
      testingProviderId: null,
      error: '',
      onCommand: async () => undefined,
    }),
  );
  assert.match(html, /data-action-key="enable_ai_provider"/);
  assert.match(html, /data-action-key="disable_ai_provider"/);
  const blocked = parsedSample();
  blocked.providers = blocked.providers.map((row) => ({ ...row, can_enable: false, enabled: false }));
  blocked.allowed_actions = blocked.allowed_actions.map((row) =>
    row.action_key === 'enable_ai_provider' || row.action_key === 'disable_ai_provider'
      ? { ...row, enabled: false }
      : row,
  );
  const blockedHtml = renderToStaticMarkup(
    createElement(OwnerAiGatewayControlCenter, {
      aggregate: blocked,
      busy: false,
      testingProviderId: null,
      error: '',
      onCommand: async () => undefined,
    }),
  );
  assert.doesNotMatch(blockedHtml, /data-action-key="enable_ai_provider"/);
  assert.doesNotMatch(blockedHtml, /data-action-key="disable_ai_provider"/);
});

test('routing save sends ordered provider IDs only', () => {
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  assert.match(panel, /onCommand\('set_ai_provider_routing', \{ provider_ids: routingIds \}\)/);
  assert.doesNotMatch(panel, /eligible_for_routing\s*&&\s*row\.enabled/);
  assert.doesNotMatch(panel, /evaluateAiProviderEnablement|isOwnerRouteEligible|deriveAiProviderHealth/);
  const html = renderToStaticMarkup(
    createElement(OwnerAiGatewayControlCenter, {
      aggregate: parsedSample(),
      busy: false,
      testingProviderId: null,
      error: '',
      onCommand: async () => undefined,
    }),
  );
  assert.match(html, /Primary/);
  assert.match(html, /Fallback 1/);
  assert.match(html, /Save routing/);
  assert.match(html, /data-action-key="set_ai_provider_routing"/);
});

test('create provider form uses adapter registry and does not ask for credential', () => {
  const html = renderToStaticMarkup(
    createElement(CreateProviderModal, {
      adapters: parsedSample().available_adapter_types,
      busy: false,
      onClose: () => undefined,
      onSubmit: async () => undefined,
    }),
  );
  assert.match(html, /Add provider/);
  assert.match(html, /OpenAI-compatible/);
  assert.match(html, /Future Labs/);
  assert.match(html, /Custom endpoint/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /name="nx-ai-provider-credential"/);
  const futureOnly = renderToStaticMarkup(
    createElement(CreateProviderModal, {
      adapters: parsedSample().available_adapter_types.filter((row) => row.adapter_type === 'future_adapter'),
      busy: false,
      onClose: () => undefined,
      onSubmit: async () => undefined,
    }),
  );
  assert.match(futureOnly, /Future Labs/);
  assert.doesNotMatch(futureOnly, /Custom endpoint/);
});

test('credential input is write-only password and is cleared before submit', () => {
  const html = renderToStaticMarkup(
    createElement(CredentialModal, {
      busy: false,
      onClose: () => undefined,
      onSubmit: async () => undefined,
    }),
  );
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.doesNotMatch(html, new RegExp(SECRET));
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  assert.match(panel, /const value = credential;\s*setCredential\(''\);/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /console\.(log|info|debug|warn)\(.*credential/);
});

test('test connection shows progress then refreshed aggregate copy', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerAiGatewayControlCenter, {
      aggregate: parsedSample(),
      busy: true,
      testingProviderId: '11111111-1111-4111-8111-111111111111',
      error: '',
      onCommand: async () => undefined,
    }),
  );
  assert.match(html, /Testing connection…/);
  assert.match(html, /data-action-key="test_ai_provider_connection"/);
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  assert.match(panel, /test_ai_provider_connection/);
  assert.match(panel, /setTestingProviderId/);
  assert.doesNotMatch(panel, /enable_ai_provider.*test_ai_provider_connection/);
});

test('edit configuration is limited to display name, pinned model, and allowed base URL', () => {
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  assert.match(panel, /update_ai_provider_configuration/);
  assert.match(panel, /Changing the model or endpoint requires a new connection test/);
  assert.match(panel, /adapter\?\.supports_custom_base_url/);
  assert.doesNotMatch(panel, /credential_ciphertext|structured_output_certified/);
});

test('refreshed aggregate replaces panel state after commands', () => {
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  assert.match(panel, /OWNER\.aiGateway/);
  assert.match(panel, /OWNER\.command/);
  assert.match(panel, /parseOwnerAiGatewayCommandRefreshed\(out\.refreshed\)/);
  assert.match(panel, /setAggregate\(parsed\)/);
  assert.doesNotMatch(panel, /legalControl|OWNER\.legalControl/);
  const next = parseOwnerAiGatewayCommandRefreshed({
    aggregate_key: 'owner_ai_gateway_aggregate',
    overall_status: 'healthy',
    overall_reason: 'All routed providers are healthy.',
    providers: [],
    routing: [],
    available_adapter_types: [],
    allowed_actions: [],
  });
  assert.equal(next?.overall_status, 'healthy');
  const wrapped = parseOwnerAiGatewayCommandRefreshed({
    aggregate: sampleAggregate({ overall_status: 'unavailable', overall_reason: 'No routed provider.' }),
  });
  assert.equal(wrapped?.overall_status, 'unavailable');
});

test('frontend does not invent adapter protocols or eligibility', () => {
  const panel = readRepo('apps/web/src/pages/owner-ai-gateway-panel.tsx');
  const pure = readRepo('apps/web/src/pages/owner-ai-gateway-panel.pure.ts');
  assert.match(panel, /available_adapter_types/);
  assert.match(panel, /Adapter required/);
  assert.doesNotMatch(panel, /openai_compatible ===|adapter_type === 'openai'/);
  assert.doesNotMatch(pure, /evaluateAiProviderEnablement|isOwnerRouteEligible/);
  assert.equal(ownerAiGatewayAction(parsedSample(), 'create_ai_provider')?.enabled, true);
});
