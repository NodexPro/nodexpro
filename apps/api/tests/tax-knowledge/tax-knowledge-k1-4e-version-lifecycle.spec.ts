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

const K14E_ALLOWED = [
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
  'activate_tax_rule_version',
  'retire_tax_rule_version',
  'close_tax_rule_version_effective_to',
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

function k1Payload(notes = 'k14e'): Record<string, unknown> {
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

test('TAX-K1.4E contract: dispatcher recognizes implemented lifecycle commands only', () => {
  for (const command of NEW_COMMANDS) {
    assert.equal(isTaxKnowledgeCommand(command), true, command);
  }
  assert.equal(TAX_KNOWLEDGE_COMMANDS.length, 18);
  assert.equal(isTaxKnowledgeCommand('supersede_tax_rule_version'), true);
  assert.equal(isTaxKnowledgeCommand('reactivate_tax_rule_version'), false);
  assert.equal(isTaxKnowledgeCommand('reopen_tax_rule_version'), false);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}'`));
  }
  assert.match(commandsSrc, /case 'supersede_tax_rule_version'/);
  assert.match(commandsSrc, /assertOwnerLegalCommandAccess\(ctx, command, payload\)/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext\(/);
  assert.match(commandsSrc, /handleActivateTaxRuleVersion[\s\S]*\.update\(\{ status: 'active' \}\)/);
  assert.doesNotMatch(commandsSrc, /tax_rule_versions_guard_publication_provenance/);
  assert.doesNotMatch(commandsSrc, /tax_rule_versions_guard_publication_relationships/);
  assert.doesNotMatch(
    commandsSrc,
    /relationship_type in \(\s*'depends_on'/,
  );

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
  const routesDiff = execSync('git diff -- apps/api/src/routes/owner-country-pack.routes.ts', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(routesDiff.trim(), '', 'owner routes must not change in K1.4E');
});

test('TAX-K1.4E contract: migration 600 lifecycle + 602/604 remain publication owners', () => {
  const sql600 = readRepo('supabase/migrations/600_tax_knowledge_core_foundation.sql');
  assert.match(sql600, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(sql600, /old\.status = 'active' and new\.status in \('superseded', 'retired'\)/);
  assert.match(sql600, /old\.status = 'superseded' and new\.status = 'retired'/);
  assert.match(sql600, /retired_reason text null/);
  assert.match(sql600, /effective_to is frozen after supersession\/retirement/);
  assert.match(sql600, /effective_to cannot be cleared after close-out/);
  assert.match(sql600, /effective_to cannot be extended after leaving draft/);
  assert.match(sql600, /supersedes_version_id is distinct from new\.supersedes_version_id/);
  assert.match(sql600, /tax_rule_versions_no_active_overlap/);

  const sql602 = readRepo('supabase/migrations/602_tax_knowledge_publication_guard.sql');
  assert.match(sql602, /cannot activate without at least one citation to an active tax_source/);
  const sql604 = readRepo('supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql');
  assert.match(sql604, /cannot activate while a blocking relationship points to a non-active tax_rule_version/);
  assert.match(sql604, /conflicts_with and alternative_to do not block/);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /throwIfTaxRuleVersionLifecycleError/);
  assert.match(commandsSrc, /cannot activate without at least one citation/);
  assert.match(commandsSrc, /cannot activate while a blocking relationship/);

  const typesSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  for (const command of NEW_COMMANDS) {
    assert.match(typesSrc, new RegExp(`'${command}'`));
  }
  assert.match(typesSrc, /'supersede_tax_rule_version'/);

  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /activate_tax_rule_version/);
  assert.match(readSrc, /retire_tax_rule_version/);
  assert.match(readSrc, /close_tax_rule_version_effective_to/);
  assert.match(readSrc, /implemented_commands: \[\.\.\.TAX_KNOWLEDGE_COMMANDS\]/);
  assert.match(readSrc, /supersede_tax_rule_version/);
  assert.doesNotMatch(readSrc, /organization_id/);
  const catalog = readSrc.slice(
    readSrc.indexOf('function catalogAllowedActions'),
    readSrc.indexOf('async function loadCountryCatalog'),
  );
  assert.match(catalog, /create_tax_source/);
  assert.match(catalog, /create_tax_rule/);
  assert.doesNotMatch(catalog, /activate_tax_rule_version/);
  assert.doesNotMatch(catalog, /retire_tax_rule_version/);
  assert.doesNotMatch(catalog, /close_tax_rule_version_effective_to/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_RULE_VERSION_ACTIVATED:\s*'tax_rule_version_activated'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_RETIRED:\s*'tax_rule_version_retired'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_EFFECTIVE_TO_CLOSED:\s*'tax_rule_version_effective_to_closed'/);
  assert.match(auditSrc, /TAX_RULE_VERSION_SUPERSEDED/);
});

test('TAX-K1.4E contract: supersession uses one atomic RPC, not client multi-update', () => {
  const clientSrc = readRepo('apps/api/src/db/client.ts');
  assert.doesNotMatch(clientSrc, /withTransaction|begin\(/);
  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  const start = commandsSrc.indexOf('async function handleSupersedeTaxRuleVersion');
  const end = commandsSrc.indexOf('export async function executeTaxKnowledgeCommand');
  const slice = commandsSrc.slice(start, end);
  assert.match(slice, /\.rpc\('tax_knowledge_supersede_tax_rule_version'/);
  assert.doesNotMatch(slice, /\.update\(/);
  const sql600 = readRepo('supabase/migrations/600_tax_knowledge_core_foundation.sql');
  assert.match(
    sql600,
    /old\.supersedes_version_id is distinct from new\.supersedes_version_id/,
  );
  assert.match(sql600, /where \(status = 'active'\)/);
});

test('TAX-K1.4E contract: migrations 600–604 unchanged, no 605, no unrelated files', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_commands.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/605_tax_knowledge_version_lifecycle.sql')), false);
  const unexpected = porcelainPaths().filter((path) => !K14E_ALLOWED.includes(path as (typeof K14E_ALLOWED)[number]));
  assert.deepEqual(unexpected, [], `unrelated files changed: ${unexpected.join(', ')}`);
  assert.deepEqual(
    porcelainPaths().filter((path) => path.startsWith('apps/web/')),
    [],
    'frontend files must not change',
  );
});

test('TAX-K1.4E commands require Platform Owner', async (t) => {
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

test('TAX-K1.4E live version publication lifecycle', async (t) => {
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

  const marker = `tk14e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const rulesetIl = randomUUID();
  const { error: packErr } = await supabaseAdmin.from('country_packs').insert({
    id: packIl,
    country_code: 'IL',
    pack_code: `${marker}_il_pack`,
    name: `${marker} IL pack`,
    status: 'enabled',
    framework_version: '1.0.0',
    code_version: '1.0.0',
  });
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
    title: 'K1.4E source',
    provenance_type: 'official_guidance',
  });
  const sourceId = String(taxKnowledge(sourceOut).sources.find((row) => row.source_code === `${marker}_src`)?.id);
  await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', { tax_source_id: sourceId });

  const fromRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_from`,
    title: 'K1.4E from-rule',
  });
  const fromRuleId = String(taxKnowledge(fromRuleOut).rules.find((row) => row.rule_code === `${marker}_from`)?.id);
  const toRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_to`,
    title: 'K1.4E to-rule',
  });
  const toRuleId = String(taxKnowledge(toRuleOut).rules.find((row) => row.rule_code === `${marker}_to`)?.id);

  async function createVersion(
    ruleId: string,
    notes: string,
    from = '2024-01-01',
    to?: string,
  ): Promise<string> {
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
      tax_rule_id: ruleId,
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      effective_from: from,
      effective_to: to,
      payload_json: k1Payload(notes),
    });
    const versions = taxKnowledge(out).rule_versions.filter((row) => row.tax_rule_id === ruleId);
    return String(versions.sort((a, b) => Number(a.version_no) - Number(b.version_no)).at(-1)?.id);
  }

  const activateId = await createVersion(fromRuleId, 'activate', '2024-01-01', '2024-12-31');
  const retireDraftId = await createVersion(fromRuleId, 'retire-draft', '2024-06-01', '2024-06-30');
  const closeId = await createVersion(fromRuleId, 'close', '2025-01-01');
  const toDraftId = await createVersion(toRuleId, 'to-draft');

  await t.test('activate requires existing draft; 602 provenance; payload frozen', async () => {
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: randomUUID() }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: activateId }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: activateId,
      tax_source_id: sourceId,
    });
    const before = taxKnowledge(
      await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
        tax_rule_id: fromRuleId,
        owner_note: 'before-activate',
      }),
    ).rule_versions.find((row) => row.id === activateId);
    const activated = await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', {
      tax_rule_version_id: activateId,
    });
    assert.equal(activated.ok, true);
    assert.equal(activated.command, 'activate_tax_rule_version');
    assert.equal(activated.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const after = taxKnowledge(activated).rule_versions.find((row) => row.id === activateId);
    assert.equal(after?.status, 'active');
    assert.equal(after?.version_no, before?.version_no);
    assert.equal(after?.payload_checksum, before?.payload_checksum);
    assert.deepEqual(after?.payload_json, before?.payload_json);
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: activateId }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('604 blocking relationships still gate activation; conflicts_with does not', async () => {
    const blockingFrom = await createVersion(fromRuleId, 'block-from', '2026-01-01', '2026-12-31');
    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: blockingFrom,
      tax_source_id: sourceId,
    });
    await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
      from_tax_rule_version_id: blockingFrom,
      to_tax_rule_version_id: toDraftId,
      relationship_type: 'depends_on',
    });
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: blockingFrom }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await executeTaxKnowledgeCommand(ownerCtx, 'delete_tax_rule_relationship', {
      tax_rule_relationship_id: String(
        (
          taxKnowledge(
            await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
              tax_rule_id: fromRuleId,
              owner_note: 'drop-blocking',
            }),
          ).rule_versions.find((row) => row.id === blockingFrom)?.relationships as Array<Record<string, unknown>>
        )[0].id,
      ),
    });
    await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
      from_tax_rule_version_id: blockingFrom,
      to_tax_rule_version_id: toDraftId,
      relationship_type: 'conflicts_with',
    });
    const activated = await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', {
      tax_rule_version_id: blockingFrom,
    });
    assert.equal(taxKnowledge(activated).rule_versions.find((row) => row.id === blockingFrom)?.status, 'active');
    await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_rule_version', {
      tax_rule_version_id: blockingFrom,
      reason: 'clear overlap for later close fixture',
    });
  });

  await t.test('retire follows migration 600; no cascade; already retired conflicts', async () => {
    const retiredDraft = await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_rule_version', {
      tax_rule_version_id: retireDraftId,
      reason: 'draft unused',
    });
    assert.equal(taxKnowledge(retiredDraft).rule_versions.find((row) => row.id === retireDraftId)?.status, 'retired');
    const { data: leftoverVersion, error: leftoverErr } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, status')
      .eq('id', retireDraftId)
      .maybeSingle();
    if (leftoverErr) throw new Error(errText(leftoverErr));
    assert.equal(leftoverVersion?.status, 'retired');

    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: closeId,
      tax_source_id: sourceId,
    });
    const activatedClose = await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', {
      tax_rule_version_id: closeId,
    });
    assert.equal(taxKnowledge(activatedClose).rule_versions.find((row) => row.id === closeId)?.status, 'active');
    const citations = await supabaseAdmin
      .from('tax_rule_version_sources')
      .select('id')
      .eq('tax_rule_version_id', closeId);
    if (citations.error) throw new Error(errText(citations.error));
    assert.ok((citations.data ?? []).length >= 1);

    const supersededId = await createVersion(toRuleId, 'superseded-retire', '2025-01-01', '2025-12-31');
    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: supersededId,
      tax_source_id: sourceId,
    });
    await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: supersededId });
    const marked = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'superseded' })
      .eq('id', supersededId);
    if (marked.error) throw new Error(errText(marked.error));
    const retiredSuperseded = await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_rule_version', {
      tax_rule_version_id: supersededId,
    });
    assert.equal(
      taxKnowledge(retiredSuperseded).rule_versions.find((row) => row.id === supersededId)?.status,
      'retired',
    );
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_rule_version', { tax_rule_version_id: supersededId }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const stillCited = await supabaseAdmin
      .from('tax_rule_version_sources')
      .select('id')
      .eq('tax_rule_version_id', closeId);
    if (stillCited.error) throw new Error(errText(stillCited.error));
    assert.equal((stillCited.data ?? []).length, (citations.data ?? []).length);
  });

  await t.test('close effective_to is active-only, cannot extend/null/before from/frozen', async () => {
    const closed = await executeTaxKnowledgeCommand(ownerCtx, 'close_tax_rule_version_effective_to', {
      tax_rule_version_id: closeId,
      effective_to: '2025-12-31',
    });
    assert.equal(closed.ok, true);
    assert.equal(closed.command, 'close_tax_rule_version_effective_to');
    assert.equal(closed.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    assert.equal(taxKnowledge(closed).rule_versions.find((row) => row.id === closeId)?.effective_to, '2025-12-31');
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'close_tax_rule_version_effective_to', {
          tax_rule_version_id: closeId,
          effective_to: '2026-01-01',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'close_tax_rule_version_effective_to', {
          tax_rule_version_id: closeId,
          effective_to: null,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'close_tax_rule_version_effective_to', {
          tax_rule_version_id: closeId,
          effective_to: '2024-12-31',
        }),
      (err: unknown) => err instanceof AppError && (err.statusCode === 400 || err.statusCode === 409),
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'close_tax_rule_version_effective_to', {
          tax_rule_version_id: retireDraftId,
          effective_to: '2024-12-31',
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    const tk = taxKnowledge(closed);
    assert.deepEqual(
      tk.allowed_actions.map((a) => a.action_key),
      ['create_tax_source', 'create_tax_rule'],
    );
    for (const command of NEW_COMMANDS) {
      assert.ok(tk.implemented_commands.includes(command), command);
    }
    assert.ok(tk.implemented_commands.includes('supersede_tax_rule_version'));
    const activeActions = tk.rule_versions.find((row) => row.id === closeId)?.allowed_actions as Array<{
      action_key: string;
      enabled: boolean;
      candidates?: unknown[];
      payload?: Record<string, string>;
    }>;
    assert.equal(activeActions.find((a) => a.action_key === 'activate_tax_rule_version')?.enabled, false);
    assert.equal(activeActions.find((a) => a.action_key === 'retire_tax_rule_version')?.enabled, true);
    assert.equal(activeActions.find((a) => a.action_key === 'close_tax_rule_version_effective_to')?.enabled, true);
    const supersedeClose = activeActions.find((a) => a.action_key === 'supersede_tax_rule_version');
    assert.ok(supersedeClose);
    assert.equal(supersedeClose.enabled, false);
    assert.deepEqual(supersedeClose.candidates ?? [], []);
  });

  await t.test('audits emitted for implemented lifecycle commands', async () => {
    const { data: audits, error } = await supabaseAdmin
      .from('audit_log')
      .select('action, organization_id')
      .in('action', [
        'tax_rule_version_activated',
        'tax_rule_version_retired',
        'tax_rule_version_effective_to_closed',
      ])
      .limit(30);
    if (error && !isSupabaseMissingTableError(error, 'audit_log')) throw new Error(errText(error));
    if (audits) {
      const seen = new Set(audits.map((row) => row.action));
      assert.ok(seen.has('tax_rule_version_activated'));
      assert.ok(seen.has('tax_rule_version_retired'));
      assert.ok(seen.has('tax_rule_version_effective_to_closed'));
      assert.ok(audits.every((row) => row.organization_id == null));
    }
  });
});
