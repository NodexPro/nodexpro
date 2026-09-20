import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppError } from '../../src/shared/errors.js';
import type { RequestContext } from '../../src/shared/context.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';
import { evaluateOwnerLegalCommandAccess } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { ownerLegalValueRulesetAmbiguousMessage } from '../../src/domains/country-pack/owner-legal-value-ruleset.pure.js';
import { ORDINANCE_DOCUMENT_ID, ORDINANCE_SOURCE_ID } from '../_helpers/dev-live-fixture.ts';

process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL?.trim() || 'marinator.321@gmail.com';

const DEV_REF = 'jgxezhjctrgfbmmkqqhn';
const COMMAND = 'select_legal_training_document';

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ownerCtx(userId: string, email: string): RequestContext {
  return {
    user: {
      id: userId,
      authUserId: '649a-live',
      email,
      fullName: 'Owner',
      status: 'active',
      uiLanguage: 'he',
    },
    membership: null,
    organizationId: null,
  };
}

function trainerSelectedId(aggregate: unknown): string | null {
  const rec = aggregate && typeof aggregate === 'object' ? (aggregate as Record<string, unknown>) : null;
  const tax = rec?.tax_knowledge && typeof rec.tax_knowledge === 'object' ? (rec.tax_knowledge as Record<string, unknown>) : null;
  const library =
    tax?.legal_library && typeof tax.legal_library === 'object' ? (tax.legal_library as Record<string, unknown>) : null;
  const trainer =
    library?.trainer_upload && typeof library.trainer_upload === 'object'
      ? (library.trainer_upload as Record<string, unknown>)
      : null;
  const selected =
    trainer?.selected_document && typeof trainer.selected_document === 'object'
      ? (trainer.selected_document as Record<string, unknown>)
      : null;
  return typeof selected?.id === 'string' && selected.id ? selected.id : null;
}

