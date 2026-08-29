import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  isTaxKnowledgeCommand,
  TAX_KNOWLEDGE_COMMANDS,
  TAX_RULE_RELATIONSHIP_TYPES,
} from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const K14D_ALLOWED = [
  'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
  'apps/api/src/shared/audit-events.ts',
  'apps/api/src/domains/country-pack/country-pack-read-models.service.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-2-provenance.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-2a-publication-guard.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-3-relationships.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-3a-relationship-publication.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4a-commands-aggregate.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4b-lifecycle.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4c-provenance-bindings.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4d-relationships.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4e-version-lifecycle.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4f-atomic-supersession.spec.ts',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
] as const;

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
] as const;

const NEW_COMMANDS = ['create_tax_rule_relationship', 'delete_tax_rule_relationship'] as const;

const FUTURE_COMMANDS = ['reopen_tax_rule_version'] as const;

const BLOCKING_TYPES = [
  'depends_on',
  'exception_to',
  'overrides',
  'special_case_of',
  'elaborates',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function ownerEmail(): string | null {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || null;
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function porcelainPaths(): string[] {
  return execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, '').replace(/.* -> /, '').replace(/\\/g, '/'));
}

function k1Payload(notes = 'k14d'): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes };
}

function taxKnowledge(result: { refreshed: { aggregate: Record<string, unknown> } }): {
  implemented_commands: string[];
  allowed_actions: Array<{ action_key: string }>;
  rule_versions: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
} {
  return result.refreshed.aggregate.tax_knowledge as {
    implemented_commands: string[];
    allowed_actions: Array<{ action_key: string }>;
    rule_versions: Array<Record<string, unknown>>;
    rules: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
  };
}

