import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const K14F_ALLOWED = [
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

const UNCHANGED_MIGRATIONS = [
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

function k1Payload(notes = 'k14f'): Record<string, unknown> {
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

function rpcMissing(error: { code?: string; message?: string; details?: string; hint?: string } | null): boolean {
  const blob = errText(error);
  return (
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    /function .*tax_knowledge_supersede_tax_rule_version/i.test(blob) ||
    /Could not find the function/i.test(blob)
  );
}

test('TAX-K1.4F contract: dispatcher, owner, atomic RPC, no GET/PATCH/frontend/org', () => {
  // 1 dispatcher recognizes command
  assert.equal(isTaxKnowledgeCommand('supersede_tax_rule_version'), true);
  assert.equal(TAX_KNOWLEDGE_COMMANDS.length, 18);
  assert.equal(TAX_KNOWLEDGE_COMMANDS.includes('supersede_tax_rule_version'), true);

  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commandsSrc, /case 'supersede_tax_rule_version'/);
  assert.match(commandsSrc, /assertPlatformOwner\(ctx\)/);
  assert.doesNotMatch(commandsSrc, /organization_id:/);
  assert.doesNotMatch(commandsSrc, /resolveCountryContext\(/);

  const start = commandsSrc.indexOf('async function handleSupersedeTaxRuleVersion');
  const end = commandsSrc.indexOf('export async function executeTaxKnowledgeCommand');
  assert.ok(start >= 0 && end > start, 'handleSupersedeTaxRuleVersion must exist');
  const slice = commandsSrc.slice(start, end);
  // 2 Platform Owner is the shared dispatcher gate; handler still uses named ids only
  assert.match(slice, /asUuid\(payload\.new_tax_rule_version_id/);
  assert.match(slice, /asUuid\(payload\.old_tax_rule_version_id/);
  assert.doesNotMatch(slice, /payload\.country_code|asCountryCode\(/);
  assert.doesNotMatch(slice, /payload\.version_no|payload\.status|payload\.payload_checksum/);
  assert.match(commandsSrc, /organizationId:\s*null/);
  // 23 no GET/PATCH and not two independent updates
  assert.match(slice, /\.rpc\('tax_knowledge_supersede_tax_rule_version'/);
  assert.equal((slice.match(/\.rpc\(/g) || []).length, 1);
  assert.doesNotMatch(slice, /\.update\(/);
  assert.doesNotMatch(slice, /\.from\('tax_rule_versions'\)/);
  assert.doesNotMatch(slice, /order\('version_no'/);
  assert.doesNotMatch(slice, /latest/i);
  // 19 audit only after successful RPC
  const rpcAt = slice.indexOf(".rpc('tax_knowledge_supersede_tax_rule_version'");
  const auditAt = slice.indexOf('TAX_RULE_VERSION_SUPERSEDED');
  assert.ok(rpcAt >= 0 && auditAt > rpcAt, 'audit must follow successful RPC');
  assert.match(slice, /old_tax_rule_version_id: oldId/);
  assert.match(slice, /new_tax_rule_version_id: newId/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
  const routesDiff = execSync('git diff -- apps/api/src/routes/owner-country-pack.routes.ts', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(routesDiff.trim(), '', 'owner routes must not change in K1.4F');
});

test('TAX-K1.4F contract: migration 605 atomic RPC shape; 600–604 publication owners stay', () => {
  const sql605 = readRepo('supabase/migrations/605_tax_knowledge_atomic_supersession.sql');
  assert.match(sql605, /create or replace function public\.tax_knowledge_supersede_tax_rule_version/);
  assert.match(sql605, /security definer/i);
  assert.match(sql605, /set search_path = public/);
  assert.match(sql605, /p_new_tax_rule_version_id uuid/);
  assert.match(sql605, /p_old_tax_rule_version_id uuid/);
  assert.doesNotMatch(sql605, /p_country_code|p_version_no|p_checksum|p_status/);
  assert.match(sql605, /order by id\s+for update/i);
  assert.match(sql605, /requires the NEW version to be draft/);
  assert.match(sql605, /requires the OLD version to be active/);
  assert.match(sql605, /same tax_rule/);
  assert.match(sql605, /same country/);
  assert.match(sql605, /supersedes_version_id must be empty or exactly the OLD version/);
  assert.match(sql605, /status = 'superseded'/);
  assert.match(sql605, /superseded_by_version_id = v_new\.id/);
  assert.match(sql605, /supersedes_version_id = v_old\.id/);
  assert.match(sql605, /status = 'active'/);
  const oldUpdate = sql605.indexOf("status = 'superseded'");
  const newUpdate = sql605.lastIndexOf("status = 'active'");
  assert.ok(oldUpdate >= 0 && newUpdate > oldUpdate, 'OLD must be superseded before NEW activates');
  assert.doesNotMatch(sql605, /disable trigger/i);
  assert.doesNotMatch(sql605, /session_replication_role/i);
  assert.doesNotMatch(sql605, /alter table public\.tax_rule_versions_guard/);
  assert.doesNotMatch(sql605, /order by version_no/i);
  assert.doesNotMatch(sql605, /where status = 'active'[\s\S]*limit 1/i);
  assert.doesNotMatch(sql605, /organization_id/);
  assert.match(sql605, /revoke all on function public\.tax_knowledge_supersede_tax_rule_version/);
  assert.match(sql605, /grant execute on function public\.tax_knowledge_supersede_tax_rule_version\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(sql605, /grant execute[^\n]+to (anon|authenticated|public)/i);

  const sql600 = readRepo('supabase/migrations/600_tax_knowledge_core_foundation.sql');
  assert.match(sql600, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(sql600, /old\.status = 'active' and new\.status in \('superseded', 'retired'\)/);
  assert.match(sql600, /tax_rule_versions_no_active_overlap/);
  const sql602 = readRepo('supabase/migrations/602_tax_knowledge_publication_guard.sql');
  assert.match(sql602, /when \(old\.status = 'draft' and new\.status = 'active'\)/);
  const sql604 = readRepo('supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql');
  assert.match(sql604, /when \(old\.status = 'draft' and new\.status = 'active'\)/);
});

test('TAX-K1.4F contract: aggregate actions, audit, 18 commands, no frontend', () => {
  const typesSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  assert.match(typesSrc, /'supersede_tax_rule_version'/);
  assert.match(typesSrc, /OwnerTaxKnowledgeSupersessionPair/);
  assert.match(typesSrc, /candidates\?: OwnerTaxKnowledgeSupersessionPair\[\]/);

  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.match(readSrc, /implemented_commands: \[\.\.\.TAX_KNOWLEDGE_COMMANDS\]/);
  assert.match(readSrc, /function eligibleSupersessionPairs/);
  assert.match(readSrc, /function supersedeAllowedAction/);
  assert.match(readSrc, /candidates\.length === 1/);
  assert.doesNotMatch(readSrc, /action\('supersede_tax_rule_version', draft \|\| active/);
  assert.doesNotMatch(readSrc, /order by version_no/i);
  assert.doesNotMatch(readSrc, /latest/i);
  assert.doesNotMatch(readSrc, /organization_id/);
  const catalog = readSrc.slice(
    readSrc.indexOf('function catalogAllowedActions'),
    readSrc.indexOf('async function loadCountryCatalog'),
  );
  assert.match(catalog, /create_tax_source/);
  assert.match(catalog, /create_tax_rule/);
  assert.doesNotMatch(catalog, /supersede_tax_rule_version/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_RULE_VERSION_SUPERSEDED:\s*'tax_rule_version_superseded'/);

  const webHits = porcelainPaths().filter((path) => path.startsWith('apps/web/'));
  assert.deepEqual(webHits, [], '24) frontend files must not change');
});

test('TAX-K1.4F contract: migrations 600–604 present, 605 is atomic supersession, no 606+', () => {
  for (const file of UNCHANGED_MIGRATIONS) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must exist`);
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const migrationsDir = join(repoRoot, 'supabase/migrations');
  const taxBrainMigrations = readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 600 && Number(name.slice(0, 3)) <= 699)
    .sort();
  assert.deepEqual(taxBrainMigrations, [
    '600_tax_knowledge_core_foundation.sql',
    '601_tax_knowledge_provenance_links.sql',
    '602_tax_knowledge_publication_guard.sql',
    '603_tax_knowledge_rule_relationships.sql',
    '604_tax_knowledge_relationship_publication_guard.sql',
    '605_tax_knowledge_atomic_supersession.sql',
  ]);
  assert.equal(existsSync(join(migrationsDir, '605_tax_knowledge_commands.sql')), false);
  const diff605 = execSync('git diff -- supabase/migrations/605_tax_knowledge_atomic_supersession.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(diff605.trim(), '', 'migration 605 must remain unchanged');
  const unexpected = porcelainPaths().filter((path) => !K14F_ALLOWED.includes(path as (typeof K14F_ALLOWED)[number]));
  assert.deepEqual(unexpected, [], `28) unrelated files changed: ${unexpected.join(', ')}`);
});

test('TAX-K1.4F commands require Platform Owner', async (t) => {
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
  await assert.rejects(
    () =>
      executeTaxKnowledgeCommand(tenantCtx, 'supersede_tax_rule_version', {
        new_tax_rule_version_id: randomUUID(),
        old_tax_rule_version_id: randomUUID(),
      }),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test('TAX-K1.4F live atomic supersession', async (t) => {
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

  const rpcProbe = await supabaseAdmin.rpc('tax_knowledge_supersede_tax_rule_version', {
    p_new_tax_rule_version_id: randomUUID(),
    p_old_tax_rule_version_id: randomUUID(),
  });
  if (rpcMissing(rpcProbe.error)) {
    t.skip('migration 605 not applied');
    return;
  }

  const { executeTaxKnowledgeCommand } = await import(
    '../../src/domains/tax-knowledge/tax-knowledge-commands.service.js'
  );

  const marker = `tk14f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    title: 'K1.4F source',
    provenance_type: 'official_guidance',
  });
  const sourceId = String(taxKnowledge(sourceOut).sources.find((row) => row.source_code === `${marker}_src`)?.id);
  await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', { tax_source_id: sourceId });

  const ruleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_rule`,
    title: 'K1.4F rule',
  });
  const ruleId = String(taxKnowledge(ruleOut).rules.find((row) => row.rule_code === `${marker}_rule`)?.id);
  const otherRuleOut = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule', {
    country_code: 'IL',
    rule_code: `${marker}_other`,
    title: 'K1.4F other rule',
  });
  const otherRuleId = String(taxKnowledge(otherRuleOut).rules.find((row) => row.rule_code === `${marker}_other`)?.id);

  async function createVersion(
    targetRuleId: string,
    notes: string,
    from = '2024-01-01',
    to?: string,
    supersedes?: string,
  ): Promise<string> {
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_version', {
      tax_rule_id: targetRuleId,
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      effective_from: from,
      effective_to: to,
      payload_json: k1Payload(notes),
      ...(supersedes ? { supersedes_version_id: supersedes } : {}),
    });
    const versions = taxKnowledge(out).rule_versions.filter((row) => row.tax_rule_id === targetRuleId);
    return String(versions.sort((a, b) => Number(a.version_no) - Number(b.version_no)).at(-1)?.id);
  }

  async function pin(versionId: string): Promise<void> {
    await executeTaxKnowledgeCommand(ownerCtx, 'pin_tax_rule_version_source', {
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
    });
  }

  async function statuses(ids: string[]): Promise<Array<{ id: string; status: string; supersedes_version_id: string | null }>> {
    const { data, error } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, status, supersedes_version_id')
      .in('id', ids);
    if (error) throw new Error(errText(error));
    return (data ?? []) as Array<{ id: string; status: string; supersedes_version_id: string | null }>;
  }

  const oldId = await createVersion(ruleId, 'old-active', '2024-01-01', '2024-12-31');
  await pin(oldId);
  await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: oldId });

  const newId = await createVersion(ruleId, 'new-draft', '2024-01-01', '2024-12-31');
  const noCiteId = await createVersion(ruleId, 'no-cite', '2025-01-01', '2025-06-30');
  const otherDraftId = await createVersion(otherRuleId, 'other-draft', '2024-01-01', '2024-12-31');
  await pin(otherDraftId);
  const otherActiveId = await createVersion(otherRuleId, 'other-active', '2025-01-01', '2025-12-31');
  await pin(otherActiveId);
  await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: otherActiveId });
  const toDraftId = await createVersion(otherRuleId, 'to-draft', '2026-01-01', '2026-06-30');
  const blockingNewId = await createVersion(ruleId, 'blocking-new', '2025-07-01', '2025-12-31');
  await pin(blockingNewId);
  await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_rule_relationship', {
    from_tax_rule_version_id: blockingNewId,
    to_tax_rule_version_id: toDraftId,
    relationship_type: 'depends_on',
  });
  const sibling = await createVersion(ruleId, 'sibling-retired', '2023-01-01', '2023-06-30');
  await pin(sibling);
  await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_rule_version', { tax_rule_version_id: sibling });
  const unsafeLineageId = await createVersion(ruleId, 'unsafe-lineage', '2026-07-01', '2026-12-31', sibling);
  await pin(unsafeLineageId);

  await t.test('backend owns supersession pairing; UI does not search counterparts', async () => {
    const snap = taxKnowledge(
      await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_rule_metadata', {
        tax_rule_id: ruleId,
        owner_note: 'pairing-snapshot',
      }),
    );
    type SupersedeAction = {
      action_key: string;
      enabled: boolean;
      payload: Record<string, string>;
      candidates?: Array<{ new_tax_rule_version_id: string; old_tax_rule_version_id: string }>;
    };
    const draftAction = (
      snap.rule_versions.find((row) => row.id === newId)?.allowed_actions as SupersedeAction[]
    ).find((a) => a.action_key === 'supersede_tax_rule_version');
    assert.equal(draftAction?.enabled, true);
    assert.deepEqual(draftAction?.candidates, [
      { new_tax_rule_version_id: newId, old_tax_rule_version_id: oldId },
    ]);
    assert.equal(draftAction?.payload.new_tax_rule_version_id, newId);
    assert.equal(draftAction?.payload.old_tax_rule_version_id, oldId);

    const oldAction = (
      snap.rule_versions.find((row) => row.id === oldId)?.allowed_actions as SupersedeAction[]
    ).find((a) => a.action_key === 'supersede_tax_rule_version');
    assert.equal(oldAction?.enabled, true);
    const oldPairs = oldAction?.candidates ?? [];
    assert.ok(oldPairs.length > 1, 'active row lists every eligible draft, not a latest fallback');
    assert.ok(oldPairs.every((pair) => pair.old_tax_rule_version_id === oldId));
    assert.ok(oldPairs.some((pair) => pair.new_tax_rule_version_id === newId));
    assert.ok(oldPairs.some((pair) => pair.new_tax_rule_version_id === noCiteId));
    assert.equal(
      oldPairs.some((pair) => pair.new_tax_rule_version_id === unsafeLineageId),
      false,
    );
    assert.equal(oldAction?.payload.new_tax_rule_version_id, '');
    assert.equal(oldAction?.payload.old_tax_rule_version_id, '');
  });

  await t.test('3-9 NEW/OLD existence, draft/active, same rule/country, no self', async () => {
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: randomUUID(),
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: newId,
          old_tax_rule_version_id: randomUUID(),
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: oldId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: oldId,
          old_tax_rule_version_id: newId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: newId,
          old_tax_rule_version_id: otherActiveId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: otherDraftId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: unsafeLineageId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
  });

  await t.test('13/15/16/17 602 blocks NEW without provenance and rolls back', async () => {
    const before = await statuses([oldId, noCiteId]);
    assert.equal(before.find((row) => row.id === oldId)?.status, 'active');
    assert.equal(before.find((row) => row.id === noCiteId)?.status, 'draft');
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: noCiteId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const after = await statuses([oldId, noCiteId]);
    assert.equal(after.find((row) => row.id === oldId)?.status, 'active');
    assert.equal(after.find((row) => row.id === noCiteId)?.status, 'draft');
    assert.equal(after.find((row) => row.id === noCiteId)?.supersedes_version_id, null);
  });

  await t.test('14/15/16/17 604 blocks NEW with invalid blocking relationship and rolls back', async () => {
    const before = await statuses([oldId, blockingNewId]);
    assert.equal(before.find((row) => row.id === oldId)?.status, 'active');
    assert.equal(before.find((row) => row.id === blockingNewId)?.status, 'draft');
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: blockingNewId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const after = await statuses([oldId, blockingNewId]);
    assert.equal(after.find((row) => row.id === oldId)?.status, 'active');
    assert.equal(after.find((row) => row.id === blockingNewId)?.status, 'draft');
  });

  await t.test('19 failed supersession does not emit audit', async () => {
    const { data: before, error } = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .eq('action', 'tax_rule_version_superseded')
      .eq('entity_id', noCiteId);
    if (error && !isSupabaseMissingTableError(error, 'audit_log')) throw new Error(errText(error));
    const beforeCount = (before ?? []).length;
    await assert.rejects(
      () =>
        executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
          new_tax_rule_version_id: noCiteId,
          old_tax_rule_version_id: oldId,
        }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    const { data: after, error: afterErr } = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .eq('action', 'tax_rule_version_superseded')
      .eq('entity_id', noCiteId);
    if (afterErr && !isSupabaseMissingTableError(afterErr, 'audit_log')) throw new Error(errText(afterErr));
    assert.equal((after ?? []).length, beforeCount);
  });

  await t.test('10-12/18/20-22 successful atomic supersession', async () => {
    await pin(newId);
    const out = await executeTaxKnowledgeCommand(ownerCtx, 'supersede_tax_rule_version', {
      new_tax_rule_version_id: newId,
      old_tax_rule_version_id: oldId,
    });
    assert.equal(out.ok, true);
    assert.equal(out.command, 'supersede_tax_rule_version');
    assert.equal(out.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
    const tk = taxKnowledge(out);
    const neu = tk.rule_versions.find((row) => row.id === newId);
    const old = tk.rule_versions.find((row) => row.id === oldId);
    assert.equal(old?.status, 'superseded');
    assert.equal(neu?.status, 'active');
    assert.equal(neu?.supersedes_version_id, oldId);
    assert.equal(neu?.version_no, 2);
    const { data: dbOld, error: dbErr } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('status, superseded_by_version_id, payload_checksum')
      .eq('id', oldId)
      .single();
    if (dbErr) throw new Error(errText(dbErr));
    assert.equal(dbOld.status, 'superseded');
    assert.equal(dbOld.superseded_by_version_id, newId);

    const overlapDraft = await createVersion(ruleId, 'overlap-after', '2024-06-01', '2024-08-31');
    await pin(overlapDraft);
    await assert.rejects(
      () => executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_rule_version', { tax_rule_version_id: overlapDraft }),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );

    assert.ok(tk.implemented_commands.includes('supersede_tax_rule_version'));
    assert.deepEqual(
      tk.allowed_actions.map((a) => a.action_key),
      ['create_tax_source', 'create_tax_rule'],
    );
    const newActions = neu?.allowed_actions as Array<{
      action_key: string;
      enabled: boolean;
      payload?: Record<string, string>;
      candidates?: Array<{ new_tax_rule_version_id: string; old_tax_rule_version_id: string }>;
    }>;
    const oldActions = old?.allowed_actions as Array<{
      action_key: string;
      enabled: boolean;
      candidates?: unknown[];
    }>;
    const newSupersede = newActions.find((a) => a.action_key === 'supersede_tax_rule_version');
    const oldSupersede = oldActions.find((a) => a.action_key === 'supersede_tax_rule_version');
    assert.equal(newSupersede?.enabled, true);
    assert.ok((newSupersede?.candidates ?? []).every((pair) => pair.old_tax_rule_version_id === newId));
    assert.equal(oldSupersede?.enabled, false);
    assert.deepEqual(oldSupersede?.candidates ?? [], []);

    const { data: audits, error: auditErr } = await supabaseAdmin
      .from('audit_log')
      .select('action, organization_id, payload, entity_id')
      .eq('action', 'tax_rule_version_superseded')
      .eq('entity_id', newId)
      .limit(5);
    if (auditErr && !isSupabaseMissingTableError(auditErr, 'audit_log')) throw new Error(errText(auditErr));
    if (audits && audits.length) {
      assert.ok(audits.every((row) => row.organization_id == null));
      const payload = audits[0].payload as Record<string, unknown>;
      assert.equal(payload.old_tax_rule_version_id, oldId);
      assert.equal(payload.new_tax_rule_version_id, newId);
    }
  });
});