test('TAX-649A live DEV: persist selection, no newest fallback, fixture cannot hijack, cross-country + pack fail-closed', async (t) => {
  const url = process.env.SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url.includes(DEV_REF) || !key) {
    throw new Error('TAX-649A live verification refuses to run: not DEV Supabase jgxezhjctrgfbmmkqqhn');
  }

  const email = process.env.PLATFORM_OWNER_EMAIL!.trim().toLowerCase();
  const { supabaseAdmin } = await import('../../src/db/client.js');

  const tableProbe = await supabaseAdmin.from('legal_ingestion_owner_workspace_selection').select('country_code').limit(1);
  if (tableProbe.error && isSupabaseMissingTableError(tableProbe.error)) {
    throw new Error('migration 645 is not applied');
  }
  if (tableProbe.error) throw new Error(`selection table probe failed: ${errText(tableProbe.error)}`);

  const { data: ownerRow, error: ownerErr } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
  if (ownerErr) throw new Error(`owner lookup failed: ${errText(ownerErr)}`);
  const actorUserId = ownerRow?.id ? String(ownerRow.id) : '';
  if (!actorUserId) throw new Error(`owner user ${email} not found`);

  const { executeKnowledgeTrainerCommand } = await import(
    '../../src/domains/knowledge-trainer/knowledge-trainer-commands.service.js'
  );
  const { buildKnowledgeTrainerSlice } = await import('../../src/domains/knowledge-trainer/knowledge-trainer-read.service.js');
  const { resolveOwnerLegalValueRulesetContextForCountry } = await import(
    '../../src/domains/country-pack/legal-value.service.js'
  );
  const { persistOwnerWorkspaceSelectedDocument } = await import(
    '../../src/domains/knowledge-trainer/knowledge-trainer-workspace-selection.service.js'
  );

  const keepId = ORDINANCE_DOCUMENT_ID;
  const ordinance = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, country_code, tax_source_id')
    .eq('id', keepId)
    .maybeSingle();
  if (ordinance.error) throw new Error(`ordinance lookup failed: ${errText(ordinance.error)}`);
  if (!ordinance.data || ordinance.data.tax_source_id !== ORDINANCE_SOURCE_ID) {
    throw new Error('TAX-649A live refuses to run: real ordinance PDF/source missing');
  }

  const existingPin = await supabaseAdmin
    .from('legal_ingestion_owner_workspace_selection')
    .select('selected_document_id')
    .eq('country_code', 'IL')
    .maybeSingle();
  if (existingPin.error) throw new Error(`pin snapshot failed: ${errText(existingPin.error)}`);
  const originalPin = existingPin.data?.selected_document_id ? String(existingPin.data.selected_document_id) : null;

  const marker = `tk649a-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let fixtureDocId: string | null = null;
  let fixtureJobId: string | null = null;
  let packAId: string | null = null;
  let packBId: string | null = null;
  let rulesetAId: string | null = null;
  let rulesetBId: string | null = null;

  t.after(async () => {
    const cleanupErrors: string[] = [];
    try {
      if (originalPin) {
        await persistOwnerWorkspaceSelectedDocument({
          countryCode: 'IL',
          documentId: originalPin,
          actorUserId,
        });
      } else {
        const pinDel = await supabaseAdmin
          .from('legal_ingestion_owner_workspace_selection')
          .delete()
          .eq('country_code', 'IL');
        if (pinDel.error) cleanupErrors.push(`pin restore: ${errText(pinDel.error)}`);
      }
    } catch (error) {
      cleanupErrors.push(`pin restore threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (fixtureJobId) {
      const jobDel = await supabaseAdmin.from('legal_ingestion_jobs').delete().eq('id', fixtureJobId);
      if (jobDel.error) cleanupErrors.push(`fixture job: ${errText(jobDel.error)}`);
    }
    if (fixtureDocId) {
      const docDel = await supabaseAdmin.from('legal_ingestion_documents').delete().eq('id', fixtureDocId);
      if (docDel.error) cleanupErrors.push(`fixture doc: ${errText(docDel.error)}`);
    }
    if (rulesetAId) {
      const rsDel = await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetAId);
      if (rsDel.error) cleanupErrors.push(`ruleset A: ${errText(rsDel.error)}`);
    }
    if (rulesetBId) {
      const rsDel = await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetBId);
      if (rsDel.error) cleanupErrors.push(`ruleset B: ${errText(rsDel.error)}`);
    }
    if (packAId) {
      const packDel = await supabaseAdmin.from('country_packs').delete().eq('id', packAId);
      if (packDel.error) cleanupErrors.push(`pack A: ${errText(packDel.error)}`);
    }
    if (packBId) {
      const packDel = await supabaseAdmin.from('country_packs').delete().eq('id', packBId);
      if (packDel.error) cleanupErrors.push(`pack B: ${errText(packDel.error)}`);
    }
    const leftover = await supabaseAdmin
      .from('country_packs')
      .select('id, pack_code')
      .like('pack_code', `${marker}%`);
    if (leftover.error) cleanupErrors.push(`leftover pack probe: ${errText(leftover.error)}`);
    if ((leftover.data ?? []).length > 0) {
      cleanupErrors.push(`leftover owned packs: ${(leftover.data ?? []).map((row) => row.pack_code).join(',')}`);
    }
    const leftoverDoc = fixtureDocId
      ? await supabaseAdmin.from('legal_ingestion_documents').select('id').eq('id', fixtureDocId).maybeSingle()
      : { data: null, error: null };
    if (leftoverDoc.error) cleanupErrors.push(`leftover doc probe: ${errText(leftoverDoc.error)}`);
    if (leftoverDoc.data) cleanupErrors.push(`leftover fixture document ${fixtureDocId}`);
    if (cleanupErrors.length > 0) {
      throw new Error(`TAX-649A cleanup failed: ${cleanupErrors.join(' | ')}`);
    }
  });

  const ctx = ownerCtx(actorUserId, email);

  const selected = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: keepId });
  assert.equal(selected.ok, true);
  assert.equal(selected.command, COMMAND);
  assert.equal(selected.refreshed?.aggregate_key, 'owner_legal_control_panel_aggregate');
  assert.equal(trainerSelectedId(selected.refreshed?.aggregate), keepId);

  const pinAfterSelect = await supabaseAdmin
    .from('legal_ingestion_owner_workspace_selection')
    .select('selected_document_id, country_code')
    .eq('country_code', 'IL')
    .maybeSingle();
  if (pinAfterSelect.error) throw new Error(`pin after select failed: ${errText(pinAfterSelect.error)}`);
  assert.equal(pinAfterSelect.data?.selected_document_id, keepId);

  const refresh = await buildKnowledgeTrainerSlice('IL');
  assert.equal(refresh.selected_document?.id ?? null, keepId);

  const fixtureInsert = await supabaseAdmin
    .from('legal_ingestion_documents')
    .insert({
      country_code: 'IL',
      tax_source_id: ORDINANCE_SOURCE_ID,
      input_type: 'text',
      provenance_type: 'official_guidance',
      original_filename: `${marker}.txt`,
      mime_type: 'text/plain',
      byte_size: 16,
      content_sha256: sha256Hex(marker),
      uploaded_by: actorUserId,
    })
    .select('id')
    .single();
  if (fixtureInsert.error) throw new Error(`fixture document insert failed: ${errText(fixtureInsert.error)}`);
  fixtureDocId = String(fixtureInsert.data.id);
  const fixtureJob = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .insert({
      document_id: fixtureDocId,
      country_code: 'IL',
      tax_source_id: ORDINANCE_SOURCE_ID,
      status: 'uploaded',
    })
    .select('id')
    .single();
  if (fixtureJob.error) throw new Error(`fixture job insert failed: ${errText(fixtureJob.error)}`);
  fixtureJobId = String(fixtureJob.data.id);

  const afterHijack = await buildKnowledgeTrainerSlice('IL');
  assert.equal(afterHijack.selected_document?.id ?? null, keepId);
  assert.notEqual(afterHijack.selected_document?.id ?? null, fixtureDocId);
  assert.ok(afterHijack.documents.some((row) => row.id === fixtureDocId));
  assert.equal(afterHijack.documents[0]?.id, fixtureDocId);

  const switched = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: fixtureDocId });
  assert.equal(trainerSelectedId(switched.refreshed?.aggregate), fixtureDocId);
  const back = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: keepId });
  assert.equal(trainerSelectedId(back.refreshed?.aggregate), keepId);

  assert.equal(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view'] } },
      COMMAND,
      'US',
    ).ok,
    false,
  );

  const packA = await supabaseAdmin
    .from('country_packs')
    .insert({
      country_code: 'IL',
      pack_code: `${marker}_pack_a`,
      name: `${marker} pack A`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    })
    .select('id')
    .single();
  if (packA.error) throw new Error(`pack A insert failed: ${errText(packA.error)}`);
  packAId = String(packA.data.id);
  const packB = await supabaseAdmin
    .from('country_packs')
    .insert({
      country_code: 'IL',
      pack_code: `${marker}_pack_b`,
      name: `${marker} pack B`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    })
    .select('id')
    .single();
  if (packB.error) throw new Error(`pack B insert failed: ${errText(packB.error)}`);
  packBId = String(packB.data.id);

  const rulesetA = await supabaseAdmin
    .from('country_pack_rulesets')
    .insert({
      country_pack_id: packAId,
      ruleset_code: `${marker}_rs_a`,
      ruleset_version: 'v1',
      effective_from: '2020-01-01',
      effective_to: null,
      status: 'active',
    })
    .select('id')
    .single();
  if (rulesetA.error) throw new Error(`ruleset A insert failed: ${errText(rulesetA.error)}`);
  rulesetAId = String(rulesetA.data.id);
  const rulesetB = await supabaseAdmin
    .from('country_pack_rulesets')
    .insert({
      country_pack_id: packBId,
      ruleset_code: `${marker}_rs_b`,
      ruleset_version: 'v1',
      effective_from: '2020-01-01',
      effective_to: null,
      status: 'active',
    })
    .select('id')
    .single();
  if (rulesetB.error) throw new Error(`ruleset B insert failed: ${errText(rulesetB.error)}`);
  rulesetBId = String(rulesetB.data.id);

  await assert.rejects(
    () => resolveOwnerLegalValueRulesetContextForCountry({ countryCode: 'IL', effectiveDate: '2026-07-01' }),
    (error: unknown) =>
      error instanceof AppError && error.message === ownerLegalValueRulesetAmbiguousMessage('IL'),
  );
});