test('TAX-K1.4D contract: dispatcher recognizes both relationship commands', () => {
  for (const command of NEW_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), true, command);
  }
  assert.equal(TAX_KNOWLEDGE_COMMANDS.length, 18);
  assert.deepEqual(
    TAX_KNOWLEDGE_COMMANDS,
    [
      'create_tax_source',
      'create_tax_rule',
      'create_tax_rule_version',
      'update_tax_rule_version_draft',
      'activate_tax_source',
      'retire_tax_source',
      'update_tax_source_metadata',
      'update_tax_rule_metadata',
      'pin_tax_rule_version_source',
      'unpin_tax_rule_version_source',
      'bind_tax_rule_version_legal_value',
      'unbind_tax_rule_version_legal_value',
      'create_tax_rule_relationship',
      'delete_tax_rule_relationship',
      'activate_tax_rule_version',
      'retire_tax_rule_version',
      'close_tax_rule_version_effective_to',
      'supersede_tax_rule_version',
    ],
  );
  for (const command of FUTURE_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), false, command);
  }

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}'`));
  }
  assert.match(commandsSrc, /assertPlatformOwner\(ctx\)/);
  assert.match(commandsSrc, /assertParentVersionDraft\(from\.status, 'create_tax_rule_relationship'\)/);
  assert.match(commandsSrc, /assertParentVersionDraft\(from\.status, 'delete_tax_rule_relationship'\)/);
  assert.match(commandsSrc, /country_code: from\.country_code/);
  assert.match(commandsSrc, /from_tax_rule_version_id and to_tax_rule_version_id must be different/);
  assert.match(commandsSrc, /status: 'active'/);
  assert.doesNotMatch(commandsSrc, /case 'update_tax_rule_relationship'/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext\(/);
  assert.doesNotMatch(commandsSrc, /with recursive/i);
  assert.doesNotMatch(commandsSrc, /superseded_by|requires_fact|affects_strategy|supported_by|interpreted_by/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
  const routesDiff = execSync('git diff -- apps/api/src/routes/owner-country-pack.routes.ts', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(routesDiff.trim(), '', 'owner routes must not change in K1.4D');
});

test('TAX-K1.4D contract: types, 604 untouched, K1.3A policy not reimplemented', () => {
  assert.deepEqual([...TAX_RULE_RELATIONSHIP_TYPES], [
    'depends_on',
    'conflicts_with',
    'exception_to',
    'overrides',
    'alternative_to',
    'special_case_of',
    'elaborates',
  ]);

  const typesSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(typesSrc, new RegExp(`'${command}'`));
  }
  assert.match(typesSrc, /relationships: OwnerTaxRuleRelationshipDto\[\]/);
  assert.match(typesSrc, /to_rule_code/);
  assert.match(typesSrc, /to_version_no/);
  assert.doesNotMatch(typesSrc, /'supersedes'/);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  const createRelSrc = commandsSrc.slice(
    commandsSrc.indexOf('async function handleCreateTaxRuleRelationship'),
    commandsSrc.indexOf('async function handleDeleteTaxRuleRelationship'),
  );
  assert.doesNotMatch(commandsSrc, /tax_rule_versions_guard_publication_relationships/);
  assert.doesNotMatch(createRelSrc, /cannot activate while a blocking relationship/);
  assert.doesNotMatch(createRelSrc, /to\.status === 'active'/);
  assert.doesNotMatch(createRelSrc, /dest\.status is distinct from 'active'/);
  for (const type of BLOCKING_TYPES) {
    assert.doesNotMatch(
      commandsSrc,
      new RegExp(`if \\(relationshipType === '${type}'\\)`),
    );
  }

  const sql604 = readRepo('supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql');
  assert.match(sql604, /tax_rule_versions_guard_publication_relationships/);
  for (const type of BLOCKING_TYPES) {
    assert.match(sql604, new RegExp(`'${type}'`));
  }
  assert.match(sql604, /conflicts_with and alternative_to do not block/);
  const diff604 = execSync('git diff -- supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(diff604.trim(), '', 'migration 604 must remain unchanged');

  const sql603 = readRepo('supabase/migrations/603_tax_knowledge_rule_relationships.sql');
  assert.match(sql603, /uq_tax_rule_relationships_edge/);
  assert.match(sql603, /from_tax_rule_version_id,\s*to_tax_rule_version_id,\s*relationship_type/);
  assert.match(sql603, /must be inserted as active/);
  assert.match(sql603, /owner_note text null/);
  assert.doesNotMatch(sql603, /insert into public\.tax_rule_relationships.*to_tax_rule_version_id = new\.from/);

  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /relationshipsByFrom/);
  assert.match(readSrc, /to_rule_code/);
  assert.match(readSrc, /create_tax_rule_relationship/);
  assert.match(readSrc, /delete_tax_rule_relationship/);
  assert.match(readSrc, /implemented_commands: \[\.\.\.TAX_KNOWLEDGE_COMMANDS\]/);
  assert.match(readSrc, /action\('create_tax_source'/);
  assert.match(readSrc, /action\('create_tax_rule'/);
  assert.match(readSrc, /supersede_tax_rule_version/);
  assert.doesNotMatch(readSrc, /organization_id/);
  assert.doesNotMatch(readSrc, /with recursive/i);
  const catalog = readSrc.slice(readSrc.indexOf('function catalogAllowedActions'), readSrc.indexOf('async function loadCountryCatalog'));
  assert.match(catalog, /create_tax_source/);
  assert.match(catalog, /create_tax_rule/);
  assert.doesNotMatch(catalog, /create_tax_rule_relationship/);
  assert.doesNotMatch(catalog, /delete_tax_rule_relationship/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_RULE_RELATIONSHIP_CREATED:\s*'tax_rule_relationship_created'/);
  assert.match(auditSrc, /TAX_RULE_RELATIONSHIP_DELETED:\s*'tax_rule_relationship_deleted'/);
});

test('TAX-K1.4D contract: migrations 600–604 unchanged, no 605, no unrelated files', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_commands.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_relationships.sql')), false);
  const unexpected = porcelainPaths().filter((path) => !K14D_ALLOWED.includes(path as (typeof K14D_ALLOWED)[number]));
  assert.deepEqual(unexpected, [], `unrelated files changed: ${unexpected.join(', ')}`);
  assert.deepEqual(
    porcelainPaths().filter((path) => path.startsWith('apps/web/')),
    [],
    'frontend files must not change',
  );
});

test('TAX-K1.4D commands require Platform Owner', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );
  const tenantCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      authUserId: '00000000-0000-0000-0000-000000000099',
      email: 'tenant@example.com',
      fullName: null,
      status: 'active',
      uiLanguage: 'en' as const,
    },
    membership: {
      organizationId: '00000000-0000-0000-0000-000000000088',
      userId: '00000000-0000-0000-0000-000000000099',
      roleId: 'r',
      roleCode: 'admin',
      permissions: ['*'],
    },
    organizationId: '00000000-0000-0000-0000-000000000088',
  };
  for (const command of NEW_COMMANDS) {
    await t.test(`${command} requires Platform Owner`, async () => {
      await assert.rejects(
        () =>
          executeTaxKnowledgeCommand(tenantCtx, command, {
            from_tax_rule_version_id: randomUUID(),
            to_tax_rule_version_id: randomUUID(),
            relationship_type: 'depends_on',
            tax_rule_relationship_id: randomUUID(),
          }),
        (err: unknown) => err instanceof AppError && err.statusCode === 403,
      );
    });
  }
});

