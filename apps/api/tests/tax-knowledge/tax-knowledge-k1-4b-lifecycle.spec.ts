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
import {
  canonicalizeTaxRulePayload,
  taxRulePayloadChecksum,
} from '../../src/domains/tax-knowledge/tax-knowledge-checksum.pure.js';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const K14B_ALLOWED = [
  'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
  'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
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
] as const;

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
] as const;

const NEW_COMMANDS = [
  'create_tax_rule_version',
  'update_tax_rule_version_draft',
  'activate_tax_source',
  'retire_tax_source',
  'update_tax_source_metadata',
  'update_tax_rule_metadata',
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

function k1Payload(notes = 'k14b'): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes };
}

test('TAX-K1.4B contract: dispatcher recognizes all six new commands', () => {
  for (const command of NEW_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), true, command);
  }
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('create_tax_source'));
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('create_tax_rule'));
  assert.equal(isTaxKnowledgeCommand('activate_tax_rule_version'), true);
  assert.equal(isTaxKnowledgeCommand('pin_tax_source_citation'), false);
  assert.equal(isTaxKnowledgeCommand('bind_tax_legal_value'), false);
  assert.equal(isTaxKnowledgeCommand('retire_tax_rule_version'), true);
  assert.equal(isTaxKnowledgeCommand('supersede_tax_rule_version'), false);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}'`));
  }
  assert.match(commandsSrc, /assertPlatformOwner\(ctx\)/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext\(/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /isTaxKnowledgeCommand\(commandName\)/);
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-K1.4B contract: checksum is backend-owned and key-order stable', () => {
  const a = { statement: 'x', applies_if: null, notes: 'n', nested: { b: 2, a: 1 } };
  const b = { nested: { a: 1, b: 2 }, notes: 'n', applies_if: null, statement: 'x' };
  assert.equal(canonicalizeTaxRulePayload(a), canonicalizeTaxRulePayload(b));
  assert.equal(taxRulePayloadChecksum(a), taxRulePayloadChecksum(b));
  assert.match(taxRulePayloadChecksum(a), /^[a-f0-9]{64}$/);
  assert.notEqual(taxRulePayloadChecksum(a), taxRulePayloadChecksum({ ...a, notes: 'changed' }));

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /taxRulePayloadChecksum/);
  assert.match(commandsSrc, /nextVersionNo/);
  assert.doesNotMatch(commandsSrc, /payload_checksum:\s*payload\./);
  assert.doesNotMatch(commandsSrc, /version_no:\s*payload\./);
});

test('TAX-K1.4B contract: aggregate versions + backend allowed_actions, no future commands', () => {
  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /rule_versions/);
  assert.match(readSrc, /payload_checksum/);
  assert.match(readSrc, /update_tax_rule_version_draft/);
  assert.match(readSrc, /activate_tax_source/);
  assert.match(readSrc, /retire_tax_source/);
  assert.doesNotMatch(readSrc, /supersede_tax_rule_version/);
  assert.doesNotMatch(readSrc, /pin_tax_source/);
  assert.doesNotMatch(readSrc, /bind_legal_value/);
  assert.doesNotMatch(readSrc, /organization_id/);
  assert.doesNotMatch(readSrc, /resolveCountryContext\(/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_RULE_VERSION_CREATED:\s*'tax_rule_version_created'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_DRAFT_UPDATED:\s*'tax_rule_version_draft_updated'/);
  assert.match(auditSrc, /TAX_SOURCE_ACTIVATED:\s*'tax_source_activated'/);
  assert.match(auditSrc, /TAX_SOURCE_RETIRED:\s*'tax_source_retired'/);
  assert.match(auditSrc, /TAX_SOURCE_METADATA_UPDATED:\s*'tax_source_metadata_updated'/);
  assert.match(auditSrc, /TAX_RULE_METADATA_UPDATED:\s*'tax_rule_metadata_updated'/);
});

test('TAX-K1.4B contract: migrations 600–604 unchanged, no 605, no unrelated files', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_commands.sql')), false);
  const unexpected = porcelainPaths().filter((path) => !K14B_ALLOWED.includes(path as (typeof K14B_ALLOWED)[number]));
  assert.deepEqual(unexpected, [], `unrelated files changed: ${unexpected.join(', ')}`);
  assert.deepEqual(
    porcelainPaths().filter((path) => path.startsWith('apps/web/')),
    [],
    'frontend files must not change',
  );
  const routesDiff = execSync('git diff -- apps/api/src/routes/owner-country-pack.routes.ts', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(routesDiff.trim(), '', 'owner routes must not change in K1.4B');
});

test('TAX-K1.4B commands require Platform Owner', async (t) => {
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
        () => executeTaxKnowledgeCommand(tenantCtx, command, { tax_rule_id: randomUUID() }),
        (err: unknown) =>
          err instanceof AppError &&
          err.statusCode === 403 &&
          (err.code === 'PLATFORM_OWNER_REQUIRED' ||
            err.code === 'PLATFORM_OWNER_NOT_CONFIGURED' ||
            err.code === 'PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN'),
      );
    });
  }
});

