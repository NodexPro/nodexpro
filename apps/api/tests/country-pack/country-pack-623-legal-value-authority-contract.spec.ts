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

test('TAX-623 migration is additive authority pins and does not change Legal Value ownership', () => {
  const sql = readRepo('supabase/migrations/623_legal_value_version_authorities.sql');
  assert.match(sql, /country_legal_value_version_authorities/);
  assert.match(sql, /tax_rule_version_id/);
  assert.match(sql, /LEGAL AUTHORITY/);
  assert.match(sql, /tax_rule_version_legal_values remains/);
  assert.doesNotMatch(sql, /drop table public\.country_legal_values/i);
  assert.doesNotMatch(sql, /פקודת מס הכנסה/);
  assert.doesNotMatch(sql, /insert into public\.country_legal_values/i);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /country_legal_value_versions_forbid_historical_overwrite/);
});

test('TAX-623 commands return the owner legal control aggregate and do not add a hidden GET', () => {
  const commands = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  assert.match(commands, /author_country_legal_value/);
  assert.match(commands, /pin_legal_value_version_authority/);
  assert.match(commands, /unpin_legal_value_version_authority/);
  assert.match(commands, /refreshedOwnerLegalControlPanel/);
  assert.match(commands, /generateLegalValueKey/);
  const panel = readRepo('apps/web/src/pages/owner-legal-values-panel.tsx');
  assert.doesNotMatch(panel, /\/legal-values/);
  assert.match(panel, /onCommand\('author_country_legal_value'/);
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-623 Owner UX is human-first and does not hardcode IL legal branching', () => {
  const panel = readRepo('apps/web/src/pages/owner-legal-values-panel.tsx');
  assert.match(panel, /No legal values yet/);
  assert.match(panel, /Add Legal Value/);
  assert.match(panel, /Technical details/);
  assert.match(panel, /Legal basis/);
  assert.match(panel, /picker_options/);
  assert.doesNotMatch(panel, /country === ['"]IL['"]/);
  assert.doesNotMatch(panel, /country_code === ['"]IL['"]/);
  assert.doesNotMatch(panel, /פקודת מס הכנסה/);
  assert.doesNotMatch(panel, /Create Legal Value/);
  assert.doesNotMatch(panel, /Update Module Scope/);
  const parent = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  assert.match(parent, /OwnerLegalValuesPanel/);
  assert.match(parent, /workspace=/);
});

test('TAX-623 frozen 600–622 files are not rewritten by this slice', () => {
  const files = [
    'supabase/migrations/620_owner_country_legal_access.sql',
    'supabase/migrations/621_country_localization.sql',
    'supabase/migrations/622_tax_legal_library_foundation.sql',
  ];
  for (const file of files) {
    const text = readRepo(file);
    assert.doesNotMatch(text, /country_legal_value_version_authorities/);
  }
});

test('TAX-623 distinguishes consumption bindings from authority pins', () => {
  const bind = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(bind, /bind_tax_rule_version_legal_value stores legal_value_id only/);
  const sql = readRepo('supabase/migrations/623_legal_value_version_authorities.sql');
  assert.match(sql, /country_legal_value_version_id/);
  assert.doesNotMatch(sql, /legal_value_id uuid not null,\s*tax_rule_version_id/);
});
