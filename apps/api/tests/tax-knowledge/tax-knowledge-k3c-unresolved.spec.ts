import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  TAX_KNOWLEDGE_COMMANDS,
  TAX_KNOWLEDGE_ERROR_CODES,
  TAX_RULE_RELATIONSHIP_TYPES,
  isTaxKnowledgeCommand,
} from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import {
  isExpectedPreK3cSchemaAbsence,
  parseActivationCritical,
  unresolvedRowBlocksActivation,
} from '../../src/domains/tax-knowledge/tax-knowledge-unresolved.pure.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sql607 = readFileSync(
  join(repoRoot, 'supabase/migrations/607_tax_knowledge_legal_links_unresolved.sql'),
  'utf8',
);

const FROZEN = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
  'supabase/migrations/606_tax_knowledge_service_role_dml.sql',
  'supabase/migrations/163_country_pack_service_role_dml.sql',
] as const;

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

test('TAX-K3C contract: 607 adds unresolved table and three relationship types', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/607_tax_knowledge_legal_links_unresolved.sql')), true);
  assert.match(sql607, /create table if not exists public\.tax_rule_unresolved_legal_references/);
  assert.match(sql607, /'applies_with'/);
  assert.match(sql607, /'calculation_basis'/);
  assert.match(sql607, /'procedural_requirement'/);
  assert.match(sql607, /activation_critical boolean null/);
  assert.match(sql607, /origin_unresolved_legal_reference_id/);
  assert.match(sql607, /uq_tax_rule_unresolved_identity/);
  assert.match(sql607, /TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);
  assert.match(sql607, /tax_knowledge_resolve_unresolved_legal_reference/);
  assert.doesNotMatch(sql607, /tax_knowledge\.allow_resolve/);
  assert.doesNotMatch(sql607, /set_config\s*\(/);
  assert.doesNotMatch(sql607, /current_setting\s*\(/);
  assert.match(sql607, /unique \(origin_unresolved_legal_reference_id\)/);
  assert.match(sql607, /tax_rule_unresolved_open_procedural_activation_critical_chk/);
  assert.match(sql607, /security definer/i);
  assert.match(sql607, /set search_path = pg_catalog, public/);
  assert.match(sql607, /current_user is distinct from session_user/);
  assert.match(sql607, /grant select, insert, update, delete on table public\.tax_rule_unresolved_legal_references to service_role/);
  assert.match(sql607, /revoke all on table public\.tax_rule_unresolved_legal_references from anon, authenticated/);
  assert.doesNotMatch(sql607, /grant all/i);
  assert.doesNotMatch(sql607, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql607, /explicit_legal_reference|implementation_guidance/);
  assert.doesNotMatch(sql607, /openai|anthropic|llm/i);

  for (const file of FROZEN) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }

  assert.equal(isTaxKnowledgeCommand('create_tax_rule_unresolved_legal_reference'), true);
  assert.equal(isTaxKnowledgeCommand('resolve_tax_rule_unresolved_legal_reference'), true);
  assert.equal(TAX_RULE_RELATIONSHIP_TYPES.includes('applies_with'), true);
  assert.equal(TAX_RULE_RELATIONSHIP_TYPES.includes('depends_on'), true);
  assert.equal(
    TAX_KNOWLEDGE_ERROR_CODES.UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION,
    'TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION',
  );
  assert.equal((TAX_KNOWLEDGE_COMMANDS as readonly string[]).includes('evaluate_tax_rules'), false);

  const commands = readFileSync(
    join(repoRoot, 'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts'),
    'utf8',
  );
  for (const command of [
    'create_tax_rule_unresolved_legal_reference',
    'update_tax_rule_unresolved_legal_reference',
    'accept_tax_rule_unresolved_legal_reference',
    'discard_tax_rule_unresolved_legal_reference',
    'resolve_tax_rule_unresolved_legal_reference',
  ]) {
    assert.match(commands, new RegExp(`case '${command}'`));
  }
  assert.match(commands, /unresolvedRowsBlockActivation/);
  assert.match(commands, /tax_knowledge_resolve_unresolved_legal_reference/);
  assert.match(commands, /TAX_KNOWLEDGE_ERROR_CODES\.UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);

  const routes = readFileSync(join(repoRoot, 'apps/api/src/routes/owner-country-pack.routes.ts'), 'utf8');
  assert.doesNotMatch(routes, /router\.get\('\/tax-knowledge'/);
  assert.doesNotMatch(routes, /router\.get\('\/unresolved/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-K3C pure: activation matrix and activation_critical rules', () => {
  assert.equal(unresolvedRowBlocksActivation({ status: 'draft', relationship_intent: 'elaborates', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'depends_on', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'exception_to', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'overrides', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'applies_with', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'calculation_basis', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'procedural_requirement', activation_critical: true }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'procedural_requirement', activation_critical: null }), true);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'procedural_requirement', activation_critical: false }), false);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'conflicts_with', activation_critical: null }), false);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'special_case_of', activation_critical: null }), false);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'elaborates', activation_critical: null }), false);
  assert.equal(unresolvedRowBlocksActivation({ status: 'open', relationship_intent: 'alternative_to', activation_critical: null }), false);

  assert.equal(parseActivationCritical(true, 'procedural_requirement', true), true);
  assert.equal(parseActivationCritical(undefined, 'procedural_requirement', false), null);
  assert.throws(() => parseActivationCritical(undefined, 'procedural_requirement', true));
  assert.throws(() => parseActivationCritical(true, 'depends_on', false));
});

