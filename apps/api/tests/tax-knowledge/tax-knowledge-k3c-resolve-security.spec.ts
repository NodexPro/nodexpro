import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sql607 = readFileSync(
  join(repoRoot, 'supabase/migrations/607_tax_knowledge_legal_links_unresolved.sql'),
  'utf8',
);

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

test('TAX-K3C security contract: GUC bypass removed; resolve uses function-owner identity', () => {
  assert.doesNotMatch(sql607, /tax_knowledge\.allow_resolve/);
  assert.doesNotMatch(sql607, /set_config\s*\(/);
  assert.doesNotMatch(sql607, /current_setting\s*\(/);
  assert.doesNotMatch(sql607, /\bexecute\s+'/i);
  assert.doesNotMatch(sql607, /\bexecute\s+format\s*\(/i);
  assert.doesNotMatch(sql607, /pg_temp|temporary table|create temp/i);

  assert.match(sql607, /security definer/i);
  assert.match(sql607, /set search_path = pg_catalog, public/);
  assert.match(sql607, /current_user is distinct from session_user/);
  assert.match(sql607, /pg_catalog\.pg_get_userbyid\(p\.proowner\)/);
  assert.match(sql607, /p\.prosecdef/);
  assert.match(sql607, /p\.proname = 'tax_knowledge_resolve_unresolved_legal_reference'/);
  assert.match(sql607, /u\.activation_critical is not distinct from new\.activation_critical/);
  assert.match(sql607, /unique \(origin_unresolved_legal_reference_id\)/);
  assert.match(sql607, /tax_rule_unresolved_open_procedural_activation_critical_chk/);

  assert.match(
    sql607,
    /revoke all on function public\.tax_knowledge_resolve_unresolved_legal_reference\(uuid, uuid\) from public/,
  );
  assert.match(
    sql607,
    /revoke all on function public\.tax_knowledge_resolve_unresolved_legal_reference\(uuid, uuid\) from anon, authenticated/,
  );
  assert.match(
    sql607,
    /grant execute on function public\.tax_knowledge_resolve_unresolved_legal_reference\(uuid, uuid\) to service_role/,
  );
  assert.doesNotMatch(sql607, /grant execute[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql607, /grant execute[^;]*\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql607, /grant execute[^;]*\bto\s+public\b/i);
});

test('TAX-K3C DB security: resolve exception cannot be spoofed by service_role INSERT', async (t) => {
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

  const marker = `tk3c-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packId = randomUUID();
  const rulesetId = randomUUID();
  const sourceId = randomUUID();
  const ruleA = randomUUID();
  const ruleB = randomUUID();
  const ruleC = randomUUID();
  const versionNoByRule = new Map<string, number>();

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [{ code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' }],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const { error: packErr } = await supabaseAdmin.from('country_packs').insert({
    id: packId,
    country_code: 'IL',
    pack_code: `${marker}_pack`,
    name: `${marker} pack`,
    status: 'enabled',
    framework_version: '1.0.0',
    code_version: '1.0.0',
  });
  if (packErr) throw new Error(`country_packs insert failed: ${errText(packErr)}`);

  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert({
    id: rulesetId,
    country_pack_id: packId,
    ruleset_code: `${marker}_rs`,
    ruleset_version: '1.0.0',
    effective_from: '2020-01-01',
    status: 'active',
  });
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const { error: srcErr } = await supabaseAdmin.from('tax_sources').insert({
    id: sourceId,
    country_code: 'IL',
    source_code: `${marker}_src`,
    title: 'K3C security source',
    provenance_type: 'official_guidance',
    status: 'draft',
  });
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);
  const { error: srcActErr } = await supabaseAdmin.from('tax_sources').update({ status: 'active' }).eq('id', sourceId);
  if (srcActErr) throw new Error(`tax_sources activate failed: ${errText(srcActErr)}`);

  const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert([
    { id: ruleA, country_code: 'IL', rule_code: `${marker}_a`, title: 'Rule A', rule_kind: 'legal_rule', status: 'draft' },
    { id: ruleB, country_code: 'IL', rule_code: `${marker}_b`, title: 'Rule B', rule_kind: 'legal_rule', status: 'draft' },
    { id: ruleC, country_code: 'IL', rule_code: `${marker}_c`, title: 'Rule C', rule_kind: 'legal_rule', status: 'draft' },
  ]);
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  async function insertDraft(ruleId: string): Promise<string> {
    const id = randomUUID();
    const versionNo = versionNoByRule.get(ruleId) ?? 1;
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packId,
      country_pack_ruleset_id: rulesetId,
      version_no: versionNo,
      status: 'draft',
      effective_from: '2026-01-01',
      payload_json: { statement: 'k3c-sec', applies_if: null, does_not_apply_if: null },
      payload_checksum: `k3c-sec-${id}`,
    });
    versionNoByRule.set(ruleId, versionNo + 1);
    if (error) throw new Error(`version insert failed: ${errText(error)}`);
    return id;
  }

  async function pin(versionId: string): Promise<void> {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      country_code: 'IL',
      locator: 'art.1',
    });
    if (error) throw new Error(`pin failed: ${errText(error)}`);
  }

  const toId = await insertDraft(ruleB);
  await pin(toId);
  const { error: toActErr } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', toId);
  if (toActErr) throw new Error(`activate TO failed: ${errText(toActErr)}`);

  const draftTo = await insertDraft(ruleC);
  await pin(draftTo);

  const fromActive = await insertDraft(ruleA);
  await pin(fromActive);

  // H. procedural open with null activation_critical is rejected at DB (FROM still draft).
  const { error: nullCriticalErr } = await supabaseAdmin.from('tax_rule_unresolved_legal_references').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    relationship_intent: 'procedural_requirement',
    activation_critical: null,
    cited_instrument_kind: 'regulation',
    locator_text: 'procedural open null critical',
    status: 'open',
  });
  assert.ok(nullCriticalErr, 'H: procedural open with null activation_critical must be rejected');

  const { data: openOnActive, error: openOnActiveErr } = await supabaseAdmin
    .from('tax_rule_unresolved_legal_references')
    .insert({
      country_code: 'IL',
      from_tax_rule_version_id: fromActive,
      relationship_intent: 'procedural_requirement',
      activation_critical: false,
      cited_instrument_kind: 'regulation',
      locator_text: 'security resolve while active',
      status: 'open',
    })
    .select('id')
    .single();
  if (openOnActiveErr) throw new Error(`open-on-active insert failed: ${errText(openOnActiveErr)}`);

  const { error: activateFromErr } = await supabaseAdmin
    .from('tax_rule_versions')
    .update({ status: 'active' })
    .eq('id', fromActive);
  if (activateFromErr) throw new Error(`activate FROM failed: ${errText(activateFromErr)}`);

  // A. Ordinary direct service_role INSERT on active FROM fails.
  const { error: ordinaryInsertErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    to_tax_rule_version_id: toId,
    relationship_type: 'elaborates',
    status: 'active',
  });
  assert.ok(ordinaryInsertErr, 'A: ordinary service_role INSERT on active FROM must fail');

  // B. Even if the caller attempts set_config, the GUC is gone and INSERT still fails.
  await supabaseAdmin.rpc('set_config', {
    setting_name: 'tax_knowledge.allow_resolve',
    new_value: '1',
    is_local: true,
  });
  const { error: gucInsertErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    to_tax_rule_version_id: toId,
    relationship_type: 'elaborates',
    status: 'active',
  });
  assert.ok(gucInsertErr, 'B: INSERT after attempted GUC still fails');

  // C. Direct INSERT with a real origin id still fails outside resolve RPC.
  const { error: originInsertErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    to_tax_rule_version_id: toId,
    relationship_type: 'procedural_requirement',
    status: 'active',
    activation_critical: false,
    origin_unresolved_legal_reference_id: openOnActive.id,
  });
  assert.ok(originInsertErr, 'C: direct INSERT with real origin id must fail outside resolve RPC');

  // F. activation_critical mismatch cannot pass.
  const { error: mismatchErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    to_tax_rule_version_id: toId,
    relationship_type: 'procedural_requirement',
    status: 'active',
    activation_critical: true,
    origin_unresolved_legal_reference_id: openOnActive.id,
  });
  assert.ok(mismatchErr, 'F: activation_critical mismatch cannot pass');

  // G. resolved TO must be active.
  const { error: draftToErr } = await supabaseAdmin.rpc('tax_knowledge_resolve_unresolved_legal_reference', {
    p_unresolved_id: openOnActive.id,
    p_to_tax_rule_version_id: draftTo,
  });
  assert.ok(draftToErr, 'G: resolve to a non-active TO must fail');

  // D. RPC resolve on active FROM succeeds.
  const { data: resolvedActive, error: rpcActiveErr } = await supabaseAdmin.rpc(
    'tax_knowledge_resolve_unresolved_legal_reference',
    { p_unresolved_id: openOnActive.id, p_to_tax_rule_version_id: toId },
  );
  if (rpcActiveErr) throw new Error(`D: resolve while FROM active failed: ${errText(rpcActiveErr)}`);
  assert.equal(Boolean(resolvedActive), true);

  const { data: rel, error: relErr } = await supabaseAdmin
    .from('tax_rule_relationships')
    .select('id, activation_critical, relationship_type, origin_unresolved_legal_reference_id')
    .eq('origin_unresolved_legal_reference_id', openOnActive.id)
    .maybeSingle();
  if (relErr) throw new Error(`load resolved relationship failed: ${errText(relErr)}`);
  assert.equal(rel?.relationship_type, 'procedural_requirement');
  assert.equal(rel?.activation_critical, false);

  // E. Second use of same origin cannot create another relationship.
  const { error: secondRpcErr } = await supabaseAdmin.rpc('tax_knowledge_resolve_unresolved_legal_reference', {
    p_unresolved_id: openOnActive.id,
    p_to_tax_rule_version_id: toId,
  });
  assert.ok(secondRpcErr, 'E: second RPC resolve of the same origin must fail');

  const { error: secondInsertErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromActive,
    to_tax_rule_version_id: toId,
    relationship_type: 'procedural_requirement',
    status: 'active',
    activation_critical: false,
    origin_unresolved_legal_reference_id: openOnActive.id,
  });
  assert.ok(secondInsertErr, 'E: second relationship with the same origin must fail');

  const fromDraft = await insertDraft(ruleA);
  await pin(fromDraft);
  const { data: draftUnresolved, error: draftUnresolvedErr } = await supabaseAdmin
    .from('tax_rule_unresolved_legal_references')
    .insert({
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      relationship_intent: 'elaborates',
      cited_instrument_kind: 'regulation',
      locator_text: 'unique origin while draft',
      status: 'open',
    })
    .select('id')
    .single();
  if (draftUnresolvedErr) throw new Error(`draft unresolved insert failed: ${errText(draftUnresolvedErr)}`);
  const { error: draftRpcErr } = await supabaseAdmin.rpc('tax_knowledge_resolve_unresolved_legal_reference', {
    p_unresolved_id: draftUnresolved.id,
    p_to_tax_rule_version_id: toId,
  });
  if (draftRpcErr) throw new Error(`resolve while FROM draft failed: ${errText(draftRpcErr)}`);
  const { error: duplicateOriginErr } = await supabaseAdmin.from('tax_rule_relationships').insert({
    country_code: 'IL',
    from_tax_rule_version_id: fromDraft,
    to_tax_rule_version_id: toId,
    relationship_type: 'elaborates',
    status: 'active',
    origin_unresolved_legal_reference_id: draftUnresolved.id,
  });
  assert.ok(duplicateOriginErr, 'E: UNIQUE(origin_unresolved_legal_reference_id) must reject a second row');
});
