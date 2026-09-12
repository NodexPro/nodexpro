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
} from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const K14C_ALLOWED = [
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

const NEW_COMMANDS = [
  'pin_tax_rule_version_source',
  'unpin_tax_rule_version_source',
  'bind_tax_rule_version_legal_value',
  'unbind_tax_rule_version_legal_value',
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

function k1Payload(notes = 'k14c'): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes };
}

test('TAX-K1.4C contract: dispatcher recognizes all four new commands', () => {
  for (const command of NEW_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), true, command);
  }
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('create_tax_source'));
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('supersede_tax_rule_version'));
  assert.ok(TAX_KNOWLEDGE_COMMANDS.length >= 23);
  assert.equal(isTaxKnowledgeCommand('activate_tax_rule_version'), true);
  assert.equal(isTaxKnowledgeCommand('create_tax_rule_relationship'), true);
  assert.equal(isTaxKnowledgeCommand('retire_tax_rule_version'), true);
  assert.equal(isTaxKnowledgeCommand('supersede_tax_rule_version'), true);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}'`));
  }
  assert.match(commandsSrc, /assertOwnerLegalCommandAccess\(ctx, command, payload\)/);
  assert.match(commandsSrc, /assertParentVersionDraft/);
  assert.match(commandsSrc, /normalizeCitationLocator/);
  assert.doesNotMatch(commandsSrc, /legal_value_version_id:/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext\(/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
  const routesDiff = execSync('git diff -- apps/api/src/routes/owner-country-pack.routes.ts', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(routesDiff.trim(), '', 'owner routes must not change in K1.4C');
});

test('TAX-K1.4C contract: locator normalization, no copied amounts, implemented_commands', () => {
  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /locator\.length \? locator : null/);
  assert.match(commandsSrc, /locatorKey/);
  assert.match(commandsSrc, /legal_value_version_id' in payload/);
  assert.match(commandsSrc, /'rate' in payload/);
  assert.match(commandsSrc, /'threshold' in payload/);
  assert.match(commandsSrc, /'amount' in payload/);

  const sql601 = readRepo('supabase/migrations/601_tax_knowledge_provenance_links.sql');
  assert.match(sql601, /coalesce\(btrim\(locator\), ''\)/);
  assert.match(sql601, /uq_tax_rule_version_legal_values_pair/);
  assert.doesNotMatch(sql601, /legal_value_version_id/);

  const typesSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(typesSrc, new RegExp(`'${command}'`));
  }

  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /legal_value_bindings/);
  assert.match(readSrc, /pin_tax_rule_version_source/);
  assert.match(readSrc, /bind_tax_rule_version_legal_value/);
  assert.match(readSrc, /implemented_commands: \[\.\.\.TAX_KNOWLEDGE_COMMANDS\]/);
  assert.match(readSrc, /action\('create_tax_source'/);
  assert.match(readSrc, /action\('create_tax_rule'/);
  assert.match(readSrc, /supersede_tax_rule_version/);
  assert.doesNotMatch(readSrc, /value_payload_json/);
  assert.doesNotMatch(readSrc, /organization_id/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_RULE_VERSION_SOURCE_PINNED:\s*'tax_rule_version_source_pinned'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_SOURCE_UNPINNED:\s*'tax_rule_version_source_unpinned'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_LEGAL_VALUE_BOUND:\s*'tax_rule_version_legal_value_bound'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_LEGAL_VALUE_UNBOUND:\s*'tax_rule_version_legal_value_unbound'/);
});

test('TAX-K1.4C contract: migrations 600–604 unchanged, no 605, no unrelated files', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_commands.sql')), false);
  const unexpected = porcelainPaths().filter((path) => !K14C_ALLOWED.includes(path as (typeof K14C_ALLOWED)[number]));
  assert.deepEqual(unexpected, [], `unrelated files changed: ${unexpected.join(', ')}`);
  assert.deepEqual(
    porcelainPaths().filter((path) => path.startsWith('apps/web/')),
    [],
    'frontend files must not change',
  );
});

test('TAX-K1.4C commands require Platform Owner', async (t) => {
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
        () => executeTaxKnowledgeCommand(tenantCtx, command, { tax_rule_version_id: randomUUID() }),
        (err: unknown) => err instanceof AppError && err.statusCode === 403,
      );
    });
  }
});

