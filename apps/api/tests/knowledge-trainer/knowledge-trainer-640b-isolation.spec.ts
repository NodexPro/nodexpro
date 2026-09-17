import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function listTsFiles(relDir: string): string[] {
  const abs = join(repoRoot, relDir);
  return readdirSync(abs)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(relDir, name).replace(/\\/g, '/'));
}

test('TAX-640B provider HTTP stays inside the adapter; Trainer uses only the shared gateway index', () => {
  const trainerFiles = [
    ...listTsFiles('apps/api/src/domains/knowledge-trainer'),
    'apps/api/src/routes/owner-knowledge-trainer.routes.ts',
  ];
  for (const rel of trainerFiles) {
    const text = readRepo(rel);
    assert.doesNotMatch(text, /shared\/ai-gateway\/providers/);
    assert.doesNotMatch(text, /fetchAiProviderTransport/);
    assert.doesNotMatch(text, /from 'openai'|from '@anthropic-ai\/sdk'/);
    if (!rel.endsWith('knowledge-trainer-generate-tax-knowledge-proposal.service.ts')) {
      assert.doesNotMatch(text, /completeStructuredJson/);
      assert.doesNotMatch(text, /shared\/ai-gateway/);
    }
  }
});

test('TAX-640B does not add a provider SDK, WEB env, migration, or canonical writes', () => {
  const apiPkg = readRepo('apps/api/package.json');
  const rootPkg = existsSync(join(repoRoot, 'package.json')) ? readRepo('package.json') : '{}';
  const config = readRepo('apps/api/src/config.ts');
  const index = readRepo('apps/api/src/index.ts');
  const webEnvSample = existsSync(join(repoRoot, 'apps/web/.env')) ? readRepo('apps/web/.env') : '';

  assert.match(apiPkg, /"name": "@zentax\/api"/);
  assert.doesNotMatch(apiPkg, /"openai"|anthropic|@anthropic-ai|@google-ai|openai-azure/i);
  assert.doesNotMatch(rootPkg, /"openai"/);
  assert.match(config, /aiGateway: loadAiGatewayPublicConfig\(\)/);
  assert.doesNotMatch(config, /TAX_KNOWLEDGE_AI_API_KEY:/);
  assert.match(index, /logAiGatewayBootDiagnostic/);
  assert.doesNotMatch(webEnvSample, /VITE_TAX_KNOWLEDGE_AI_/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/641_ai_gateway.sql')), false);
  assert.doesNotMatch(readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts'), /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(
    readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts'),
    /legal_ingestion_tax_knowledge_proposals/,
  );
});

test('TAX-640B provider HTTP stays inside the adapter boundary', () => {
  const service = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts');
  const provider = readRepo('apps/api/src/shared/ai-gateway/providers/openai-compatible.provider.ts');
  const transport = readRepo('apps/api/src/shared/ai-gateway/providers/ai-provider.types.ts');
  assert.match(service, /buildOpenAiCompatibleStructuredRequest/);
  assert.match(provider, /chat\/completions/);
  assert.match(transport, /export async function fetchAiProviderTransport/);
  assert.doesNotMatch(service, /from 'openai'/);
  assert.doesNotMatch(provider, /from 'openai'/);
  assert.doesNotMatch(provider, /from '@anthropic-ai\/sdk'/);
});
