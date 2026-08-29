import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTaxKnowledgeCommand, TAX_KNOWLEDGE_COMMANDS } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const apiRoot = join(dir, '../..');

const K14A_PATHS = [
  'apps/api/src/domains/tax-knowledge/',
  'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
  'apps/api/src/routes/owner-country-pack.routes.ts',
  'apps/api/src/domains/country-pack/country-pack-read-models.service.ts',
    'apps/api/src/shared/audit-events.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-4a-commands-aggregate.spec.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4b-lifecycle.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4c-provenance-bindings.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4d-relationships.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4e-version-lifecycle.spec.ts',
  'apps/api/tests/tax-knowledge/tax-knowledge-k1-4f-atomic-supersession.spec.ts',
] as const;

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
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

test('TAX-K1.4A contract: dispatcher recognizes implemented commands', () => {
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('create_tax_source'));
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('create_tax_rule'));
  assert.equal(isTaxKnowledgeCommand('create_tax_source'), true);
  assert.equal(isTaxKnowledgeCommand('create_tax_rule'), true);
  assert.equal(isTaxKnowledgeCommand('activate_tax_rule'), false);
  assert.equal(isTaxKnowledgeCommand('update_tax_source'), false);
  assert.equal(isTaxKnowledgeCommand('create_country'), false);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /export async function executeTaxKnowledgeCommand/);
  assert.match(commandsSrc, /Unsupported tax-knowledge command/);
  assert.doesNotMatch(commandsSrc, /pin_tax_source|bind_legal_value/);

  const countryPackCommands = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  assert.doesNotMatch(countryPackCommands, /create_tax_source|create_tax_rule|executeTaxKnowledgeCommand/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /isTaxKnowledgeCommand\(commandName\)/);
  assert.match(routes, /executeTaxKnowledgeCommand/);
  assert.match(routes, /router\.post\('\/command'/);
});

