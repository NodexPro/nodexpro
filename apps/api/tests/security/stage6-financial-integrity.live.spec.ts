/**
 * Live financial integrity against confirmed staging only.
 * Skips unless SUPABASE_URL is nodexpro-security-staging.
 */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';

const STAGING_HOST = 'kabefnmcyhughnyvoxiw.supabase.co';
const PRODUCTION_HOST = 'ttysmceteiknzputejvc.supabase.co';

function stagingConfigured(): boolean {
  const url = process.env.SUPABASE_URL ?? '';
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const host = new URL(url).host;
    if (host === PRODUCTION_HOST) return false;
    return host === STAGING_HOST;
  } catch {
    return false;
  }
}

test('Stage 6 financial integrity on staging (draft immutability, concurrency, cross-tenant)', async (t) => {
  if (!stagingConfigured()) {
    t.skip('NOT EXECUTED: staging SUPABASE_URL is not configured');
    return;
  }

  const { executeAccountingBaseCommand } = await import(
    '../../src/domains/accounting-base/accounting-base-commands.service.js'
  );
  const { supabaseAdmin } = await import('../../src/db/client.js');
  const {
    FULL_PERMS,
    buildCtx,
    cleanupTestEnv,
    createCategory,
    createPeriod,
    createTestEnv,
  } = await import('../accounting-base/test-helpers.js');

  const env = await createTestEnv('s6-fin');
  try {
    const ctxA = buildCtx(env.orgA, env.userId, FULL_PERMS);
    const ctxB = buildCtx(env.orgB, env.userId, FULL_PERMS);
    const ctxNoPay = buildCtx(
      env.orgA,
      env.userId,
      FULL_PERMS.filter((p) => p !== 'accounting_base.payment.write' && p !== 'accounting_base.entry.write'),
    );
    const periodA = await createPeriod({ orgId: env.orgA, label: `${env.marker}-p`, status: 'open' });
    const catA = await createCategory({ orgId: env.orgA, code: `${env.marker}-c` });

    const created = await executeAccountingBaseCommand(ctxA, env.orgA, {
      type: 'create_entry',
      payload: {
        period_id: periodA,
        category_id: catA,
        entry_type: 'income',
        entry_date: '2026-04-10',
        amount: 400,
        currency: 'ILS',
        direction: 'credit',
        description: `${env.marker}-entry`,
      },
    });
    const entryId = created.additional_refreshed?.find((x) => x.aggregate_key === 'accounting_entry_details_aggregate')
      ?.aggregate?.entry?.id;
    assert.ok(entryId);

    await executeAccountingBaseCommand(ctxA, env.orgA, {
      type: 'finalize_entry',
      payload: { entry_id: entryId },
    });

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxA, env.orgA, {
          type: 'update_draft_entry',
          payload: { entry_id: entryId, description: 'mutate-after-finalize' },
        }),
      /draft|immutable|finaliz|posted|cannot/i,
    );

    const { data: posted } = await supabaseAdmin
      .from('accounting_entries')
      .select('id, posting_state, amount, description')
      .eq('id', entryId)
      .single();
    assert.ok(posted);
    assert.notEqual(String(posted.description ?? ''), 'mutate-after-finalize');

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxB, env.orgB, {
          type: 'finalize_entry',
          payload: { entry_id: entryId },
        }),
      /not found|Organization|forbidden|draft|PGRST116/i,
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxNoPay, env.orgA, {
          type: 'create_entry',
          payload: {
            period_id: periodA,
            category_id: catA,
            entry_type: 'income',
            entry_date: '2026-04-11',
            amount: 50,
            currency: 'ILS',
            direction: 'credit',
          },
        }),
      /Insufficient permission/i,
    );

    const draftB = await executeAccountingBaseCommand(ctxA, env.orgA, {
      type: 'create_entry',
      payload: {
        period_id: periodA,
        category_id: catA,
        entry_type: 'income',
        entry_date: '2026-04-12',
        amount: 80,
        currency: 'ILS',
        direction: 'credit',
        description: `${env.marker}-concurrent`,
      },
    });
    const concurrentId = draftB.additional_refreshed?.find((x) => x.aggregate_key === 'accounting_entry_details_aggregate')
      ?.aggregate?.entry?.id;
    assert.ok(concurrentId);

    const [first, second] = await Promise.allSettled([
      executeAccountingBaseCommand(ctxA, env.orgA, { type: 'finalize_entry', payload: { entry_id: concurrentId } }),
      executeAccountingBaseCommand(ctxA, env.orgA, { type: 'finalize_entry', payload: { entry_id: concurrentId } }),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1, 'at least one concurrent finalize must succeed');
    const { data: concurrentRow } = await supabaseAdmin
      .from('accounting_entries')
      .select('id, posting_state')
      .eq('id', concurrentId)
      .single();
    assert.ok(concurrentRow);
    assert.notEqual(String(concurrentRow.posting_state ?? ''), 'draft');

    const refund = await supabaseAdmin
      .from('accounting_payments')
      .insert({
        organization_id: env.orgB,
        amount: 10,
        currency: 'ILS',
        direction: 'debit',
      })
      .select('id')
      .maybeSingle();
    if (!refund.error && refund.data?.id) {
      await supabaseAdmin.from('accounting_payments').delete().eq('id', refund.data.id);
    }

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxB, env.orgB, {
          type: 'reverse_income_payment_allocation',
          payload: { income_document_id: entryId, organization_id: env.orgA },
        }),
      /not found|unsupported|permission|Organization|invoice|allocation_id required/i,
    );
  } finally {
    await cleanupTestEnv(env);
  }
});
