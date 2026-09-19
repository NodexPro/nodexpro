import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppError } from '../../src/shared/errors.js';
import type { RequestContext } from '../../src/shared/context.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';
import { evaluateOwnerLegalCommandAccess } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { ownerLegalValueRulesetAmbiguousMessage } from '../../src/domains/country-pack/owner-legal-value-ruleset.pure.js';

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

  const ilDocs = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, country_code, original_filename, created_at, tax_source_id')
    .eq('country_code', 'IL')
    .order('created_at', { ascending: false })
    .limit(40);
  if (ilDocs.error) throw new Error(`IL documents failed: ${errText(ilDocs.error)}`);
  const inventory = ilDocs.data ?? [];
  if (inventory.length < 2) throw new Error('TAX-649A live needs at least two existing IL documents');

  const newest = inventory[0]!;
  const keep = inventory.find((row) => row.id !== newest.id)!;

  const usDocs = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, country_code, original_filename')
    .eq('country_code', 'US')
    .order('created_at', { ascending: false })
    .limit(1);
  if (usDocs.error) throw new Error(`US documents failed: ${errText(usDocs.error)}`);

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
  let fixtureSourceId: string | null = null;
  let createdUsDocId: string | null = null;
  let createdUsJobId: string | null = null;
  let createdUsSourceId: string | null = null;

  t.after(async () => {
    if (originalPin) {
      await persistOwnerWorkspaceSelectedDocument({
        countryCode: 'IL',
        documentId: originalPin,
        actorUserId,
      });
    } else {
      await supabaseAdmin.from('legal_ingestion_owner_workspace_selection').delete().eq('country_code', 'IL');
    }
    if (fixtureJobId) await supabaseAdmin.from('legal_ingestion_jobs').delete().eq('id', fixtureJobId);
    if (fixtureDocId) await supabaseAdmin.from('legal_ingestion_documents').delete().eq('id', fixtureDocId);
    if (createdUsJobId) await supabaseAdmin.from('legal_ingestion_jobs').delete().eq('id', createdUsJobId);
    if (createdUsDocId) await supabaseAdmin.from('legal_ingestion_documents').delete().eq('id', createdUsDocId);
    if (createdUsSourceId) await supabaseAdmin.from('tax_sources').delete().eq('id', createdUsSourceId);
    if (fixtureSourceId) await supabaseAdmin.from('tax_sources').delete().eq('id', fixtureSourceId);
  });

  const ctx = ownerCtx(actorUserId, email);

  const selected = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: keep.id });
  assert.equal(selected.ok, true);
  assert.equal(selected.command, COMMAND);
  assert.equal(selected.refreshed?.aggregate_key, 'owner_legal_control_panel_aggregate');
  assert.equal(trainerSelectedId(selected.refreshed?.aggregate), keep.id);

  const pinAfterSelect = await supabaseAdmin
    .from('legal_ingestion_owner_workspace_selection')
    .select('selected_document_id, country_code')
    .eq('country_code', 'IL')
    .maybeSingle();
  if (pinAfterSelect.error) throw new Error(`pin after select failed: ${errText(pinAfterSelect.error)}`);
  assert.equal(pinAfterSelect.data?.selected_document_id, keep.id);

  const refresh = await buildKnowledgeTrainerSlice('IL');
  assert.equal(refresh.selected_document?.id ?? null, keep.id);
  assert.notEqual(refresh.selected_document?.id ?? null, newest.id);
  assert.ok(refresh.documents.some((row) => row.id === newest.id));

  const switched = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: newest.id });
  assert.equal(trainerSelectedId(switched.refreshed?.aggregate), newest.id);
  const back = await executeKnowledgeTrainerCommand(ctx, COMMAND, { legal_ingestion_document_id: keep.id });
  assert.equal(trainerSelectedId(back.refreshed?.aggregate), keep.id);

  const sourceInsert = await supabaseAdmin
    .from('tax_sources')
    .insert({
      country_code: 'IL',
      source_code: `${marker}_il_src`,
      title: 'TAX-649A verify source',
      provenance_type: 'official_guidance',
      status: 'draft',
    })
    .select('id')
    .single();
  if (sourceInsert.error) throw new Error(`fixture source insert failed: ${errText(sourceInsert.error)}`);
  fixtureSourceId = String(sourceInsert.data.id);

  const fixtureInsert = await supabaseAdmin
    .from('legal_ingestion_documents')
    .insert({
      country_code: 'IL',
      tax_source_id: fixtureSourceId,
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
      tax_source_id: fixtureSourceId,
      status: 'uploaded',
    })
    .select('id')
    .single();
  if (fixtureJob.error) throw new Error(`fixture job insert failed: ${errText(fixtureJob.error)}`);
  fixtureJobId = String(fixtureJob.data.id);

  const afterHijack = await buildKnowledgeTrainerSlice('IL');
  assert.equal(afterHijack.selected_document?.id ?? null, keep.id);
  assert.notEqual(afterHijack.selected_document?.id ?? null, fixtureDocId);
  assert.ok(afterHijack.documents.some((row) => row.id === fixtureDocId));
  assert.equal(afterHijack.documents[0]?.id, fixtureDocId);

  let usDocId = usDocs.data?.[0]?.id ? String(usDocs.data[0].id) : '';
  if (!usDocId) {
    const usSource = await supabaseAdmin
      .from('tax_sources')
      .insert({
        country_code: 'US',
        source_code: `${marker}_us_src`,
        title: 'TAX-649A verify US source',
        provenance_type: 'official_guidance',
        status: 'draft',
      })
      .select('id')
      .single();
    if (usSource.error) throw new Error(`US source insert failed: ${errText(usSource.error)}`);
    createdUsSourceId = String(usSource.data.id);
    const usDoc = await supabaseAdmin
      .from('legal_ingestion_documents')
      .insert({
        country_code: 'US',
        tax_source_id: createdUsSourceId,
        input_type: 'text',
        provenance_type: 'official_guidance',
        original_filename: `${marker}-us.txt`,
        mime_type: 'text/plain',
        byte_size: 16,
        content_sha256: sha256Hex(`${marker}-us`),
        uploaded_by: actorUserId,
      })
      .select('id')
      .single();
    if (usDoc.error) throw new Error(`US document insert failed: ${errText(usDoc.error)}`);
    createdUsDocId = String(usDoc.data.id);
    usDocId = createdUsDocId;
    const usJob = await supabaseAdmin
      .from('legal_ingestion_jobs')
      .insert({
        document_id: createdUsDocId,
        country_code: 'US',
        tax_source_id: createdUsSourceId,
        status: 'uploaded',
      })
      .select('id')
      .single();
    if (usJob.error) throw new Error(`US job insert failed: ${errText(usJob.error)}`);
    createdUsJobId = String(usJob.data.id);
  }

  await assert.rejects(
    () =>
      executeKnowledgeTrainerCommand(ctx, COMMAND, {
        legal_ingestion_document_id: usDocId,
        country_code: 'IL',
      }),
    (error: unknown) => error instanceof AppError && error.code === 'OWNER_LEGAL_COUNTRY_MISMATCH',
  );
  assert.equal(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view'] } },
      COMMAND,
      'US',
    ).ok,
    false,
  );

  const leftover648c = await supabaseAdmin
    .from('country_packs')
    .select('id, pack_code, name, status')
    .eq('country_code', 'IL')
    .eq('status', 'enabled');
  if (leftover648c.error) throw new Error(`pack inventory failed: ${errText(leftover648c.error)}`);
  const enabledIlPacks = leftover648c.data ?? [];
  assert.ok(
    enabledIlPacks.some((row) => /tk648c/i.test(`${row.pack_code ?? ''} ${row.name ?? ''}`)),
    'expected leftover 648C enabled IL packs to still be present',
  );

  await assert.rejects(
    () => resolveOwnerLegalValueRulesetContextForCountry({ countryCode: 'IL', effectiveDate: '2026-07-01' }),
    (error: unknown) =>
      error instanceof AppError && error.message === ownerLegalValueRulesetAmbiguousMessage('IL'),
  );
});