test('TAX-K1.4D live relationship commands', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const email = ownerEmail();
  if (!email) {
    t.skip('PLATFORM_OWNER_EMAIL not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_relationships').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_relationships')) {
    t.skip('migration 603 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_relationships probe failed: ${errText(probe.error)}`);

  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );

  const marker = `tk14d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      authUserId: '00000000-0000-0000-0000-000000000001',
      email,
      fullName: null,
      status: 'active',
      uiLanguage: 'en' as const,
    },
    membership: null,
    organizationId: null,
  };

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const { error: packErr } = await supabaseAdmin.from('country_packs').insert([
    {
      id: packIl,
      country_code: 'IL',
      pack_code: `${marker}_il_pack`,
      name: `${marker} IL pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
    {
      id: packUs,
      country_code: 'US',
      pack_code: `${marker}_us_pack`,
      name: `${marker} US pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
  ]);
  if (packErr) throw new Error(`country_packs insert failed: ${errText(packErr)}`);
  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert([
    {
      id: rulesetIl,
      country_pack_id: packIl,
      ruleset_code: `${marker}_il_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
    {
      id: rulesetUs,
      country_pack_id: packUs,
      ruleset_code: `${marker}_us_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
  ]);
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const sourceOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
    country_code: 'IL',
    source_code: `${marker}_src`,
    title: 'K1.4D source',
    provenance_type: 'official_guidance',
  });
  const sourceId = String(
    taxKnowledge(sourceOut).sources.find((row) => row.source_code === `${marker}_src`)?.id,
  );

  const fromRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_from`,
    title: 'K1.4D from-rule',
  });
  const fromRuleId = String(
    taxKnowledge(fromRuleOut).rules.find((row) => row.rule_code === `${marker}_from`)?.id,
  );
  const toRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_to`,
    title: 'K1.4D to-rule',
  });
  const toRuleId = String(taxKnowledge(toRuleOut).rules.find((row) => row.rule_code === `${marker}_to`)?.id);
  const usRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'US',
    rule_code: `${marker}_us`,
    title: 'K1.4D US rule',
  });
  const usRuleId = String(taxKnowledge(usRuleOut).rules.find((row) => row.rule_code === `${marker}_us`)?.id);

  const fromVersionOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
    tax_rule_id: fromRuleId,
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    effective_from: '2024-01-01',
    payload_json: k1Payload('from'),
  });
  const fromVersionId = String(
    taxKnowledge(fromVersionOut).rule_versions.find((row) => row.tax_rule_id === fromRuleId)?.id,
  );
  const toDraftOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
    tax_rule_id: toRuleId,
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    effective_from: '2024-01-01',
    payload_json: k1Payload('to-draft'),
  });
  const toDraftId = String(taxKnowledge(toDraftOut).rule_versions.find((row) => row.tax_rule_id === toRuleId)?.id);
  const toActiveOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
    tax_rule_id: toRuleId,
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    effective_from: '2025-01-01',
    payload_json: k1Payload('to-active'),
  });
  const toActiveId = String(
    taxKnowledge(toActiveOut)
      .rule_versions.filter((row) => row.tax_rule_id === toRuleId)
      .sort((a, b) => Number(a.version_no) - Number(b.version_no))
      .at(-1)?.id,
  );
  const usVersionOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
    tax_rule_id: usRuleId,
    country_pack_id: packUs,
    country_pack_ruleset_id: rulesetUs,
    effective_from: '2024-01-01',
    payload_json: k1Payload('us'),
  });
  const usVersionId = String(
    taxKnowledge(usVersionOut).rule_versions.find((row) => row.tax_rule_id === usRuleId)?.id,
  );

  await t.test('FROM and TO must exist; country derived from FROM; cross-country rejected', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: randomUUID(),
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'depends_on',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: randomUUID(),
          relationship_type: 'depends_on',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: usVersionId,
          relationship_type: 'depends_on',
          country_code: 'US',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
  });

  await t.test('self-link and unknown type rejected; lifecycle fields not accepted', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: fromVersionId,
          relationship_type: 'depends_on',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'supersedes',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'depends_on',
          status: 'retired',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'depends_on',
          organization_id: randomUUID(),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
  });

  await t.test('all seven types accepted; TO may be draft; no reverse row; duplicate conflicts', async () => {
    const createdIds: string[] = [];
    for (const relationshipType of TAX_RULE_RELATIONSHIP_TYPES) {
      const created = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
        from_tax_rule_version_id: fromVersionId,
        to_tax_rule_version_id: toDraftId,
        relationship_type: relationshipType,
        country_code: 'US',
        owner_note: relationshipType === 'depends_on' ? 'explicit note' : undefined,
      });
      assert.equal(created.ok, true);
      assert.equal(created.command, 'create_tax_rule_relationship');
      assert.equal(created.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
      const from = taxKnowledge(created).rule_versions.find((row) => row.id === fromVersionId);
      const edges = from?.relationships as Array<Record<string, unknown>>;
      const edge = edges.find((row) => row.relationship_type === relationshipType);
      assert.ok(edge, relationshipType);
      assert.equal(edge?.from_tax_rule_version_id, fromVersionId);
      assert.equal(edge?.to_tax_rule_version_id, toDraftId);
      assert.equal(edge?.status, 'active');
      assert.equal(edge?.to_tax_rule_id, toRuleId);
      assert.equal(edge?.to_rule_code, `${marker}_to`);
      assert.equal(edge?.to_title, 'K1.4D to-rule');
      assert.equal(edge?.to_status, 'draft');
      createdIds.push(String(edge?.id));
    }

    const tk = taxKnowledge(
      await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
        tax_rule_id: fromRuleId,
        owner_note: 'refresh',
      }),
    );
    const from = tk.rule_versions.find((row) => row.id === fromVersionId);
    const edges = from?.relationships as Array<Record<string, unknown>>;
    assert.equal(edges.length, 7);
    assert.deepEqual(
      tk.allowed_actions.map((a) => a.action_key),
      ['create_tax_source', 'create_tax_rule'],
    );
    for (const command of NEW_COMMANDS) {
      assert.ok(tk.implemented_commands.includes(command), command);
    }
    for (const command of FUTURE_COMMANDS) {
      assert.ok(!tk.implemented_commands.includes(command), command);
    }
    const createAction = (from?.allowed_actions as Array<{ action_key: string; enabled: boolean }>).find(
      (a) => a.action_key === 'create_tax_rule_relationship',
    );
    assert.equal(createAction?.enabled, true);

    const { data: reverse, error: reverseErr } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id')
      .eq('from_tax_rule_version_id', toDraftId)
      .eq('to_tax_rule_version_id', fromVersionId);
    if (reverseErr) throw new Error(errText(reverseErr));
    assert.equal((reverse ?? []).length, 0);

    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'depends_on',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    const deleted = await executeTaxKnowledgeCommand(ownerCtx, 'delete_tax_rule_relationship', {
      tax_rule_relationship_id: createdIds[0],
    });
    const remaining = (
      taxKnowledge(deleted).rule_versions.find((row) => row.id === fromVersionId)?.relationships as Array<
        Record<string, unknown>
      >
    );
    assert.equal(remaining.length, 6);
    assert.equal(
      remaining.some((row) => row.id === createdIds[0]),
      false,
    );
    const { data: leftover, error: leftoverErr } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id')
      .in('id', createdIds);
    if (leftoverErr) throw new Error(errText(leftoverErr));
    assert.equal((leftover ?? []).length, 6);
  });

  await t.test('TO active accepted; FROM must be draft; published FROM blocks delete', async () => {
    await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', { tax_source_id: sourceId });
    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: toActiveId,
      tax_source_id: sourceId,
    });
    const activatedTo = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', toActiveId);
    if (activatedTo.error) {
      t.skip(`could not activate TO fixture: ${errText(activatedTo.error)}`);
      return;
    }

    const toActiveRel = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
      from_tax_rule_version_id: fromVersionId,
      to_tax_rule_version_id: toActiveId,
      relationship_type: 'conflicts_with',
    });
    const fromAfterToActive = taxKnowledge(toActiveRel).rule_versions.find((row) => row.id === fromVersionId);
    const leftoverDraftEdges = (
      fromAfterToActive?.relationships as Array<Record<string, unknown>>
    ).filter((row) => row.to_tax_rule_version_id === toDraftId);
    for (const edge of leftoverDraftEdges) {
      await executeTaxKnowledgeCommand(ownerCtx, 'delete_tax_rule_relationship', {
        tax_rule_relationship_id: String(edge.id),
      });
    }
    const toActiveEdge = (
      taxKnowledge(
        await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
          tax_rule_id: fromRuleId,
          owner_note: 'refresh-active-to',
        }),
      ).rule_versions.find((row) => row.id === fromVersionId)?.relationships as Array<Record<string, unknown>>
    ).find((row) => row.to_tax_rule_version_id === toActiveId);
    assert.equal(toActiveEdge?.to_status, 'active');
    assert.equal(toActiveEdge?.relationship_type, 'conflicts_with');

    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: fromVersionId,
      tax_source_id: sourceId,
    });
    const activatedFrom = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'active' })
      .eq('id', fromVersionId);
    if (activatedFrom.error) {
      t.skip(`could not activate FROM fixture: ${errText(activatedFrom.error)}`);
      return;
    }

    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
          from_tax_rule_version_id: fromVersionId,
          to_tax_rule_version_id: toDraftId,
          relationship_type: 'elaborates',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'delete_tax_rule_relationship', {
          tax_rule_relationship_id: String(toActiveEdge?.id),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    const { data: stillThere, error } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id')
      .eq('id', String(toActiveEdge?.id))
      .maybeSingle();
    if (error) throw new Error(errText(error));
    assert.ok(stillThere);
  });

  await t.test('audits emitted for create and delete', async () => {
    const { data: audits, error } = await supabaseAdmin
      .from('audit_log')
      .select('action, organization_id')
      .in('action', ['tax_rule_relationship_created', 'tax_rule_relationship_deleted'])
      .limit(20);
    if (error && !isSupabaseMissingTableError(error, 'audit_log')) throw new Error(errText(error));
    if (audits) {
      const seen = new Set(audits.map((row) => row.action));
      assert.ok(seen.has('tax_rule_relationship_created'));
      assert.ok(seen.has('tax_rule_relationship_deleted'));
      assert.ok(audits.every((row) => row.organization_id == null));
    }
  });
});