test('TAX-K3C security: fallback occurs only for 42703 / 42P01, not arbitrary errors', () => {
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '42703' }, 'undefined_column'), true);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: 'PGRST204' }, 'undefined_column'), true);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '42P01' }, 'undefined_table'), true);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: 'PGRST205' }, 'undefined_table'), true);

  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '42501', message: 'permission denied' }, 'undefined_table'), false);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '42501', message: 'permission denied' }, 'undefined_column'), false);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '57014', message: 'statement timeout' }, 'undefined_table'), false);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: '08006', message: 'connection failure' }, 'undefined_table'), false);
  assert.equal(isExpectedPreK3cSchemaAbsence({ code: 'PGRST301', message: 'JWT expired' }, 'undefined_table'), false);
  assert.equal(
    isExpectedPreK3cSchemaAbsence(
      { message: 'relation tax_rule_unresolved_legal_references does not exist' },
      'undefined_table',
    ),
    false,
  );
  assert.equal(
    isExpectedPreK3cSchemaAbsence(
      { code: 'PGRST116', message: 'tax_rule_relationships column activation_critical' },
      'undefined_column',
    ),
    false,
  );
  assert.equal(isExpectedPreK3cSchemaAbsence(null, 'undefined_table'), false);

  const owner = readFileSync(
    join(repoRoot, 'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts'),
    'utf8',
  );
  const loader = readFileSync(
    join(repoRoot, 'apps/api/src/domains/tax-rule-engine/tax-rule-engine-read-models.service.ts'),
    'utf8',
  );
  const commands = readFileSync(
    join(repoRoot, 'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts'),
    'utf8',
  );
  assert.match(owner, /isExpectedPreK3cSchemaAbsence\(relationshipResult\.error, 'undefined_column'\)/);
  assert.match(owner, /isExpectedPreK3cSchemaAbsence\(unresolvedResult\.error, 'undefined_table'\)/);
  assert.match(loader, /isExpectedPreK3cSchemaAbsence\(relationshipResult\.error, 'undefined_column'\)/);
  assert.match(loader, /isExpectedPreK3cSchemaAbsence\(unresolvedResult\.error, 'undefined_table'\)/);
  assert.match(commands, /isExpectedPreK3cSchemaAbsence\(unresolvedErr, 'undefined_table'\)/);
  assert.doesNotMatch(loader, /isSupabaseMissingTableError/);
  assert.doesNotMatch(commands, /isSupabaseMissingTableError/);
});

test('TAX-K3C commands require Platform Owner', async (t) => {
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
      executeTaxKnowledgeCommand(tenantCtx as never, 'create_tax_rule_unresolved_legal_reference', {
        from_tax_rule_version_id: randomUUID(),
        relationship_intent: 'elaborates',
        cited_instrument_kind: 'regulation',
        locator_text: 'see תקנה 3',
      }),
    (error: unknown) => error instanceof Error,
  );
});

