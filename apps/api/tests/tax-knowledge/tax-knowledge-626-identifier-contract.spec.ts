import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const migrationRel = 'supabase/migrations/626_exact_legal_identifiers.sql';
const frozen = [
  'supabase/migrations/620_owner_country_legal_access.sql',
  'supabase/migrations/621_country_localization.sql',
  'supabase/migrations/622_tax_legal_library_foundation.sql',
  'supabase/migrations/623_legal_value_version_authorities.sql',
  'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql',
  'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql',
];

test('TAX-626 migration is additive and does not write canonical law', () => {
  const sql = readRepo(migrationRel);
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  for (const table of ['legal_ingestion_candidates', 'tax_legal_nodes']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*source_display_identifier text null`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*normalized_machine_identifier text null`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*identifier_base_number text null`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*identifier_letter_suffix text null`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*identifier_nested_components jsonb not null default`));
  }
  assert.match(sql, /legal_identifier_nested_components_valid/);
  assert.match(sql, /jsonb_typeof\(elem\) <> 'string'/);
  assert.match(sql, /uq_tax_legal_nodes_child_legal_identity/);
  assert.match(sql, /uq_tax_legal_nodes_root_legal_identity/);
  assert.match(sql, /parent_node_id is not null/);
  assert.match(sql, /parent_node_id is null/);
  assert.match(sql, /idx_legal_ingestion_candidates_job_identity/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_candidates/i);
  assert.doesNotMatch(sql, /update public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /accept_legal_structure_candidate/);
  assert.doesNotMatch(sql, /status = 'active'/);
  assert.doesNotMatch(sql, /פסקה|תת-פסקה|tax_legal_node_kinds/);
  assert.match(sql, /Does not insert canonical law/);
  assert.match(sql, /node_number/);
});

test('TAX-626 leaves 620–625 files in place and does not rewrite them', () => {
  for (const rel of frozen) {
    assert.equal(existsSync(join(repoRoot, rel)), true, rel);
    assert.doesNotMatch(readRepo(rel), /source_display_identifier/);
    assert.doesNotMatch(readRepo(rel), /normalized_machine_identifier/);
  }
});

test('TAX-626 accept copies identifier fields into create_tax_legal_node', () => {
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  assert.match(commands, /identifierPayloadForCanonicalCreate/);
  assert.match(commands, /create_tax_legal_node/);
  assert.match(commands, /source_display_identifier/);
  const create = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(create, /resolveLegalIdentifierFromPayload/);
  assert.match(create, /source_display_identifier/);
  assert.match(create, /uq_tax_legal_nodes_child_legal_identity|legal identity already exists|exact identifier already exists/);
});

test('TAX-626 frontend displays backend identifier and does not reconstruct it', () => {
  const library = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  assert.match(library, /Legal identifier/);
  assert.match(library, /source_display_identifier/);
  assert.doesNotMatch(library, /nodeNumber\.trim\(\) \+ ['"`]\(/);
  assert.match(trainer, /Legal identifier/);
  assert.match(trainer, /source_display_identifier/);
  assert.match(trainer, /display_label/);
  assert.doesNotMatch(trainer, /node_number \|\| ''\} \{row\.title/);
  assert.doesNotMatch(trainer, /\$\{.*node_number.*\}\(/);
  assert.doesNotMatch(library, /parseLegalIdentifier/);
  assert.doesNotMatch(trainer, /parseLegalIdentifier/);
});
