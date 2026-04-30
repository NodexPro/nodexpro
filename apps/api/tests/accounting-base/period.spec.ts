import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAccountingBaseCommand } from '../../src/domains/accounting-base/accounting-base-commands.service.js';
import { FULL_PERMS, buildCtx, cleanupTestEnv, createPeriod, createTestEnv } from './test-helpers.js';

test('period lifecycle: create -> open, lock only from open, close only from locked', async () => {
  const env = await createTestEnv('ab-period');
  try {
    const ctx = buildCtx(env.orgA, env.userId, FULL_PERMS);

    const createRes = await executeAccountingBaseCommand(ctx, env.orgA, {
      type: 'create_period',
      payload: {
        period_start: '2026-02-01',
        period_end: '2026-02-28',
        period_label: `${env.marker}-created`,
        base_currency: 'ILS',
      },
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.refreshed.aggregate_key, 'accounting_periods_workspace_aggregate');

    const openPeriodId = await createPeriod({
      orgId: env.orgA,
      label: `${env.marker}-open`,
      status: 'open',
    });
    const closedPeriodId = await createPeriod({
      orgId: env.orgA,
      label: `${env.marker}-closed`,
      status: 'closed',
    });

    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctx, env.orgA, {
        type: 'lock_period',
        payload: { period_id: openPeriodId },
      })
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctx, env.orgA, {
          type: 'lock_period',
          payload: { period_id: closedPeriodId },
        }),
      /Only open period can be locked/
    );

    const lockedPeriodId = await createPeriod({
      orgId: env.orgA,
      label: `${env.marker}-locked`,
      status: 'locked',
    });
    await assert.doesNotReject(() =>
      executeAccountingBaseCommand(ctx, env.orgA, {
        type: 'close_period',
        payload: { period_id: lockedPeriodId },
      })
    );

    await assert.rejects(
      () =>
        executeAccountingBaseCommand(ctx, env.orgA, {
          type: 'close_period',
          payload: { period_id: closedPeriodId },
        }),
      /Only locked period can be closed/
    );
  } finally {
    await cleanupTestEnv(env);
  }
});