test('TAX-K3C DB: unresolved identity, country, and activation', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_unresolved_legal_references').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_unresolved_legal_references')) {
    t.skip('migration 607 not applied');
    return;
  }
  if (probe.error) throw new Error(`unresolved probe failed: ${errText(probe.error)}`);

  const marker = `tk3c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packId = randomUUID();
  const rulesetId = randomUUID();
  const sourceId = randomUUID();
  const usPackId = randomUUID();
  const usRulesetId = randomUUID();
  const usSourceId = randomUUID();
  const versionNoByRule = new Map<string, number>();

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'UTC' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const { error: packErr } = await supabaseAdmin.from('country_packs').insert([
    {
      id: packId,
      country_code: 'IL',
      pack_code: `${marker}_pack`,
      name: `${marker} pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
    {
      id: usPackId,
      country_code: 'US',
      pack_code: `${marker}_us_pack`,
      name: `${marker} us pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
  ]);
  if (packErr) throw new Error(`country_packs insert failed: ${errText(packErr)}`);

  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert([
    {
      id: rulesetId,
      country_pack_id: packId,
      ruleset_code: `${marker}_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
    {
      id: usRulesetId,
      country_pack_id: usPackId,
      ruleset_code: `${marker}_us_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
  ]);
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const { error: srcErr } = await supabaseAdmin.from('tax_sources').insert([
    {
      id: sourceId,
      country_code: 'IL',
      source_code: `${marker}_src`,
      title: 'K3C source',
      provenance_type: 'official_guidance',
      status: 'draft',
    },
    {
      id: usSourceId,
      country_code: 'US',
      source_code: `${marker}_us_src`,
      title: 'K3C US source',
      provenance_type: 'official_guidance',
      status: 'draft',
    },
  ]);
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);
  const { error: srcActErr } = await supabaseAdmin
    .from('tax_sources')
    .update({ status: 'active' })
    .in('id', [sourceId, usSourceId]);
  if (srcActErr) throw new Error(`tax_sources activate failed: ${errText(srcActErr)}`);

  async function insertDraft(
    ruleId: string,
    countryCode: 'IL' | 'US',
    countryPackId: string,
    countryPackRulesetId: string,
  ): Promise<string> {
    const id = randomUUID();
    const versionNo = versionNoByRule.get(ruleId) ?? 1;
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: ruleId,
      country_code: countryCode,
      country_pack_id: countryPackId,
      country_pack_ruleset_id: countryPackRulesetId,
      version_no: versionNo,
      status: 'draft',
      effective_from: '2026-01-01',
      payload_json: { statement: 'k3c', applies_if: null, does_not_apply_if: null },
      payload_checksum: `k3c-${id}`,
    });
    versionNoByRule.set(ruleId, versionNo + 1);
    if (error) throw new Error(`version insert failed: ${errText(error)}`);
    return id;
  }

  async function pin(versionId: string, taxSourceId: string, countryCode: 'IL' | 'US'): Promise<void> {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      tax_rule_version_id: versionId,
      tax_source_id: taxSourceId,
      country_code: countryCode,
      locator: 'art.1',
    });
    if (error) throw new Error(`pin failed: ${errText(error)}`);
  }

  async function newRule(suffix: string, countryCode: 'IL' | 'US' = 'IL'): Promise<{ ruleId: string; versionId: string }> {
    const ruleId = randomUUID();
    const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
      id: ruleId,
      country_code: countryCode,
      rule_code: `${marker}_${suffix}`,
      title: `Rule ${suffix}`,
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    if (ruleErr) throw new Error(`tax_rules insert failed (${suffix}): ${errText(ruleErr)}`);
    const versionId = await insertDraft(
      ruleId,
      countryCode,
      countryCode === 'IL' ? packId : usPackId,
      countryCode === 'IL' ? rulesetId : usRulesetId,
    );
    await pin(versionId, countryCode === 'IL' ? sourceId : usSourceId, countryCode);
    return { ruleId, versionId };
  }

  async function insertUnresolved(
    fromVersionId: string,
    fields: Record<string, unknown>,
  ): Promise<{ id?: string; error: { message?: string; code?: string; details?: string; hint?: string } | null }> {
    const { data, error } = await supabaseAdmin
      .from('tax_rule_unresolved_legal_references')
      .insert({
        country_code: 'IL',
        from_tax_rule_version_id: fromVersionId,
        cited_instrument_kind: 'regulation',
        ...fields,
      })
      .select('id')
      .maybeSingle();
    return { id: data?.id, error };
  }

  async function tryActivate(versionId: string) {
    return supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
  }

  const toIl = await newRule('to');
  const { error: toActErr } = await tryActivate(toIl.versionId);
  if (toActErr) throw new Error(`activate IL TO failed: ${errText(toActErr)}`);
  const toUs = await newRule('to_us', 'US');
  const { error: toUsActErr } = await tryActivate(toUs.versionId);
  if (toUsActErr) throw new Error(`activate US TO failed: ${errText(toUsActErr)}`);

  const identity = await newRule('identity');
  const locator = 'see תקנה 3';
  const { error: missingLocatorErr } = await insertUnresolved(identity.versionId, {
    relationship_intent: 'elaborates',
    locator_text: '   ',
    status: 'open',
  });
  assert.ok(missingLocatorErr, 'empty locator must be rejected');

  const { error: criticalErr } = await insertUnresolved(identity.versionId, {
    relationship_intent: 'depends_on',
    activation_critical: true,
    locator_text: 'depends with critical',
    status: 'open',
  });
  assert.ok(criticalErr, 'non-procedural activation_critical must be rejected');

  const { error: countryMismatchErr } = await supabaseAdmin.from('tax_rule_unresolved_legal_references').insert({
    country_code: 'US',
    from_tax_rule_version_id: identity.versionId,
    relationship_intent: 'elaborates',
    cited_instrument_kind: 'regulation',
    locator_text: 'cross-country from',
    status: 'open',
  });
  assert.ok(countryMismatchErr, 'unresolved FROM must stay same-country');

  const draftBlock = await newRule('draft_block');
  const { error: draftInsertErr } = await insertUnresolved(draftBlock.versionId, {
    relationship_intent: 'elaborates',
    locator_text: 'draft citation',
    status: 'draft',
  });
  if (draftInsertErr) throw new Error(`draft unresolved insert failed: ${errText(draftInsertErr)}`);
  const { error: draftBlockedErr } = await tryActivate(draftBlock.versionId);
  assert.ok(draftBlockedErr, 'draft unresolved must block activation');
  assert.match(String(draftBlockedErr?.message ?? ''), /TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);

  for (const intent of ['depends_on', 'exception_to', 'overrides', 'applies_with', 'calculation_basis'] as const) {
    const scenario = await newRule(intent);
    const { error: insertErr } = await insertUnresolved(scenario.versionId, {
      relationship_intent: intent,
      locator_text: `open ${intent}`,
      status: 'open',
    });
    if (insertErr) throw new Error(`open ${intent} insert failed: ${errText(insertErr)}`);
    const { error: blockedErr } = await tryActivate(scenario.versionId);
    assert.ok(blockedErr, `open ${intent} must block activation`);
    assert.match(String(blockedErr?.message ?? ''), /TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);
  }

  const procTrue = await newRule('proc_true');
  const { error: procTrueInsertErr } = await insertUnresolved(procTrue.versionId, {
    relationship_intent: 'procedural_requirement',
    activation_critical: true,
    locator_text: 'mandatory procedure',
    status: 'open',
  });
  if (procTrueInsertErr) throw new Error(`open procedural true insert failed: ${errText(procTrueInsertErr)}`);
  const { error: procTrueBlockedErr } = await tryActivate(procTrue.versionId);
  assert.ok(procTrueBlockedErr, 'open procedural true must block activation');
  assert.match(String(procTrueBlockedErr?.message ?? ''), /TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);

  const procDraft = await newRule('proc_draft');
  const { error: procDraftInsertErr } = await insertUnresolved(procDraft.versionId, {
    relationship_intent: 'procedural_requirement',
    activation_critical: null,
    locator_text: 'draft unset procedure',
    status: 'draft',
  });
  if (procDraftInsertErr) throw new Error(`draft procedural unset insert failed: ${errText(procDraftInsertErr)}`);
  const { error: procDraftBlockedErr } = await tryActivate(procDraft.versionId);
  assert.ok(procDraftBlockedErr, 'draft procedural unset must block activation');
  assert.match(String(procDraftBlockedErr?.message ?? ''), /TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION/);

  for (const intent of ['conflicts_with', 'elaborates'] as const) {
    const scenario = await newRule(`allow_${intent}`);
    const { error: insertErr } = await insertUnresolved(scenario.versionId, {
      relationship_intent: intent,
      locator_text: `open ${intent} allowed`,
      status: 'open',
    });
    if (insertErr) throw new Error(`open ${intent} insert failed: ${errText(insertErr)}`);
    const { error: activateErr } = await tryActivate(scenario.versionId);
    assert.equal(activateErr, null, `open ${intent} should allow activation: ${errText(activateErr)}`);
  }

  const procFalse = await newRule('proc_false');
  const { id: openProcFalseId, error: openErr } = await insertUnresolved(procFalse.versionId, {
    relationship_intent: 'procedural_requirement',
    activation_critical: false,
    cited_provision_number: '3',
    locator_text: locator,
    status: 'open',
  });
  if (openErr || !openProcFalseId) throw new Error(`open procedural false insert failed: ${errText(openErr)}`);

  const { error: dupErr } = await insertUnresolved(procFalse.versionId, {
    relationship_intent: 'procedural_requirement',
    activation_critical: false,
    locator_text: locator,
    status: 'open',
  });
  assert.ok(dupErr, 'unique identity must reject duplicate locator+intent');

  const { error: activateOkErr } = await tryActivate(procFalse.versionId);
  assert.equal(activateOkErr, null, `procedural false should allow activation: ${errText(activateOkErr)}`);

  const { error: ordinaryCreateErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: procFalse.versionId,
    to_tax_rule_version_id: toIl.versionId,
    relationship_type: 'elaborates',
    status: 'active',
  });
  assert.ok(ordinaryCreateErr, 'ordinary relationship create must stay forbidden after FROM active');

  const { error: crossCountryResolveErr } = await supabaseAdmin.rpc(
    'tax_knowledge_resolve_unresolved_legal_reference',
    { p_unresolved_id: openProcFalseId, p_to_tax_rule_version_id: toUs.versionId },
  );
  assert.ok(crossCountryResolveErr, 'resolve must reject a cross-country TO');

  const { data: resolvedActive, error: rpcActiveErr } = await supabaseAdmin.rpc(
    'tax_knowledge_resolve_unresolved_legal_reference',
    { p_unresolved_id: openProcFalseId, p_to_tax_rule_version_id: toIl.versionId },
  );
  if (rpcActiveErr) throw new Error(`resolve while FROM active failed: ${errText(rpcActiveErr)}`);
  assert.equal(Boolean(resolvedActive), true);

  const { data: rel, error: relErr } = await supabaseAdmin
    .from('tax_rule_relationships')
    .select('to_tax_rule_version_id, activation_critical, relationship_type, origin_unresolved_legal_reference_id')
    .eq('origin_unresolved_legal_reference_id', openProcFalseId)
    .maybeSingle();
  if (relErr) throw new Error(`load resolved relationship failed: ${errText(relErr)}`);
  assert.equal(rel?.relationship_type, 'procedural_requirement');
  assert.equal(rel?.activation_critical, false);
  assert.equal(rel?.to_tax_rule_version_id, toIl.versionId);

  const { error: resolvedTerminalErr } = await supabaseAdmin.rpc(
    'tax_knowledge_resolve_unresolved_legal_reference',
    { p_unresolved_id: openProcFalseId, p_to_tax_rule_version_id: toIl.versionId },
  );
  assert.ok(resolvedTerminalErr, 'resolved unresolved legal references are terminal');

  const resolveDraft = await newRule('resolve_draft');
  const { id: resolveDraftId, error: resolveInsertErr } = await insertUnresolved(resolveDraft.versionId, {
    relationship_intent: 'elaborates',
    locator_text: 'resolve while draft',
    status: 'open',
  });
  if (resolveInsertErr || !resolveDraftId) throw new Error(`resolve draft insert failed: ${errText(resolveInsertErr)}`);
  const { data: resolvedDraft, error: rpcDraftErr } = await supabaseAdmin.rpc(
    'tax_knowledge_resolve_unresolved_legal_reference',
    { p_unresolved_id: resolveDraftId, p_to_tax_rule_version_id: toIl.versionId },
  );
  if (rpcDraftErr) throw new Error(`resolve while draft failed: ${errText(rpcDraftErr)}`);
  assert.equal(Boolean(resolvedDraft), true);
  const { data: draftRel, error: draftRelErr } = await supabaseAdmin
    .from('tax_rule_relationships')
    .select('to_tax_rule_version_id')
    .eq('origin_unresolved_legal_reference_id', resolveDraftId)
    .maybeSingle();
  if (draftRelErr) throw new Error(`load draft-resolved relationship failed: ${errText(draftRelErr)}`);
  assert.equal(draftRel?.to_tax_rule_version_id, toIl.versionId);

  const discardRule = await newRule('discard');
  const { id: discardId, error: discardInsertErr } = await insertUnresolved(discardRule.versionId, {
    relationship_intent: 'elaborates',
    locator_text: 'discard this citation',
    status: 'open',
  });
  if (discardInsertErr || !discardId) throw new Error(`discard insert failed: ${errText(discardInsertErr)}`);
  const { error: discardErr } = await supabaseAdmin
    .from('tax_rule_unresolved_legal_references')
    .update({ status: 'discarded', discarded_at: new Date().toISOString(), discarded_reason: 'not needed' })
    .eq('id', discardId);
  if (discardErr) throw new Error(`discard failed: ${errText(discardErr)}`);
  const { error: discardedTerminalErr } = await supabaseAdmin
    .from('tax_rule_unresolved_legal_references')
    .update({ status: 'open' })
    .eq('id', discardId);
  assert.ok(discardedTerminalErr, 'discarded unresolved legal references are terminal');
  const { error: discardActivateErr } = await tryActivate(discardRule.versionId);
  assert.equal(
    discardActivateErr,
    null,
    `discarded unresolved must not block activation: ${errText(discardActivateErr)}`,
  );
});