test('TAX-K1.4C live provenance + legal-value binding commands', async (t) => {
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
  const probe = await supabaseAdmin.from('tax_rule_version_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_version_sources')) {
    t.skip('migration 601 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_version_sources probe failed: ${errText(probe.error)}`);

  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );

  const marker = `tk14c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert({
    id: rulesetIl,
    country_pack_id: packIl,
    ruleset_code: `${marker}_il_rs`,
    ruleset_version: '1.0.0',
    effective_from: '2020-01-01',
    status: 'active',
  });
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const sourceOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
    country_code: 'IL',
    source_code: `${marker}_src`,
    title: 'K1.4C source',
    provenance_type: 'official_guidance',
  });
  const sourceId = String(
    (sourceOut.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }).sources.find(
      (row) => row.source_code === `${marker}_src`,
    )?.id,
  );
  const usSource = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
    country_code: 'US',
    source_code: `${marker}_us_src`,
    title: 'K1.4C US source',
    provenance_type: 'textbook',
  });
  const usSourceId = String(
    (usSource.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }).sources.find(
      (row) => row.source_code === `${marker}_us_src`,
    )?.id,
  );

  const ruleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_rule`,
    title: 'K1.4C rule',
  });
  const ruleId = String(
    (ruleOut.refreshed.aggregate.tax_knowledge as { rules: Array<Record<string, unknown>> }).rules.find(
      (row) => row.rule_code === `${marker}_rule`,
    )?.id,
  );
  const versionOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
    tax_rule_id: ruleId,
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    effective_from: '2024-01-01',
    payload_json: k1Payload(),
  });
  const versionId = String(
    (versionOut.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }).rule_versions.find(
      (row) => row.tax_rule_id === ruleId,
    )?.id,
  );

  const legalValueId = randomUUID();
  const usLegalValueId = randomUUID();
  const { error: lvErr } = await supabaseAdmin.from('country_legal_values').insert([
    {
      id: legalValueId,
      country_code: 'IL',
      value_key: `${marker}_lv`,
      label: 'K1.4C legal value',
      category: 'Tax',
      module_scope: 'tax',
      value_type: 'number',
      status: 'active',
    },
    {
      id: usLegalValueId,
      country_code: 'US',
      value_key: `${marker}_us_lv`,
      label: 'K1.4C US legal value',
      category: 'Tax',
      module_scope: 'tax',
      value_type: 'number',
      status: 'active',
    },
  ]);
  if (lvErr) throw new Error(`country_legal_values insert failed: ${errText(lvErr)}`);

  await t.test('pin requires existing version; same-country; draft source allowed', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
          tax_rule_version_id: randomUUID(),
          tax_source_id: sourceId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
          tax_rule_version_id: versionId,
          tax_source_id: usSourceId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    const pinned = await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      locator: '  ',
    });
    assert.equal(pinned.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const version = (
      pinned.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId);
    const citations = version?.sources as Array<Record<string, unknown>>;
    assert.equal(citations.length, 1);
    assert.equal(citations[0].locator, null);
    assert.equal(citations[0].status, 'draft');
    assert.equal(citations[0].source_code, `${marker}_src`);
  });

  await t.test('locator NULL/blank is one citation; exact duplicate conflicts; distinct locator allowed', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
          tax_rule_version_id: versionId,
          tax_source_id: sourceId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const located = await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      locator: 'art. 1',
    });
    const citations = (
      (located.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }).rule_versions.find(
        (row) => row.id === versionId,
      )?.sources as Array<Record<string, unknown>>
    );
    assert.equal(citations.length, 2);
  });

  await t.test('unpin removes only exact citation while parent is draft', async () => {
    const version = (
      (await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
        tax_rule_id: ruleId,
        owner_note: 'refresh',
      })).refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId);
    const located = (version?.sources as Array<Record<string, unknown>>).find((row) => row.locator === 'art. 1');
    const unpinned = await executeTaxKnowledgeCommand(ownerCtx, 'unpin_tax_rule_version_source', {
      tax_rule_version_source_id: String(located?.id),
    });
    const remaining = (
      unpinned.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId)?.sources as Array<Record<string, unknown>>;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].locator, null);
  });

  await t.test('bind requires existing same-country legal_value; rejects version/amount fields', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
          tax_rule_version_id: versionId,
          legal_value_id: randomUUID(),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
          tax_rule_version_id: versionId,
          legal_value_id: usLegalValueId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
          tax_rule_version_id: versionId,
          legal_value_id: legalValueId,
          legal_value_version_id: randomUUID(),
          rate: 17,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    const bound = await executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
      tax_rule_version_id: versionId,
      legal_value_id: legalValueId,
    });
    const bindings = (
      bound.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId)?.legal_value_bindings as Array<Record<string, unknown>>;
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].legal_value_id, legalValueId);
    assert.equal(bindings[0].value_key, `${marker}_lv`);
    assert.equal(Object.prototype.hasOwnProperty.call(bindings[0], 'legal_value_version_id'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bindings[0], 'rate'), false);
    assert.equal(bound.ok, true);
    assert.equal(bound.command, 'bind_tax_rule_version_legal_value');

    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
          tax_rule_version_id: versionId,
          legal_value_id: legalValueId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('unbind removes only exact binding; published parent blocks all four', async () => {
    const version = (
      (await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
        tax_rule_id: ruleId,
        title: 'K1.4C rule',
      })).refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId);
    const bindingId = String((version?.legal_value_bindings as Array<Record<string, unknown>>)[0].id);
    const unbound = await executeTaxKnowledgeCommand(ownerCtx, 'unbind_tax_rule_version_legal_value', {
      tax_rule_version_legal_value_id: bindingId,
    });
    const remaining = (
      unbound.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId)?.legal_value_bindings as Array<Record<string, unknown>>;
    assert.equal(remaining.length, 0);

    await supabaseAdmin.from('tax_sources').update({ status: 'active' }).eq('id', sourceId);
    const cite = await supabaseAdmin.from('tax_rule_version_sources').select('id').eq('tax_rule_version_id', versionId);
    if (!cite.data?.length) {
      await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
        tax_rule_version_id: versionId,
        tax_source_id: sourceId,
      });
    }
    const activated = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    if (activated.error) {
      t.skip(`could not activate fixture version: ${errText(activated.error)}`);
      return;
    }
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
          tax_rule_version_id: versionId,
          tax_source_id: sourceId,
          locator: 'later',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const leftover = (
      unbound.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === versionId)?.sources as Array<Record<string, unknown>>;
    if (leftover?.[0]?.id) {
      await assert.rejects(
        () =>
          executeTaxKnowledgeCommand(ownerCtx, 'unpin_tax_rule_version_source', {
            tax_rule_version_source_id: String(leftover[0].id),
          }),
        (err: unknown) => err instanceof AppError && err.statusCode === 409,
      );
    }
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'bind_tax_rule_version_legal_value', {
          tax_rule_version_id: versionId,
          legal_value_id: legalValueId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('audits emitted and implemented_commands includes K1.4C', async () => {
    const panel = versionOut.refreshed.aggregate.tax_knowledge as {
      implemented_commands: string[];
      allowed_actions: Array<{ action_key: string }>;
    };
    for (const command of NEW_COMMANDS) {
      assert.ok(panel.implemented_commands.includes(command), command);
    }
    assert.deepEqual(
      panel.allowed_actions.map((a) => a.action_key),
      ['create_tax_source', 'create_tax_rule'],
    );
    const { data: audits, error } = await supabaseAdmin
      .from('audit_log')
      .select('action')
      .in('action', [
        'tax_rule_version_source_pinned',
        'tax_rule_version_source_unpinned',
        'tax_rule_version_legal_value_bound',
        'tax_rule_version_legal_value_unbound',
      ])
      .limit(20);
    if (error && !isSupabaseMissingTableError(error, 'audit_log')) throw new Error(errText(error));
    if (audits) {
      const seen = new Set(audits.map((row) => row.action));
      for (const action of [
        'tax_rule_version_source_pinned',
        'tax_rule_version_source_unpinned',
        'tax_rule_version_legal_value_bound',
        'tax_rule_version_legal_value_unbound',
      ]) {
        assert.ok(seen.has(action), `missing audit ${action}`);
      }
    }
  });
});
