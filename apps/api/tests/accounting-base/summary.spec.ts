import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeAccountingBaseCommand } from '../../src/domains/accounting-base/accounting-base-commands.service.js';
import { forSystemRecomputeDerivedSummaries } from '../../src/domains/accounting-base/summary.service.js';
import { supabaseAdmin } from '../../src/db/client.js';
import { FULL_PERMS, buildCtx, cleanupTestEnv, createCategory, createPeriod, createTestEnv } from './test-helpers.js';

test('summary recompute: only active+finalized entries, no negative values, grouped by period/type/category', async () => {
  const env = await createTestEnv('ab-summary');
  try {
    const ctx = buildCtx(env.orgA, env.userId, FULL_PERMS);
    const periodId = await createPeriod({ orgId: env.orgA, label: `${env.marker}-period`, status: 'open' });
    const categoryId = await createCategory({ orgId: env.orgA, code: `${env.marker}-cat` });

    const common = {
      organization_id: env.orgA,
      period_id: periodId,
      category_id: categoryId,
      entry_date: '2026-03-01',
      currency: 'ILS',
      created_by: env.userId,
      is_archived: false,
    };

    const { error } = await supabaseAdmin.from('accounting_entries').insert([
      {
        id: randomUUID(),
        ...common,
        entry_type: 'income',
        direction: 'credit',
        amount: 1000,
        status: 'active',
        posting_state: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: env.userId,
      },
      {
        id: randomUUID(),
        ...common,
        entry_type: 'expense',
        direction: 'debit',
        amount: 500,
        status: 'active',
        posting_state: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: env.userId,
      },
      {
        id: randomUUID(),
        ...common,
        entry_type: 'refund',
        direction: 'debit',
        amount: 300,
        status: 'active',
        posting_state: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: env.userId,
      },
      {
        id: randomUUID(),
        ...common,
        entry_type: 'income',
        direction: 'credit',
        amount: 999,
        status: 'archived',
        posting_state: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: env.userId,
        is_archived: true,
      },
      {
        id: randomUUID(),
        ...common,
        entry_type: 'income',
        direction: 'credit',
        amount: 888,
        status: 'active',
        posting_state: 'draft',
      },
    ]);
    if (error) throw error;

    const rec = await forSystemRecomputeDerivedSummaries(ctx, env.orgA, { period_id: periodId });
    assert.ok(rec.rows_written > 0);

    const { data: rows } = await supabaseAdmin
      .from('accounting_summaries')
      .select('summary_scope, summary_key, amount_total')
      .eq('organization_id', env.orgA)
      .eq('period_id', periodId);

    const list = rows ?? [];
    assert.ok(list.every((r) => Number(r.amount_total) >= 0), 'all summaries must be non-negative');

    const key = (scope: string, summaryKey: string) => list.find((r) => r.summary_scope === scope && r.summary_key === summaryKey);
    assert.equal(Number(key('global', 'entry_type:income:income_total')?.amount_total ?? 0), 1000);
    assert.equal(Number(key('global', 'entry_type:expense:expense_total')?.amount_total ?? 0), 500);
    assert.equal(Number(key('global', 'entry_type:refund:expense_total')?.amount_total ?? 0), 300);

    const cmdRes = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'recompute_summary',
      payload: { period_id: periodId },
    });
    assert.equal(cmdRes.ok, true);
    assert.equal(cmdRes.refreshed.aggregate_key, 'accounting_summary_workspace_aggregate');
  } finally {
    await cleanupTestEnv(env);
  }
});
