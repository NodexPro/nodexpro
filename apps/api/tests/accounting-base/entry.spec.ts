import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAccountingBaseCommand } from '../../src/domains/accounting-base/accounting-base-commands.service.js';
import { supabaseAdmin } from '../../src/db/client.js';
import { FULL_PERMS, buildCtx, cleanupTestEnv, createCategory, createPeriod, createTestEnv } from './test-helpers.js';

test('entry lifecycle: create, update draft, finalize, forbid update after finalize, archive', async () => {
  const env = await createTestEnv('ab-entry');
  try {
    const ctx = buildCtx(env.orgA, env.userId, FULL_PERMS);
    const periodId = await createPeriod({ orgId: env.orgA, label: `${env.marker}-period`, status: 'open' });
    const categoryId = await createCategory({ orgId: env.orgA, code: `${env.marker}-cat` });

    const createRes = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'create_entry',
      payload: {
        period_id: periodId,
        category_id: categoryId,
        entry_type: 'income',
        entry_date: '2026-02-10',
        amount: 1000,
        currency: 'ILS',
        direction: 'credit',
        description: `${env.marker}-entry`,
      },
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.command, 'create_entry');
    assert.equal(createRes.refreshed.aggregate_key, 'accounting_entries_workspace_aggregate');
    assert.ok(createRes.additional_refreshed && createRes.additional_refreshed.length > 0);

    const { data: entryRow } = await supabaseAdmin
      .from('accounting_entries')
      .select('id')
      .eq('organization_id', env.orgA)
      .eq('description', `${env.marker}-entry`)
      .single();
    assert.ok(entryRow?.id);
    const entryId = entryRow.id as string;

    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctx, env.orgA, {
        type: 'update_draft_entry',
        payload: { entry_id: entryId, description: `${env.marker}-updated` },
      })
    );

    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctx, env.orgA, {
        type: 'finalize_entry',
        payload: { entry_id: entryId },
      })
    );

    const { data: finalized } = await supabaseAdmin
      .from('accounting_entries')
      .select('posting_state, finalized_at, finalized_by')
      .eq('id', entryId)
      .single();
    assert.equal(finalized?.posting_state, 'finalized');
    assert.ok(finalized?.finalized_at);
    assert.ok(finalized?.finalized_by);

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctx, env.orgA, {
          type: 'update_draft_entry',
          payload: { entry_id: entryId, description: 'must fail' },
        }),
      /Only draft entry can be updated/
    );

    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctx, env.orgA, {
        type: 'archive_entry',
        payload: { entry_id: entryId },
      })
    );

    const { data: archived } = await supabaseAdmin.from('accounting_entries').select('status').eq('id', entryId).single();
    assert.equal(archived?.status, 'archived');
  } finally {
    await cleanupTestEnv(env);
  }
});
