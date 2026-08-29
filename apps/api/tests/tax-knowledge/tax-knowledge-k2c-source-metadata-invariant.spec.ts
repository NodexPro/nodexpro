import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

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

function actionEnabled(
  actions: Array<{ action_key?: unknown; enabled?: unknown }> | undefined,
  actionKey: string,
): boolean {
  const found = (actions ?? []).find((row) => row.action_key === actionKey);
  return found?.enabled === true;
}

test('TAX-K2C invariant: update_tax_source_metadata command matches sourceAllowedActions', () => {
  const commandsSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  const readSrc = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');

  assert.match(
    readSrc,
    /action\('update_tax_source_metadata',\s*status === 'draft' \|\| status === 'active'/,
  );
  const metaStart = commandsSrc.indexOf('async function handleUpdateTaxSourceMetadata');
  const metaEnd = commandsSrc.indexOf('async function handleUpdateTaxRuleMetadata');
  const metaHandler = commandsSrc.slice(metaStart, metaEnd);
  assert.ok(metaHandler.length > 100);
  assert.match(metaHandler, /source\.status !== 'draft' && source\.status !== 'active'/);
  assert.match(metaHandler, /update_tax_source_metadata is only valid from draft or active/);
  assert.match(metaHandler, /\.in\('status', \['draft', 'active'\]\)/);

  assert.match(readSrc, /action\('activate_tax_source',\s*status === 'draft'/);
  assert.match(commandsSrc, /activate_tax_source is only valid from draft to active/);

  assert.match(
    readSrc,
    /action\('retire_tax_source',\s*status === 'draft' \|\| status === 'active'/,
  );
  assert.match(commandsSrc, /retire_tax_source is only valid from draft or active/);

  assert.match(readSrc, /action\('update_tax_rule_metadata',\s*true,/);
  const ruleStart = commandsSrc.indexOf('async function handleUpdateTaxRuleMetadata');
  const ruleEnd = commandsSrc.indexOf('async function handlePinTaxRuleVersionSource');
  const ruleHandler = commandsSrc.slice(ruleStart, ruleEnd);
  assert.ok(ruleHandler.length > 100);
  assert.doesNotMatch(ruleHandler, /rule\.status/);
  assert.match(ruleHandler, /from\('tax_rules'\)\.update\(patch\)\.eq\('id', ruleId\)/);
});

test('TAX-K2C invariant: live draft/active metadata accepted, retired rejected', async (t) => {
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

  const marker = `tk2c-inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    [{ code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' }],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const created = await executeTaxKnowledgeCommand(ownerCtx, 'create_tax_source', {
    country_code: 'IL',
    source_code: `${marker}_src`,
    title: 'K2C invariant draft',
    provenance_type: 'official_guidance',
  });
  const createdSource = (
    created.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
  ).sources.find((row) => row.source_code === `${marker}_src`);
  assert.ok(createdSource);
  const sourceId = String(createdSource.id);
  assert.equal(createdSource.status, 'draft');
  assert.equal(
    actionEnabled(createdSource.allowed_actions as Array<{ action_key?: unknown; enabled?: unknown }>, 'update_tax_source_metadata'),
    true,
  );

  const draftMeta = await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_source_metadata', {
    tax_source_id: sourceId,
    title: 'K2C invariant draft updated',
  });
  const afterDraft = (
    draftMeta.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
  ).sources.find((row) => row.id === sourceId);
  assert.equal(afterDraft?.title, 'K2C invariant draft updated');
  assert.equal(afterDraft?.status, 'draft');
  assert.equal(
    actionEnabled(afterDraft?.allowed_actions as Array<{ action_key?: unknown; enabled?: unknown }>, 'update_tax_source_metadata'),
    true,
  );

  const activated = await executeTaxKnowledgeCommand(ownerCtx, 'activate_tax_source', {
    tax_source_id: sourceId,
  });
  const afterActivate = (
    activated.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
  ).sources.find((row) => row.id === sourceId);
  assert.equal(afterActivate?.status, 'active');
  assert.equal(
    actionEnabled(afterActivate?.allowed_actions as Array<{ action_key?: unknown; enabled?: unknown }>, 'update_tax_source_metadata'),
    true,
  );

  const activeMeta = await executeTaxKnowledgeCommand(ownerCtx, 'update_tax_source_metadata', {
    tax_source_id: sourceId,
    title: 'K2C invariant active updated',
  });
  const afterActive = (
    activeMeta.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
  ).sources.find((row) => row.id === sourceId);
  assert.equal(afterActive?.title, 'K2C invariant active updated');
  assert.equal(afterActive?.status, 'active');

  const retired = await executeTaxKnowledgeCommand(ownerCtx, 'retire_tax_source', {
    tax_source_id: sourceId,
    reason: 'k2c invariant',
  });
  const afterRetire = (
    retired.refreshed.aggregate.tax_knowledge as { sources: Array<Record<string, unknown>> }
  ).sources.find((row) => row.id === sourceId);
  assert.equal(afterRetire?.status, 'retired');
  assert.equal(
    actionEnabled(afterRetire?.allowed_actions as Array<{ action_key?: unknown; enabled?: unknown }>, 'update_tax_source_metadata'),
    false,
  );

  await assert.rejects(
    () =>
      executeTaxKnowledgeCommand(ownerCtx, 'update_tax_source_metadata', {
        tax_source_id: sourceId,
        title: 'K2C invariant should not land',
      }),
    (err: unknown) =>
      err instanceof AppError &&
      err.statusCode === 409 &&
      /update_tax_source_metadata is only valid from draft or active/.test(err.message),
  );

  const { data: frozen, error: frozenErr } = await supabaseAdmin
    .from('tax_sources')
    .select('title, status')
    .eq('id', sourceId)
    .maybeSingle();
  if (frozenErr) throw new Error(errText(frozenErr));
  assert.equal(frozen?.status, 'retired');
  assert.equal(frozen?.title, 'K2C invariant active updated');
});
