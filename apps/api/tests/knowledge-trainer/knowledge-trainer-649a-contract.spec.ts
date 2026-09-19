import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capabilityRequiredForOwnerCommand,
  evaluateOwnerLegalCommandAccess,
} from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/645_legal_ingestion_owner_workspace_selection.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-649A persists Owner workspace selection through a named command and refreshed aggregate', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-workspace-selection.service.ts');
  const resolve = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts',
  );
  const live648b = readRepo('apps/api/tests/knowledge-trainer/knowledge-trainer-648b-publish.spec.ts');
  const live648c = readRepo('apps/api/tests/knowledge-trainer/knowledge-trainer-648c-publication-foundation.spec.ts');

  assert.match(sql, /legal_ingestion_owner_workspace_selection/);
  assert.match(sql, /Owner workspace state only/);
  assert.match(sql, /grant select, insert, update, delete on table public\.legal_ingestion_owner_workspace_selection to service_role/);
  assert.doesNotMatch(sql, /grant [^\n]+legal_ingestion_owner_workspace_selection[^\n]+to (anon|authenticated|public)/i);

  assert.match(types, /'select_legal_training_document'/);
  assert.match(commands, /case 'select_legal_training_document':/);
  assert.match(commands, /handleSelectLegalTrainingDocument/);
  assert.match(commands, /persistOwnerWorkspaceSelectedDocument/);
  assert.match(commands, /refreshed: await refreshed\(/);
  assert.doesNotMatch(commands, /method:\s*['"]PATCH['"]/);
  assert.equal(capabilityRequiredForOwnerCommand('select_legal_training_document'), 'legal_knowledge.view');
  assert.notEqual(capabilityRequiredForOwnerCommand('select_legal_training_document'), 'legal_knowledge.activate');
  assert.match(resolve, /select_legal_training_document/);
  assert.equal(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view'] } },
      'select_legal_training_document',
      'US',
    ).ok,
    false,
  );
  assert.equal(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view'] } },
      'select_legal_training_document',
      'IL',
    ).ok,
    true,
  );

  assert.match(persist, /legal_ingestion_owner_workspace_selection/);
  assert.match(read, /resolveKnowledgeTrainerSelectedDocumentId/);
  assert.match(read, /loadOwnerWorkspaceSelectedDocumentId/);
  assert.doesNotMatch(read, /opts\?\.document_id \|\| filtered\[0\]/);
  assert.doesNotMatch(read, /filtered\[0\]\?\.id/);
  assert.match(commands, /handleUpload[\s\S]*persistOwnerWorkspaceSelectedDocument/);
  assert.doesNotMatch(live648b, /persistOwnerWorkspaceSelectedDocument/);
  assert.doesNotMatch(live648c, /persistOwnerWorkspaceSelectedDocument/);
  assert.doesNotMatch(commands, /activate_tax_rule_version/);
});

test('TAX-649A pack/ruleset resolution fails closed when more than one enabled pack qualifies', () => {
  const service = readRepo('apps/api/src/domains/country-pack/legal-value.service.ts');
  const pure = readRepo('apps/api/src/domains/country-pack/owner-legal-value-ruleset.pure.ts');
  assert.match(pure, /qualifying\.length === 1/);
  assert.match(pure, /ownerLegalValueRulesetAmbiguousMessage/);
  assert.match(service, /matches\.length > 1/);
  assert.match(service, /ownerLegalValueRulesetAmbiguousMessage/);
  assert.doesNotMatch(service, /enabledPacks\[0\]/);
});