test('TAX-K1.4B live draft version + source/rule lifecycle', async (t) => {
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
  const probe = await supabaseAdmin.from('tax_rule_versions').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_versions')) {
    t.skip('migration 600 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_versions probe failed: ${errText(probe.error)}`);

  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );

  const marker = `tk14b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    title: 'K1.4B source',
    provenance_type: 'official_guidance',
  });
  const source = (sourceOut.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }).sources.find(
    (row) => row.source_code === `${marker}_src`,
  );
  assert.ok(source);
  const sourceId = String(source.id);

  const ruleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_rule`,
    title: 'K1.4B rule',
  });
  const rule = (ruleOut.refreshed.aggregate.tax_knowledge as { rules: Array<Record<string, unknown>> }).rules.find(
    (row) => row.rule_code === `${marker}_rule`,
  );
  assert.ok(rule);
  const ruleId = String(rule.id);

  await t.test('create_tax_rule_version rejects unknown parent rule', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
          tax_rule_id: randomUUID(),
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          effective_from: '2024-01-01',
          payload_json: k1Payload(),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
  });

  await t.test('country derived from parent; pack/ruleset same-country; draft + checksum + version_no', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
          tax_rule_id: ruleId,
          country_code: 'US',
          country_pack_id: packUs,
          country_pack_ruleset_id: rulesetUs,
          effective_from: '2024-01-01',
          payload_json: k1Payload(),
        }),
      (err: unknown) => err instanceof AppError && (err.statusCode === 400 || err.statusCode === 404),
    );

    const expectedChecksum = taxRulePayloadChecksum({
      notes: 'one',
      applies_if: null,
      statement: 'string',
      does_not_apply_if: null,
    });
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
      tax_rule_id: ruleId,
      country_code: 'US',
      version_no: 99,
      payload_checksum: 'client-must-be-ignored',
      status: 'active',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      effective_from: '2024-01-01',
      payload_json: { notes: 'one', does_not_apply_if: null, statement: 'string', applies_if: null },
    });
    assert.equal(out.ok, true);
    assert.equal(out.command, 'create_tax_rule_version');
    assert.equal(out.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const tk = out.refreshed.aggregate.tax_knowledge as {
      rule_versions: Array<Record<string, unknown>>;
      implemented_commands: string[];
    };
    const version = tk.rule_versions.find((row) => row.tax_rule_id === ruleId);
    assert.ok(version);
    assert.equal(version.status, 'draft');
    assert.equal(version.version_no, 1);
    assert.equal(version.country_code, 'IL');
    assert.equal(version.payload_checksum, expectedChecksum);
    assert.notEqual(version.payload_checksum, 'client-must-be-ignored');
    assert.ok(!tk.implemented_commands.includes('supersede_tax_rule_version'));
  });

  await t.test('version_no increments; unique race maps to conflict', async () => {
    const second = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
      tax_rule_id: ruleId,
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      effective_from: '2025-01-01',
      payload_json: k1Payload('two'),
    });
    const versions = (
      second.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.filter((row) => row.tax_rule_id === ruleId);
    assert.deepEqual(
      versions.map((row) => row.version_no).sort(),
      [1, 2],
    );

    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      status: 'draft',
      effective_from: '2026-01-01',
      payload_json: k1Payload('dup'),
      payload_checksum: taxRulePayloadChecksum(k1Payload('dup')),
    });
    assert.ok(error, 'duplicate version_no must fail');
  });

  await t.test('update draft only; payload checksum recalculates; pack/ruleset revalidated', async () => {
    const { data: drafts } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, version_no, payload_checksum, status')
      .eq('tax_rule_id', ruleId)
      .eq('status', 'draft')
      .order('version_no');
    const draftId = String(drafts?.[0]?.id);
    const previousChecksum = String(drafts?.[0]?.payload_checksum);

    const updated = await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_version_draft', {
      tax_rule_version_id: draftId,
      payload_json: k1Payload('revised'),
    });
    const version = (
      updated.refreshed.aggregate.tax_knowledge as { rule_versions: Array<Record<string, unknown>> }
    ).rule_versions.find((row) => row.id === draftId);
    assert.ok(version);
    assert.equal(version.status, 'draft');
    assert.equal(version.payload_checksum, taxRulePayloadChecksum(k1Payload('revised')));
    assert.notEqual(version.payload_checksum, previousChecksum);

    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_version_draft', {
          tax_rule_version_id: draftId,
          country_pack_id: packUs,
          country_pack_ruleset_id: rulesetUs,
        }),
      (err: unknown) => err instanceof AppError && (err.statusCode === 400 || err.statusCode === 404),
    );
  });

  await t.test('non-draft version cannot be edited', async () => {
    const { data: draft } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id')
      .eq('tax_rule_id', ruleId)
      .eq('version_no', 2)
      .single();
    const versionId = String(draft?.id);
    const sourceActivate = await supabaseAdmin.from('tax_sources').update({ status: 'active' }).eq('id', sourceId);
    if (sourceActivate.error) throw new Error(errText(sourceActivate.error));
    const cite = await supabaseAdmin.from('tax_rule_version_sources').insert({
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      country_code: 'IL',
      locator: 'k14b',
    });
    if (cite.error && !isSupabaseMissingTableError(cite.error, 'tax_rule_version_sources')) {
      throw new Error(errText(cite.error));
    }
    const activated = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    if (activated.error) {
      t.skip(`could not activate fixture version: ${errText(activated.error)}`);
      return;
    }
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_version_draft', {
          tax_rule_version_id: versionId,
          payload_json: k1Payload('frozen'),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('source lifecycle draft→active / retire; invalid transitions rejected; no delete', async () => {
    const extra = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
      country_code: 'IL',
      source_code: `${marker}_src2`,
      title: 'lifecycle source',
      provenance_type: 'textbook',
    });
    const extraSource = (
      extra.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
    ).sources.find((row) => row.source_code === `${marker}_src2`);
    assert.ok(extraSource);
    const extraId = String(extraSource.id);

    const activated = await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', {
      tax_source_id: extraId,
    });
    assert.equal(activated.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const afterActivate = (
      activated.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
    ).sources.find((row) => row.id === extraId);
    assert.equal(afterActivate?.status, 'active');

    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', { tax_source_id: extraId }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    const retired = await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_source', {
      tax_source_id: extraId,
      reason: 'no longer current',
    });
    const afterRetire = (
      retired.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
    ).sources.find((row) => row.id === extraId);
    assert.equal(afterRetire?.status, 'retired');
    assert.equal(afterRetire?.retired_reason, 'no longer current');

    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_source', { tax_source_id: extraId }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    const del = await supabaseAdmin.from('tax_sources').delete().eq('id', extraId);
    assert.ok(del.error, 'historical source must not be hard-deleted');
  });

  await t.test('metadata commands cannot change identity; audits and full panel returned', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'update_tax_source_metadata', {
          tax_source_id: sourceId,
          country_code: 'US',
          source_code: 'hijack',
          title: 'noop',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
          tax_rule_id: ruleId,
          country_code: 'US',
          rule_code: 'hijack',
          rule_kind: 'workflow_rule',
          title: 'noop',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );

    const srcMeta = await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_source_metadata', {
      tax_source_id: sourceId,
      title: 'K1.4B source updated',
    });
    const ruleMeta = await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
      tax_rule_id: ruleId,
      title: 'K1.4B rule updated',
    });
    assert.equal(srcMeta.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    assert.equal(ruleMeta.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const tk = ruleMeta.refreshed.aggregate.tax_knowledge as {
      sources: Array<Record<string, unknown>>;
      rules: Array<Record<string, unknown>>;
      rule_versions: Array<Record<string, unknown>>;
    };
    assert.equal(tk.sources.find((row) => row.id === sourceId)?.title, 'K1.4B source updated');
    assert.equal(tk.sources.find((row) => row.id === sourceId)?.source_code, `${marker}_src`);
    assert.equal(tk.rules.find((row) => row.id === ruleId)?.title, 'K1.4B rule updated');
    assert.equal(tk.rules.find((row) => row.id === ruleId)?.rule_code, `${marker}_rule`);
    assert.ok(tk.rule_versions.length >= 1);
    const sourceActions = tk.sources.find((row) => row.id === sourceId)?.allowed_actions as Array<{
      action_key: string;
    }>;
    assert.ok(sourceActions.some((a) => a.action_key === 'update_tax_source_metadata'));
    assert.ok(!sourceActions.some((a) => a.action_key === 'activate_tax_rule_version'));
    assert.equal(Object.prototype.hasOwnProperty.call(tk, 'organization_id'), false);

    const expectedAudits = [
      'tax_rule_version_created',
      'tax_rule_version_draft_updated',
      'tax_source_activated',
      'tax_source_retired',
      'tax_source_metadata_updated',
      'tax_rule_metadata_updated',
    ];
    const { data: audits, error: auditErr } = await supabaseAdmin
      .from('audit_log')
      .select('action')
      .in('action', expectedAudits)
      .limit(20);
    if (auditErr && !isSupabaseMissingTableError(auditErr, 'audit_log')) {
      throw new Error(errText(auditErr));
    }
    if (audits) {
      const seen = new Set(audits.map((row) => row.action));
      for (const action of expectedAudits) {
        assert.ok(seen.has(action), `missing audit ${action}`);
      }
    }
  });
});
