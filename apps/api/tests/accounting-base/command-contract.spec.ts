import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeAccountingBaseCommand, type AccountingBaseCommandType } from '../../src/domains/accounting-base/accounting-base-commands.service.js';
import { supabaseAdmin } from '../../src/db/client.js';
import { FULL_PERMS, buildCtx, cleanupTestEnv, createCategory, createClient, createPeriod, createTestEnv } from './test-helpers.js';

function assertContract(res: unknown, expectedCommand: AccountingBaseCommandType) {
  const r = res as {
    ok: boolean;
    command: string;
    refreshed: { aggregate_key: string; aggregate: unknown };
    additional_refreshed?: unknown[];
  };
  assert.equal(r.ok, true);
  assert.equal(r.command, expectedCommand);
  assert.ok(r.refreshed);
  assert.ok(typeof r.refreshed.aggregate_key === 'string');
  assert.ok(r.refreshed.aggregate && typeof r.refreshed.aggregate === 'object');
}

test('command contract and refreshed aggregate mapping for all commands', async () => {
  const env = await createTestEnv('ab-contract');
  try {
    const ctx = buildCtx(env.orgA, env.userId, FULL_PERMS);
    const periodOpen = await createPeriod({ orgId: env.orgA, label: `${env.marker}-open`, status: 'open' });
    const periodLocked = await createPeriod({ orgId: env.orgA, label: `${env.marker}-locked`, status: 'locked' });
    const category = await createCategory({ orgId: env.orgA, code: `${env.marker}-cat` });
    const client = await createClient({ orgId: env.orgA, userId: env.userId, displayName: `${env.marker}-client` });

    const c1 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'create_period',
      payload: {
        period_start: '2026-05-01',
        period_end: '2026-05-31',
        period_label: `${env.marker}-new`,
        base_currency: 'ILS',
      },
    });
    assertContract(c1, 'create_period');
    assert.equal(c1.refreshed.aggregate_key, 'accounting_periods_workspace_aggregate');

    const c2 = await executeAccountingBaseCommand(ctx, env.orgA, { type: 'lock_period', payload: { period_id: periodOpen } });
    assertContract(c2, 'lock_period');
    assert.equal(c2.refreshed.aggregate_key, 'accounting_periods_workspace_aggregate');

    const c3 = await executeAccountingBaseCommand(ctx, env.orgA, { type: 'close_period', payload: { period_id: periodLocked } });
    assertContract(c3, 'close_period');
    assert.equal(c3.refreshed.aggregate_key, 'accounting_periods_workspace_aggregate');

    const c4 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'create_entry',
      payload: {
        period_id: periodOpen,
        category_id: category,
        client_id: client,
        entry_type: 'income',
        entry_date: '2026-05-15',
        amount: 700,
        currency: 'ILS',
        direction: 'credit',
        description: `${env.marker}-entry`,
      },
    });
    assertContract(c4, 'create_entry');
    assert.equal(c4.refreshed.aggregate_key, 'accounting_entries_workspace_aggregate');
    assert.ok(c4.additional_refreshed && c4.additional_refreshed.length > 0);

    const entryId = (c4.additional_refreshed?.[0] as { aggregate: { entry: { id: string } } }).aggregate.entry.id;
    assert.ok(entryId);

    const c5 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'update_draft_entry',
      payload: { entry_id: entryId, description: `${env.marker}-entry-updated` },
    });
    assertContract(c5, 'update_draft_entry');
    assert.equal(c5.refreshed.aggregate_key, 'accounting_entries_workspace_aggregate');

    const c6 = await executeAccountingBaseCommand(ctx, env.orgA, { type: 'finalize_entry', payload: { entry_id: entryId } });
    assertContract(c6, 'finalize_entry');
    assert.equal(c6.refreshed.aggregate_key, 'accounting_entries_workspace_aggregate');

    const c7 = await executeAccountingBaseCommand(ctx, env.orgA, { type: 'archive_entry', payload: { entry_id: entryId } });
    assertContract(c7, 'archive_entry');
    assert.equal(c7.refreshed.aggregate_key, 'accounting_entries_workspace_aggregate');

    const c8 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'create_category',
      payload: { code: `${env.marker}-cat-2`, name: `${env.marker}-cat-2`, category_type: 'expense' },
    });
    assertContract(c8, 'create_category');
    assert.equal(c8.refreshed.aggregate_key, 'accounting_categories_workspace_aggregate');

    const { data: cat2 } = await supabaseAdmin
      .from('accounting_categories')
      .select('id')
      .eq('organization_id', env.orgA)
      .eq('code', `${env.marker}-cat-2`)
      .single();
    assert.ok(cat2?.id);

    const c9 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'update_category',
      payload: { category_id: cat2.id, name: `${env.marker}-cat-2-updated` },
    });
    assertContract(c9, 'update_category');
    assert.equal(c9.refreshed.aggregate_key, 'accounting_categories_workspace_aggregate');

    const c10 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'deactivate_category',
      payload: { category_id: cat2.id },
    });
    assertContract(c10, 'deactivate_category');
    assert.equal(c10.refreshed.aggregate_key, 'accounting_categories_workspace_aggregate');

    // create a fresh draft entry for link commands
    const { data: linkEntry } = await supabaseAdmin
      .from('accounting_entries')
      .insert({
        id: randomUUID(),
        organization_id: env.orgA,
        period_id: periodOpen,
        category_id: category,
        entry_type: 'income',
        status: 'active',
        posting_state: 'draft',
        entry_date: '2026-05-20',
        amount: 333,
        currency: 'ILS',
        direction: 'credit',
        created_by: env.userId,
        is_archived: false,
      })
      .select('id')
      .single();
    assert.ok(linkEntry?.id);

    const c11 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'link_entry_to_entity',
      payload: {
        entry_id: linkEntry.id,
        target_entity_type: 'client',
        target_entity_id: client,
        relation_type: 'reference',
      },
    });
    assertContract(c11, 'link_entry_to_entity');
    assert.equal(c11.refreshed.aggregate_key, 'accounting_entry_details_aggregate');

    const { data: linkRow } = await supabaseAdmin
      .from('accounting_entry_links')
      .select('id')
      .eq('organization_id', env.orgA)
      .eq('accounting_entry_id', linkEntry.id)
      .single();
    assert.ok(linkRow?.id);

    const c12 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'unlink_entry_from_entity',
      payload: { link_id: linkRow.id },
    });
    assertContract(c12, 'unlink_entry_from_entity');
    assert.ok(
      c12.refreshed.aggregate_key === 'accounting_entry_details_aggregate' ||
        c12.refreshed.aggregate_key === 'accounting_entries_workspace_aggregate'
    );

    const c13 = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'recompute_summary',
      payload: { period_id: periodOpen },
    });
    assertContract(c13, 'recompute_summary');
    assert.equal(c13.refreshed.aggregate_key, 'accounting_summary_workspace_aggregate');
  } finally {
    await cleanupTestEnv(env);
  }
});
