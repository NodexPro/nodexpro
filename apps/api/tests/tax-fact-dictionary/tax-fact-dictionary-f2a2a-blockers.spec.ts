import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import {
  canonicalizeTaxFactDefinitionChecksumPayload,
  taxFactDefinitionChecksum,
  taxFactDefinitionSemanticSnapshot,
} from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-checksum.pure.js';
import { mapDefinition, ownerFactDictionaryIncludesDefinitionCountry } from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.pure.js';
import { resolveOwnerLegalControlSelectedCountry } from '../../src/domains/country-pack/owner-legal-control-country.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/614_tax_fact_dictionary_atomic_activation.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function functionBody(sql: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(
    new RegExp(`create or replace function public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  );
  assert.ok(match, `function ${name} must exist in 614`);
  return match[0];
}

const sql = readRepo(migrationRel);
const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
const panel = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
const commandsSrc = readRepo(
  'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
);
const readService = readRepo(
  'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.service.ts',
);
const activateHandler = commandsSrc.slice(
  commandsSrc.indexOf('async function handleActivateVersion'),
  commandsSrc.indexOf('async function handleRetireVersion'),
);

test('TAX-F2A2A B1: no independent Fact Dictionary country selector', () => {
  assert.doesNotMatch(routes, /fact_dictionary_country_code/);
  assert.doesNotMatch(panel, /fact_dictionary_country_code/);
  assert.doesNotMatch(commandsSrc, /fact_dictionary_country_code/);
  assert.doesNotMatch(
    readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts'),
    /fact_dictionary_country_code/,
  );
  assert.doesNotMatch(
    readRepo('apps/api/src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.ts'),
    /fact_dictionary_country_code/,
  );
  assert.match(panel, /resolveOwnerLegalControlSelectedCountry/);
  assert.match(readService, /country_code\.is\.null,country_code\.eq\./);
  assert.match(readService, /ownerFactDictionaryIncludesDefinitionCountry/);
});

test('TAX-F2A2A B1: IL Owner country is global + IL, excludes US, global scope explicit', () => {
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry(null, 'IL'), true);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('IL', 'IL'), true);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('US', 'IL'), false);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('us', 'il'), false);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry(null, null), true);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('IL', null), false);

  const global = mapDefinition(
    {
      id: '00000000-0000-0000-0000-000000000001',
      fact_key: 'employee_count',
      country_code: null,
      status: 'active',
      semantic_title: 'Employees',
      owner_note: null,
      retired_at: null,
      retired_reason: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    [],
    [],
  );
  assert.equal(global.scope, 'global');
  assert.equal(global.country_code, null);

  const il = mapDefinition(
    {
      ...{
        id: '00000000-0000-0000-0000-000000000002',
        fact_key: 'il_resident',
        country_code: 'IL',
        status: 'active',
        semantic_title: 'Resident',
        owner_note: null,
        retired_at: null,
        retired_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    },
    [],
    [],
  );
  assert.equal(il.scope, 'country');
  assert.equal(il.country_code, 'IL');
});

test('TAX-F2A2A B1: supported request cannot mix TK=IL / Strategy=IL / FD=US', () => {
  assert.equal(
    resolveOwnerLegalControlSelectedCountry({
      tax_knowledge_country_code: 'IL',
      strategy_engine_country_code: 'IL',
    }),
    'IL',
  );
  assert.equal(
    resolveOwnerLegalControlSelectedCountry({
      tax_knowledge_country_code: 'IL',
      strategy_engine_country_code: undefined,
    }),
    'IL',
  );
  assert.throws(
    () =>
      resolveOwnerLegalControlSelectedCountry({
        tax_knowledge_country_code: 'IL',
        strategy_engine_country_code: 'US',
      }),
    (err: unknown) => err instanceof AppError && err.statusCode === 400 && /must match/.test(err.message),
  );
  assert.match(panel, /country_code: selectedCountryCode/);
  assert.equal((panel.match(/country_code: selectedCountryCode/g) ?? []).length >= 3, true);
  assert.doesNotMatch(routes, /req\.query\.fact_dictionary_country_code/);
});

test('TAX-F2A2A B2: activation command uses exact atomic RPC; no persist→status path', () => {
  assert.match(activateHandler, /rpc\('tax_fact_definition_version_activate'/);
  assert.match(activateHandler, /p_version_id: id/);
  assert.match(activateHandler, /p_expected_definition_checksum: expectedChecksum/);
  assert.match(activateHandler, /p_expected_semantic_snapshot: expectedSnapshot/);
  assert.match(activateHandler, /taxFactDefinitionSemanticSnapshot/);
  assert.doesNotMatch(activateHandler, /persistDraftChecksum/);
  assert.doesNotMatch(activateHandler, /\.update\(\{\s*status:\s*'active'\s*\}/);
  assert.doesNotMatch(activateHandler, /latest|order\('version_no'/);
  assert.match(activateHandler, /version\.status !== 'draft'/);
  assert.match(activateHandler, /TAX_FACT_DEFINITION_VERSION_ACTIVATED/);
  const auditIndex = activateHandler.indexOf('TAX_FACT_DEFINITION_VERSION_ACTIVATED');
  const rpcIndex = activateHandler.indexOf("rpc('tax_fact_definition_version_activate'");
  assert.ok(rpcIndex >= 0 && auditIndex > rpcIndex, 'audit must run only after RPC success');
});

test('TAX-F2A2A B2: 614 RPC is exact-id, service_role only, triggers stay enabled', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.match(sql, /create or replace function public\.tax_fact_definition_version_activate\(/);
  assert.match(sql, /p_version_id uuid/);
  assert.match(sql, /p_expected_definition_checksum text/);
  assert.match(sql, /p_expected_semantic_snapshot jsonb/);
  const activate = functionBody(sql, 'tax_fact_definition_version_activate');
  assert.match(activate, /security definer/i);
  assert.match(activate, /set search_path = pg_catalog, public/);
  assert.match(activate, /where v\.id = p_version_id/);
  assert.doesNotMatch(activate, /order by version_no/i);
  assert.doesNotMatch(activate, /order by .*created_at|max\(version_no\)|resolve_latest/i);
  assert.doesNotMatch(sql, /alter table[\s\S]{0,80}disable trigger/i);
  assert.doesNotMatch(sql, /session_replication_role/);
  assert.match(
    sql,
    /revoke all on function public\.tax_fact_definition_version_activate\(uuid, text, jsonb\) from public;/,
  );
  assert.match(
    sql,
    /revoke all on function public\.tax_fact_definition_version_activate\(uuid, text, jsonb\) from anon, authenticated;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.tax_fact_definition_version_activate\(uuid, text, jsonb\) to service_role;/,
  );
  assert.match(sql, /revoke all on function public\.tax_fact_dictionary_lock_version_semantics\(uuid\) from public;/);
  assert.match(
    sql,
    /revoke all on function public\.tax_fact_dictionary_lock_version_semantics\(uuid\) from anon, authenticated;/,
  );
});

test('TAX-F2A2A B2: semantic mutations share the publication lock; presentation does not', () => {
  assert.match(sql, /pg_advisory_xact_lock\(614, hashtext\(p_version_id::text\)\)/);
  assert.match(sql, /tax_fact_dictionary_lock_version_semantics/);
  const enumGuard = functionBody(sql, 'tax_fact_enum_options_requires_parent_draft');
  assert.match(enumGuard, /tax_fact_dictionary_lock_version_semantics\(old\.tax_fact_definition_version_id\)/);
  assert.match(enumGuard, /tax_fact_dictionary_lock_version_semantics\(new\.tax_fact_definition_version_id\)/);
  const lockBeforeStatus = enumGuard.indexOf('tax_fact_dictionary_lock_version_semantics');
  const statusRead = enumGuard.indexOf('select v.status');
  assert.ok(lockBeforeStatus >= 0 && statusRead > lockBeforeStatus, 'enum lock must precede status read');

  const versionLock = functionBody(sql, 'tax_fact_definition_versions_lock_semantics');
  assert.match(versionLock, /old\.value_type is distinct from new\.value_type/);
  assert.match(versionLock, /old\.definition_checksum is distinct from new\.definition_checksum/);
  assert.match(versionLock, /new\.status is distinct from old\.status/);

  const publication = functionBody(sql, 'tax_fact_definition_versions_guard_publication');
  assert.ok(
    publication.indexOf('tax_fact_dictionary_lock_version_semantics') < publication.indexOf('select count(*)'),
    'publication must lock before counting enum options',
  );

  assert.match(commandsSrc, /case 'update_tax_fact_definition_version_draft':/);
  assert.match(commandsSrc, /case 'add_tax_fact_enum_option':/);
  assert.match(commandsSrc, /case 'update_tax_fact_enum_option':/);
  assert.match(commandsSrc, /case 'remove_tax_fact_enum_option':/);
  assert.match(commandsSrc, /\.from\('tax_fact_enum_options'\)/);
  assert.match(commandsSrc, /\.from\('tax_fact_definition_versions'\)\.update/);

  const presentationCreate = commandsSrc.slice(
    commandsSrc.indexOf('async function handleCreatePresentation'),
    commandsSrc.indexOf('export async function executeTaxFactDictionaryCommand'),
  );
  assert.doesNotMatch(presentationCreate, /tax_fact_dictionary_lock_version_semantics|persistDraftChecksum/);
  assert.match(presentationCreate, /tax_fact_presentations/);
});

test('TAX-F2A2A checksum: validation arrays preserve order; currencies and enums canonicalize; title excluded', () => {
  const base = {
    fact_key: 'employee_count',
    country_code: 'IL' as string | null,
    value_type: 'integer',
    unit_code: null as string | null,
    currency_policy: null as Record<string, unknown> | null,
    validation_json: { allowed: ['b', 'a'] } as Record<string, unknown>,
    enum_codes: [] as string[],
  };
  const preserved = canonicalizeTaxFactDefinitionChecksumPayload(base);
  const reversed = canonicalizeTaxFactDefinitionChecksumPayload({
    ...base,
    validation_json: { allowed: ['a', 'b'] },
  });
  assert.match(preserved, /"allowed":\["b","a"\]/);
  assert.notEqual(preserved, reversed);

  const moneyA = taxFactDefinitionChecksum({
    ...base,
    value_type: 'money',
    currency_policy: { required: true, allowed_currencies: ['USD', 'ILS'] },
    validation_json: {},
  });
  const moneyB = taxFactDefinitionChecksum({
    ...base,
    value_type: 'money',
    currency_policy: { required: true, allowed_currencies: ['ILS', 'USD'] },
    validation_json: {},
  });
  assert.equal(moneyA, moneyB);

  const enumA = taxFactDefinitionChecksum({
    ...base,
    value_type: 'enum',
    validation_json: {},
    enum_codes: ['resident', 'non_resident'],
  });
  const enumB = taxFactDefinitionChecksum({
    ...base,
    value_type: 'enum',
    validation_json: {},
    enum_codes: ['non_resident', 'resident'],
  });
  assert.equal(enumA, enumB);

  const titled = taxFactDefinitionChecksum({
    ...base,
    // @ts-expect-error title and sort_order are not checksum inputs
    semantic_title: 'Ignored',
    presentation: { label: 'Ignored' },
    sort_order: 9,
  });
  assert.equal(titled, taxFactDefinitionChecksum(base));
});

test('TAX-F2A2A B2: RPC compares locked semantic snapshot and does not trust stored checksum', () => {
  const activate = functionBody(sql, 'tax_fact_definition_version_activate');
  assert.match(activate, /tax_fact_dictionary_current_semantic_snapshot\(p_version_id\)/);
  assert.match(activate, /tax_fact_dictionary_canonicalize_semantic_snapshot\(p_expected_semantic_snapshot\)/);
  assert.match(activate, /semantic snapshot mismatch/);
  assert.doesNotMatch(
    activate,
    /if v_version\.definition_checksum is distinct from p_expected_definition_checksum/,
  );
  assert.match(activate, /Do not trust stored definition_checksum/);
  assert.match(
    activate,
    /definition_checksum = p_expected_definition_checksum,\s+status = 'active'/,
  );
  assert.match(activate, /where id = p_version_id\s+and status = 'draft'/);
  assert.doesNotMatch(activate, /and definition_checksum = p_expected_definition_checksum/);

  const add = commandsSrc.slice(
    commandsSrc.indexOf('async function handleAddEnumOption'),
    commandsSrc.indexOf('async function handleUpdateEnumOption'),
  );
  const updateEnum = commandsSrc.slice(
    commandsSrc.indexOf('async function handleUpdateEnumOption'),
    commandsSrc.indexOf('async function handleRemoveEnumOption'),
  );
  const remove = commandsSrc.slice(
    commandsSrc.indexOf('async function handleRemoveEnumOption'),
    commandsSrc.indexOf('function presentationPatch'),
  );
  assert.ok(add.indexOf(".from('tax_fact_enum_options')") < add.indexOf('persistDraftChecksum'));
  assert.ok(updateEnum.indexOf(".from('tax_fact_enum_options')") < updateEnum.indexOf('persistDraftChecksum'));
  assert.ok(remove.indexOf(".from('tax_fact_enum_options')") < remove.indexOf('persistDraftChecksum'));
});

test('TAX-F2A2A lifecycle: stale snapshot fails; exact snapshot + checksum succeeds conceptually; already-active rejected', () => {
  assert.match(activateHandler, /requires the exact version to be draft/);
  const activate = functionBody(sql, 'tax_fact_definition_version_activate');
  assert.match(activate, /requires the exact version to be draft/);
  assert.match(activate, /v_current is distinct from v_expected/);
  assert.match(activate, /get diagnostics v_updated = row_count/);
  assert.match(activate, /v_updated <> 1/);
  assert.match(activate, /status = 'active'/);
  assert.match(activate, /and status = 'draft'/);
  assert.doesNotMatch(activate, /if v_version\.status = 'active' then\s+return/i);
  assert.match(sql, /613 publication \/ immutability \/ country \/ GiST overlap triggers stay enabled/);

  const snapshot = taxFactDefinitionSemanticSnapshot({
    fact_key: 'employee_count',
    country_code: 'IL',
    value_type: 'enum',
    unit_code: null,
    currency_policy: null,
    validation_json: { allowed: ['b', 'a'] },
    enum_codes: ['resident', 'non_resident'],
  });
  assert.deepEqual(snapshot.enum_codes, ['non_resident', 'resident']);
  assert.deepEqual((snapshot.validation_json as { allowed: string[] }).allowed, ['b', 'a']);
  const money = taxFactDefinitionSemanticSnapshot({
    fact_key: 'fee',
    country_code: 'IL',
    value_type: 'money',
    unit_code: null,
    currency_policy: { required: true, allowed_currencies: ['USD', 'ILS'] },
    validation_json: {},
    enum_codes: [],
  });
  assert.deepEqual((money.currency_policy as { allowed_currencies: string[] }).allowed_currencies, ['ILS', 'USD']);

  assert.match(sql, /tax_fact_dictionary_sorted_text_array/);
  assert.match(sql, /validation_json array order is preserved/);
  assert.match(functionBody(sql, 'tax_fact_dictionary_jsonb_sort_keys'), /jsonb_agg\([\s\S]*order by ordinality/);
  assert.match(functionBody(sql, 'tax_fact_dictionary_sorted_text_array'), /order by s\.code collate "C"/);
});

test('TAX-F2A2A isolation: 600–613 unchanged; no 615; K3/K4/Strategy evaluate untouched', () => {
  const frozen = [
    'supabase/migrations/600_tax_knowledge_core_foundation.sql',
    'supabase/migrations/612_tax_strategy_engine_foundation.sql',
    'supabase/migrations/613_tax_fact_dictionary_foundation.sql',
  ];
  for (const file of frozen) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.equal(diff, '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/615_tax_fact_dictionary_atomic_activation.sql')), false);

  const extra = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.includes('614_tax_fact_dictionary_atomic_activation.sql'));
  assert.deepEqual(extra, [], 'tracked Tax Brain migrations 600–613 must not be edited');

  const web = execSync('git diff --name-only -- apps/web', { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.equal(web, '', 'F2A2A must not change the web client');

  const k3 = execSync('git diff --name-only -- apps/api/src/domains/tax-rule-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const k4 = execSync('git diff --name-only -- apps/api/src/domains/tax-calculation-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(k3, '', 'K3 sources must remain unchanged');
  assert.equal(k4, '', 'K4 sources must remain unchanged');

  const evaluate = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-evaluate.pure.ts');
  assert.doesNotMatch(evaluate, /taxFactDefinitionChecksum|fact_dictionary|tax_fact_definition_version_activate/);
});
