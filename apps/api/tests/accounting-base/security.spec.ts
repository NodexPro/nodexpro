import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeAccountingBaseCommand } from '../../src/domains/accounting-base/accounting-base-commands.service.js';
import { supabaseAdmin } from '../../src/db/client.js';
import { FULL_PERMS, buildCtx, cleanupTestEnv, createCategory, createClient, createPeriod, createTestEnv } from './test-helpers.js';

test('tenant isolation, permission checks, and link integrity', async () => {
  const env = await createTestEnv('ab-sec');
  try {
    const ctxA = buildCtx(env.orgA, env.userId, FULL_PERMS);
    const ctxB = buildCtx(env.orgB, env.userId, FULL_PERMS);
    const ctxAWithoutEntryWrite = buildCtx(
      env.orgA,
      env.userId,
      FULL_PERMS.filter((p) => p !== 'accounting_base.entry.write')
    );

    const periodA = await createPeriod({ orgId: env.orgA, label: `${env.marker}-p-a`, status: 'open' });
    const catA = await createCategory({ orgId: env.orgA, code: `${env.marker}-c-a` });
    const periodB = await createPeriod({ orgId: env.orgB, label: `${env.marker}-p-b`, status: 'open' });
    const catB = await createCategory({ orgId: env.orgB, code: `${env.marker}-c-b` });
    const clientB = await createClient({ orgId: env.orgB, userId: env.userId, displayName: `${env.marker}-client-b` });

    const createRes = await executeAccountingBaseCommand(ctxA, env.orgA, {
      type: 'create_entry',
      payload: {
        period_id: periodA,
        category_id: catA,
        entry_type: 'income',
        entry_date: '2026-04-10',
        amount: 250,
        currency: 'ILS',
        direction: 'credit',
        description: `${env.marker}-entry-a`,
      },
    });
    const entryId = createRes.additional_refreshed?.find((x) => x.aggregate_key === 'accounting_entry_details_aggregate')?.aggregate.entry.id;
    assert.ok(entryId);

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxB, env.orgB, {
          type: 'update_draft_entry',
          payload: { entry_id: entryId, description: 'cross-org update' },
        }),
      /not found|Only draft entry can be updated|[Oo]bject/
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxAWithoutEntryWrite, env.orgA, {
          type: 'create_entry',
          payload: {
            period_id: periodA,
            category_id: catA,
            entry_type: 'income',
            entry_date: '2026-04-11',
            amount: 111,
            currency: 'ILS',
            direction: 'credit',
          },
        }),
      /Insufficient permission/
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxA, env.orgA, {
          type: 'link_entry_to_entity',
          payload: {
            entry_id: entryId,
            target_entity_type: 'client',
            target_entity_id: randomUUID(),
            relation_type: 'reference',
          },
        }),
      /Invalid link target/
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxA, env.orgA, {
          type: 'link_entry_to_entity',
          payload: {
            entry_id: entryId,
            target_entity_type: 'client',
            target_entity_id: clientB,
            relation_type: 'reference',
          },
        }),
      /Invalid link target/
    );

    // Valid link
    const clientA = await createClient({ orgId: env.orgA, userId: env.userId, displayName: `${env.marker}-client-a` });
    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctxA, env.orgA, {
        type: 'link_entry_to_entity',
        payload: {
          entry_id: entryId,
          target_entity_type: 'client',
          target_entity_id: clientA,
          relation_type: 'reference',
        },
      })
    );

    // Cross-org write via mismatched period/category should fail at DB/constraints
    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctxA, env.orgA, {
          type: 'create_entry',
          payload: {
            period_id: periodB,
            category_id: catB,
            entry_type: 'income',
            entry_date: '2026-04-12',
            amount: 222,
            currency: 'ILS',
            direction: 'credit',
          },
        }),
      /violates|Cross-tenant|Invalid|object/
    );
  } finally {
    await cleanupTestEnv(env);
  }
});