test('TAX-K1.4A contract: platform owner, no tenant org, no dedicated GET, no PATCH', () => {
  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /assertPlatformOwner\(ctx\)/);
  assert.match(commandsSrc, /organizationId:\s*null/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext/);
  assert.match(commandsSrc, /assertCountryExists/);
  assert.match(commandsSrc, /status:\s*TAX_KNOWLEDGE_INITIAL_STATUS/);
  assert.match(commandsSrc, /TAX_RULE_KIND/);

  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /export async function buildOwnerTaxKnowledgeAggregate/);
  assert.doesNotMatch(readSrc, /resolveCountryContext\(/);
  assert.doesNotMatch(readSrc, /country-pack-resolver/);
  assert.doesNotMatch(readSrc, /organization_id/);
  assert.match(readSrc, /action\('create_tax_source'/);
  assert.match(readSrc, /action\('create_tax_rule'/);
  assert.doesNotMatch(readSrc, /action_key: 'activate_tax_rule/);
  assert.doesNotMatch(readSrc, /action_key: 'pin_/);
  assert.doesNotMatch(readSrc, /action_key: 'bind_/);

  const panelSrc = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  assert.match(panelSrc, /tax_knowledge: taxKnowledge/);
  assert.match(panelSrc, /buildOwnerTaxKnowledgeAggregate/);
  assert.match(panelSrc, /tax_knowledge: taxKnowledge\.allowed_actions/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /\/owner\/tax-knowledge/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_SOURCE_CREATED:\s*'tax_source_created'/);
  assert.match(auditSrc, /TAX_RULE_CREATED:\s*'tax_rule_created'/);
});

test('TAX-K1.4A contract: migrations 600–604 unchanged, no 605, no unrelated files', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  assert.equal(
    existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_commands.sql')),
    false,
    'no migration 605',
  );

  const allowed = new Set<string>([
    ...K14A_PATHS,
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2-provenance.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2a-publication-guard.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3-relationships.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3a-relationship-publication.spec.ts',
    'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
  ]);
  const unexpected = porcelainPaths().filter((path) => !allowed.has(path));
  assert.deepEqual(unexpected, [], `unrelated files changed: ${unexpected.join(', ')}`);

  const webHits = porcelainPaths().filter((path) => path.startsWith('apps/web/'));
  assert.deepEqual(webHits, [], 'frontend files must not change');
});

test('TAX-K1.4A commands require Platform Owner and reject invalid country / unknown command', async (t) => {
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

  await t.test('create_tax_source requires Platform Owner', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(tenantCtx, 'create_tax_source', {
          country_code: 'IL',
          source_code: 'x',
          title: 'x',
          provenance_type: 'official_law',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        (err.code === 'PLATFORM_OWNER_REQUIRED' ||
          err.code === 'PLATFORM_OWNER_NOT_CONFIGURED' ||
          err.code === 'PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN'),
    );
  });

  await t.test('create_tax_rule requires Platform Owner', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(tenantCtx, 'create_tax_rule', {
          country_code: 'IL',
          rule_code: 'x',
          title: 'x',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        (err.code === 'PLATFORM_OWNER_REQUIRED' ||
          err.code === 'PLATFORM_OWNER_NOT_CONFIGURED' ||
          err.code === 'PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN'),
    );
  });

  const email = ownerEmail();
  if (!email) {
    t.skip('PLATFORM_OWNER_EMAIL not configured — live authoring tests skipped');
    return;
  }

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

  await t.test('unknown tax-knowledge command is rejected', async () => {
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule', { country_code: 'IL' }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
  });

  await t.test('invalid country is rejected', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
          country_code: 'ZZ',
          source_code: 'missing-country',
          title: 'Missing country',
          provenance_type: 'official_law',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
  });
});

test('TAX-K1.4A live create + refreshed owner legal-control aggregate', async (t) => {
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
  const probe = await supabaseAdmin.from('tax_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_sources')) {
    t.skip('migration 600 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_sources probe failed: ${errText(probe.error)}`);

  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );
  const { buildOwnerLegalControlPanelAggregate } = await import(
    '../../src/domains/country-pack/country-pack-read-models.service.js'
  );

  const marker = `tk14a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  const createdIds = { sources: [] as string[], rules: [] as string[] };

  t.after(async () => {
    if (createdIds.sources.length) {
      await supabaseAdmin.from('tax_sources').delete().in('id', createdIds.sources);
    }
    if (createdIds.rules.length) {
      await supabaseAdmin.from('tax_rules').delete().in('id', createdIds.rules);
    }
  });

  await t.test('valid source creation follows draft initial state and returns full panel', async () => {
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
      country_code: 'IL',
      source_code: `${marker}_il_src`,
      title: 'K1.4A IL source',
      provenance_type: 'official_guidance',
      issuer: 'ITA',
    });
    assert.equal(out.ok, true);
    assert.equal(out.command, 'create_tax_source');
    assert.equal(out.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const panel = out.refreshed.aggregate;
    assert.equal(panel.aggregate_key, 'owner_legal_control_panel_aggregate');
    assert.ok(panel.country_packs_admin);
    assert.ok(panel.legal_values);
    const tk = panel.tax_knowledge as Record<string, unknown>;
    assert.equal(tk.selected_country_code, 'IL');
    const sources = tk.sources as Array<Record<string, unknown>>;
    const created = sources.find((row) => row.source_code === `${marker}_il_src`);
    assert.ok(created, 'refreshed panel must include the new source');
    assert.equal(created.status, 'draft');
    assert.equal(created.country_code, 'IL');
    createdIds.sources.push(String(created.id));
    assert.equal(Object.prototype.hasOwnProperty.call(created, 'organization_id'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(tk, 'organization_id'), false);

    const actions = tk.allowed_actions as Array<{ action_key: string }>;
    assert.deepEqual(
      actions.map((a) => a.action_key),
      ['create_tax_source', 'create_tax_rule'],
    );

    const { data: audit, error: auditErr } = await supabaseAdmin
      .from('audit_log')
      .select('action, entity_type, organization_id')
      .eq('entity_id', String(created.id))
      .eq('action', 'tax_source_created')
      .maybeSingle();
    if (auditErr && !isSupabaseMissingTableError(auditErr, 'audit_log')) {
      throw new Error(`audit_log read failed: ${errText(auditErr)}`);
    }
    if (audit) {
      assert.equal(audit.entity_type, 'tax_source');
      assert.equal(audit.organization_id, null);
    }
  });

  await t.test('valid rule creation follows draft initial state', async () => {
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
      country_code: 'IL',
      rule_code: `${marker}_il_rule`,
      title: 'K1.4A IL rule',
    });
    assert.equal(out.ok, true);
    assert.equal(out.command, 'create_tax_rule');
    assert.equal(out.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const tk = out.refreshed.aggregate.tax_knowledge as Record<string, unknown>;
    const rules = tk.rules as Array<Record<string, unknown>>;
    const created = rules.find((row) => row.rule_code === `${marker}_il_rule`);
    assert.ok(created, 'refreshed panel must include the new rule');
    assert.equal(created.status, 'draft');
    assert.equal(created.rule_kind, 'legal_rule');
    createdIds.rules.push(String(created.id));

    const { data: audit, error: auditErr } = await supabaseAdmin
      .from('audit_log')
      .select('action, entity_type, organization_id')
      .eq('entity_id', String(created.id))
      .eq('action', 'tax_rule_created')
      .maybeSingle();
    if (auditErr && !isSupabaseMissingTableError(auditErr, 'audit_log')) {
      throw new Error(`audit_log read failed: ${errText(auditErr)}`);
    }
    if (audit) {
      assert.equal(audit.entity_type, 'tax_rule');
      assert.equal(audit.organization_id, null);
    }
  });

  await t.test('duplicate source/rule identity is a conflict', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
          country_code: 'IL',
          source_code: `${marker}_il_src`,
          title: 'dup',
          provenance_type: 'official_law',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
          country_code: 'IL',
          rule_code: `${marker}_il_rule`,
          title: 'dup',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('tax_knowledge aggregate is country-scoped', async () => {
    const us = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
      country_code: 'US',
      source_code: `${marker}_us_src`,
      title: 'K1.4A US source',
      provenance_type: 'textbook',
    });
    const usTk = us.refreshed.aggregate.tax_knowledge as Record<string, unknown>;
    const usSources = usTk.sources as Array<Record<string, unknown>>;
    const usCreated = usSources.find((row) => row.source_code === `${marker}_us_src`);
    assert.ok(usCreated);
    createdIds.sources.push(String(usCreated.id));
    assert.equal(usTk.selected_country_code, 'US');
    assert.equal(
      usSources.some((row) => row.source_code === `${marker}_il_src`),
      false,
      'US aggregate must not include IL source',
    );

    const ilPanel = await buildOwnerLegalControlPanelAggregate(ownerCtx, {
      tax_knowledge_country_code: 'IL',
    });
    assert.equal(ilPanel.aggregate_key, 'owner_legal_control_panel_aggregate');
    const ilTk = ilPanel.tax_knowledge as Record<string, unknown>;
    const ilSources = ilTk.sources as Array<Record<string, unknown>>;
    assert.equal(ilTk.selected_country_code, 'IL');
    assert.ok(ilSources.some((row) => row.source_code === `${marker}_il_src`));
    assert.equal(
      ilSources.some((row) => row.source_code === `${marker}_us_src`),
      false,
      'IL aggregate must not include US source',
    );
    assert.ok(ilPanel.country_packs_admin, 'existing legal-control composition remains');
    assert.ok(ilPanel.legal_values, 'existing legal-control composition remains');
  });

  await t.test('illegal rule_kind is rejected', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
          country_code: 'IL',
          rule_code: `${marker}_bad_kind`,
          title: 'bad kind',
          rule_kind: 'workflow_rule',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
  });
});
