import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-642I keeps TAX-639 authoritative and normalizes before B2', () => {
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');
  const prompt = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.ts');
  const context = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-context.service.ts',
  );
  const normalizeIndex = generate.indexOf('const normalizedJson = normalizeTaxKnowledgeProposalExtract');
  const validateIndex = generate.indexOf('const validation = await validateProposal');
  const insertIndex = generate.indexOf('const created = await insertProposal');
  assert.ok(normalizeIndex >= 0);
  assert.ok(validateIndex > normalizeIndex);
  assert.ok(insertIndex > validateIndex);
  assert.match(validator, /fake_evidence_span/);
  assert.match(validator, /const LOCAL_KEY_RE = /);
  assert.doesNotMatch(validator, /normalizeTaxKnowledgeProposalExtract/);
  assert.match(prompt, /TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN/);
  assert.match(prompt, /EXTRACT_JSON_SCHEMA/);
  assert.match(prompt, /You extract legal meaning only/);
  assert.match(context, /legalNodeMatchQueriesForExtraction/);
  assert.match(context, /matched_from/);
});
