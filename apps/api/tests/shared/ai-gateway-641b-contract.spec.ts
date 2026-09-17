import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-641B Owner aggregate and commands are Platform Owner only and return refreshed Control Plane truth', () => {
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  const commands = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-commands.service.ts',
  );
  const read = readRepo('apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-read.service.ts');
  const registry = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.adapters.ts');
  const audit = readRepo('apps/api/src/shared/audit-events.ts');
  const access = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');

  assert.match(routes, /router.get\('\/ai-gateway'/);
  assert.match(routes, /buildOwnerAiGatewayAggregate/);
  assert.match(routes, /isAiGatewayControlPlaneCommand/);
  assert.match(routes, /assertOwnerOrAuditFailure/);
  assert.match(commands, /create_ai_provider/);
  assert.match(commands, /update_ai_provider_configuration/);
  assert.match(commands, /set_ai_provider_credential/);
  assert.match(commands, /remove_ai_provider_credential/);
  assert.match(commands, /enable_ai_provider/);
  assert.match(commands, /disable_ai_provider/);
  assert.match(commands, /set_ai_provider_routing/);
  assert.match(commands, /test_ai_provider_connection/);
  assert.match(commands, /assertPlatformOwner/);
  assert.match(commands, /encryptJson/);
  assert.match(commands, /removeProviderFromRouting/);
  assert.match(commands, /refreshed: await refreshed\(ctx\)/);
  const types = readRepo('apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane.types.ts');
  const cardBlock = types.slice(
    types.indexOf('export type OwnerAiGatewayProviderCard'),
    types.indexOf('export type OwnerAiGatewayAggregate'),
  );
  assert.match(read, /aggregate_key: 'owner_ai_gateway_aggregate'/);
  assert.match(read, /credential_configured: Boolean/);
  assert.doesNotMatch(cardBlock, /credential_ciphertext/);
  assert.doesNotMatch(types, /credential_ciphertext/);
  assert.match(registry, /openai_compatible/);
  assert.match(registry, /Code is the source of truth/);
  assert.match(audit, /AI_PROVIDER_CREATED/);
  assert.match(audit, /AI_PROVIDER_ROUTING_CHANGED/);
  assert.match(access, /command.includes\('ai_provider'\)/);
  assert.equal(capabilityRequiredForOwnerCommand('enable_ai_provider'), 'platform_owner_only');
});

test('TAX-641B does not add UI, failover, circuit breaker, B2, or a migration', () => {
  const commands = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-commands.service.ts',
  );
  const read = readRepo('apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-read.service.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/642_ai_gateway_control_plane_commands.sql')), false);
  assert.doesNotMatch(commands, /fetch\(/);
  assert.doesNotMatch(read, /circuit_open/);
  assert.doesNotMatch(commands, /legal_ingestion_tax_knowledge_proposals/);
  assert.doesNotMatch(commands, /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(generate, /ai_gateway_providers/);
  assert.doesNotMatch(commands, /TAX_KNOWLEDGE_AI_API_KEY/);
});
