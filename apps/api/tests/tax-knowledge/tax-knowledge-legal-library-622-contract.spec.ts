import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTaxKnowledgeCommand, TAX_KNOWLEDGE_COMMANDS } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { TAX_LEGAL_LIBRARY_COMMANDS } from '../../src/domains/tax-knowledge/tax-knowledge-library.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/622_tax_legal_library_foundation.sql';
const sql = readFileSync(join(repoRoot, migrationRel), 'utf8');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-622 migration exists and does not seed Israeli laws or fake hierarchy', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/622_country_localization.sql')), false);
  for (const table of ['tax_domains', 'tax_legal_node_kinds', 'tax_legal_nodes', 'tax_rule_legal_nodes']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql, /add column if not exists tax_domain_id uuid null/);
  assert.match(sql, /tax_sources_domain_country_fk/);
  assert.match(sql, /uq_tax_rule_legal_nodes_pair/);
  assert.doesNotMatch(sql, /insert into public\.tax_domains/i);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_node_kinds/i);
  assert.doesNotMatch(sql, /פקודת מס הכנסה/);
  assert.doesNotMatch(sql, /סעיף 2/);
  assert.match(sql, /Not backfilled/);
  assert.match(sql, /tax_rule_version_sources \(citation \/ provenance pin, not hierarchy\)/);
});

test('TAX-622 does not collapse Rule into a single legal_node_id', () => {
  assert.doesNotMatch(sql, /alter table public\.tax_rules[\s\S]{0,400}legal_node_id/);
  assert.match(sql, /A tax rule may relate to more than one legal node/);
  const types = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  assert.doesNotMatch(types, /(?<!tax_)legal_node_id: string/);
  assert.match(types, /tax_legal_node_id: string/);
});

test('TAX-622 RLS denies tenant PostgREST and grants service_role only', () => {
  assert.match(sql, /alter table public\.tax_domains force row level security/);
  assert.match(sql, /revoke all on table public\.tax_domains from anon, authenticated/);
  assert.match(sql, /revoke all on table public\.tax_legal_nodes from anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.tax_rule_legal_nodes to service_role/);
  assert.doesNotMatch(sql, /^\s*create policy/im);
  assert.doesNotMatch(sql, /organization_id\s+(uuid|text)/i);
});

test('TAX-622 named commands are registered and dispatched', () => {
  for (const command of TAX_LEGAL_LIBRARY_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), true, command);
    assert.ok(TAX_KNOWLEDGE_COMMANDS.includes(command), command);
  }
  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  for (const command of TAX_LEGAL_LIBRARY_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}'`));
  }
  assert.match(commandsSrc, /generateLegalMachineCode/);
  assert.match(commandsSrc, /asOptionalString\(payload\.source_code/);
  assert.match(commandsSrc, /asOptionalString\(payload\.rule_code/);
  assert.doesNotMatch(commandsSrc, /asString\(payload\.domain_code/);
  assert.doesNotMatch(commandsSrc, /asString\(payload\.node_code/);
});

test('TAX-622 capabilities: structure vs rule-link vs activate', () => {
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_domain'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('update_tax_domain_metadata'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_legal_node_kind'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_legal_node'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('update_tax_legal_node_metadata'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_source'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('link_tax_rule_legal_node'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('unlink_tax_rule_legal_node'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_rule'), 'legal_knowledge.draft_create');
  assert.equal(capabilityRequiredForOwnerCommand('activate_tax_source'), 'legal_knowledge.activate');
});

test('TAX-622 country resolution is entity-first for library ids', () => {
  const resolve = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts',
  );
  assert.match(resolve, /create_tax_domain/);
  assert.match(resolve, /loadCountryFromRow\('tax_domains'/);
  assert.match(resolve, /loadCountryFromRow\('tax_legal_nodes'/);
  assert.match(resolve, /loadCountryFromRow\('tax_rule_legal_nodes'/);
});

test('TAX-622 aggregate includes legal_library inside tax knowledge; no hidden GET/PATCH', () => {
  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /legal_library: legalLibrary/);
  assert.match(readSrc, /LEGAL_LIBRARY_SCHEMA_NOT_APPLIED/);
  assert.match(readSrc, /trainer_upload: \{ available: false, status_label: 'Coming later' \}/);
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.get\('\/legal-library'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-622 Owner UI is human-first and does not hardcode IL hierarchy', () => {
  const panel = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  assert.match(panel, /Add Tax Domain/);
  assert.match(panel, /No tax domains yet/);
  assert.match(panel, /No unassigned records/);
  assert.match(panel, /Add Structure Item/);
  assert.match(panel, /Technical details/);
  assert.match(panel, /Unassigned \/ Technical/);
  assert.match(panel, /Upload material — Coming later/);
  assert.match(panel, /node_kinds/);
  assert.doesNotMatch(panel, /country === ['"]IL['"]/);
  assert.doesNotMatch(panel, /country_code === ['"]IL['"]/);
  assert.doesNotMatch(panel, /פקודת מס הכנסה/);
  assert.doesNotMatch(panel, /nx-field-label">Source code/);
  assert.doesNotMatch(panel, /nx-field-label">Domain code/);
  assert.doesNotMatch(panel, /setSourceCode|setDomainCode|setRuleCode/);
  const nav = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  assert.match(nav, /label: 'Legal Library'/);
  assert.match(nav, /label: 'Fact Dictionary'/);
  assert.doesNotMatch(nav, /Laws & Sources/);
  assert.doesNotMatch(nav, /Client Facts/);
});

test('TAX-622 frozen 600–621 files are not rewritten by this slice', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/621_country_localization.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/600_tax_knowledge_core_foundation.sql')), true);
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.doesNotMatch(commands, /evaluate_tax_rules/);
  assert.doesNotMatch(commands, /ocr|openai|anthropic/i);
});
