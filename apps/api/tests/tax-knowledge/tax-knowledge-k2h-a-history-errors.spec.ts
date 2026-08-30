import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAX_KNOWLEDGE_ERROR_CODES } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const PANEL = 'apps/web/src/pages/owner-tax-knowledge-panel.tsx';
const TYPES = 'apps/web/src/pages/owner-legal-control-types.ts';
const CLIENT = 'apps/web/src/api/client.ts';
const READ_MODELS = 'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts';
const BACKEND_TYPES = 'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts';
const COMMANDS = 'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts';
const MIGRATION_602 = 'supabase/migrations/602_tax_knowledge_publication_guard.sql';
const MIGRATION_604 = 'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql';
const MIGRATION_605 = 'supabase/migrations/605_tax_knowledge_atomic_supersession.sql';

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
] as const;

const ERROR_CODES = [
  TAX_KNOWLEDGE_ERROR_CODES.ACTIVE_SOURCE_REQUIRED,
  TAX_KNOWLEDGE_ERROR_CODES.RELATIONSHIP_TARGET_NOT_ACTIVE,
  TAX_KNOWLEDGE_ERROR_CODES.ACTIVE_WINDOW_OVERLAP,
  TAX_KNOWLEDGE_ERROR_CODES.INVALID_LIFECYCLE_TRANSITION,
  TAX_KNOWLEDGE_ERROR_CODES.EFFECTIVE_TO_INVALID,
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K2H-A contract: canonical version history fields are selected and mapped', () => {
  const readSrc = readRepo(READ_MODELS);
  const backendTypes = readRepo(BACKEND_TYPES);
  const types = readRepo(TYPES);
  const panel = readRepo(PANEL);

  assert.match(readSrc, /TAX_RULE_VERSION_SELECT =/);
  assert.match(readSrc, /superseded_by_version_id/);
  assert.match(readSrc, /retired_at/);
  assert.match(readSrc, /retired_reason/);
  assert.match(backendTypes, /superseded_by_version_id: string \| null/);
  assert.match(backendTypes, /retired_at: string \| null/);
  assert.match(backendTypes, /retired_reason: string \| null/);
  assert.match(types, /superseded_by_version_id: string \| null/);
  assert.match(types, /retired_at: string \| null/);
  assert.match(types, /retired_reason: string \| null/);
  assert.match(panel, /superseded_by_version_id: asNullableString\(row\.superseded_by_version_id\)/);
  assert.match(panel, /retired_at: asNullableString\(row\.retired_at\)/);
  assert.match(panel, /retired_reason: asNullableString\(row\.retired_reason\)/);
});

test('TAX-K2H-A contract: frontend history display is presentation-only', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /selectedVersion\.superseded_by_version_id/);
  assert.match(panel, /versionPresentationLabel\(\s*selectedVersion\.superseded_by_version_id/);
  assert.match(panel, /selectedVersion\.retired_at/);
  assert.match(panel, /selectedVersion\.retired_reason/);
  assert.doesNotMatch(panel, /audit_log|AUDIT_ACTIONS/);
  assert.doesNotMatch(panel, /latestVersion|newestDraft|latest.?version/i);
  assert.doesNotMatch(panel, /siblings\.find|find\(\(.*superseded/);
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /if \(selectedVersion\.status/);
  assert.doesNotMatch(panel, /publication.?ready|ready to activate|source-readiness/i);
});

test('TAX-K2H-A contract: publication failures use stable backend codes, not message parsing', () => {
  const commands = readRepo(COMMANDS);
  const backendTypes = readRepo(BACKEND_TYPES);
  const client = readRepo(CLIENT);

  assert.match(backendTypes, /export const TAX_KNOWLEDGE_ERROR_CODES/);
  for (const code of ERROR_CODES) {
    assert.match(backendTypes, new RegExp(`'${code}'`));
    assert.match(commands, new RegExp(`TAX_KNOWLEDGE_ERROR_CODES\\.[A-Z_]+,\\s*\\)`));
    assert.match(client, new RegExp(`c === '${code}'`));
  }
  assert.match(
    commands,
    /TAX_KNOWLEDGE_ERROR_CODES\.ACTIVE_SOURCE_REQUIRED/,
  );
  assert.match(
    commands,
    /TAX_KNOWLEDGE_ERROR_CODES\.RELATIONSHIP_TARGET_NOT_ACTIVE/,
  );
  assert.match(commands, /TAX_KNOWLEDGE_ERROR_CODES\.ACTIVE_WINDOW_OVERLAP/);
  assert.doesNotMatch(client, /cannot activate without at least one citation/);
  assert.doesNotMatch(client, /cannot activate while a blocking relationship/);
  assert.doesNotMatch(client, /no_active_overlap|23P01/);
  assert.doesNotMatch(client, /tax_rule_versions_guard_publication/);
  assert.match(client, /c === 'VERSION_CONFLICT' \|\| c === 'CONFLICT'/);
});

test('TAX-K2H-A contract: 602/604 remain DB canonical; 605 unchanged; no new command', () => {
  const sql602 = readRepo(MIGRATION_602);
  const sql604 = readRepo(MIGRATION_604);
  const commands = readRepo(COMMANDS);
  const panel = readRepo(PANEL);

  assert.match(sql602, /cannot activate without at least one citation to an active tax_source/);
  assert.match(sql604, /cannot activate while a blocking relationship points to a non-active tax_rule_version/);
  assert.doesNotMatch(commands, /tax_rule_versions_guard_publication_provenance/);
  assert.doesNotMatch(commands, /tax_rule_versions_guard_publication_relationships/);
  assert.doesNotMatch(panel, /from\('tax_rule_version_sources'\)|src\.status === ['"]active['"]/);
  assert.doesNotMatch(panel, /relationship_type in \(/);
  assert.match(commands, /rpc\('tax_knowledge_supersede_tax_rule_version'/);
  assert.equal((commands.match(/rpc\('tax_knowledge_supersede_tax_rule_version'/g) ?? []).length, 1);

  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const migration605Diff = execSync(`git diff -- ${MIGRATION_605}`, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(migration605Diff.trim(), '', 'migration 605 must remain unchanged');
});

test('TAX-K2H-A contract: no K3+/Trainer leakage, no new GET/PATCH', () => {
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES);
  assert.doesNotMatch(panel, /Tax Knowledge Trainer|tax_knowledge_trainer|work.?engine|impact resolver/i);
  assert.doesNotMatch(types, /TaxKnowledgeTrainer|tax_interpretation|tax_strategy/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
});
