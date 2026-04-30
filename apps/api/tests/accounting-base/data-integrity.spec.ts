import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../src/db/client.js';
import { cleanupTestEnv, createCategory, createPeriod, createTestEnv } from './test-helpers.js';

test('DB constraints: amount non-negative, posting-state consistency, org mismatch prevention, summary period FK', async () => {
  const env = await createTestEnv('ab-integrity');
  try {
    const periodA = await createPeriod({ orgId: env.orgA, label: `${env.marker}-p-a`, status: 'open' });
    const catA = await createCategory({ orgId: env.orgA, code: `${env.marker}-c-a` });
    const periodB = await createPeriod({ orgId: env.orgB, label: `${env.marker}-p-b`, status: 'open' });
    const catB = await createCategory({ orgId: env.orgB, code: `${env.marker}-c-b` });

    // amount cannot be negative
    const neg = await supabaseAdmin.from('accounting_entries').insert({
      id: randomUUID(),
      organization_id: env.orgA,
      period_id: periodA,
      category_id: catA,
      entry_type: 'income',
      status: 'active',
      posting_state: 'draft',
      entry_date: '2026-06-01',
      amount: -1,
      currency: 'ILS',
      direction: 'credit',
      created_by: env.userId,
      is_archived: false,
    });
    assert.ok(neg.error, 'negative amount should violate constraint');

    // posting_state consistency
    const inconsistent = await supabaseAdmin.from('accounting_entries').insert({
      id: randomUUID(),
      organization_id: env.orgA,
      period_id: periodA,
      category_id: catA,
      entry_type: 'income',
      status: 'active',
      posting_state: 'draft',
      entry_date: '2026-06-01',
      amount: 10,
      currency: 'ILS',
      direction: 'credit',
      created_by: env.userId,
      finalized_at: new Date().toISOString(),
      finalized_by: env.userId,
      is_archived: false,
    });
    assert.ok(inconsistent.error, 'posting_state/finalized fields should be consistent');

    // org mismatch prevention
    const orgMismatch = await supabaseAdmin.from('accounting_entries').insert({
      id: randomUUID(),
      organization_id: env.orgA,
      period_id: periodB, // foreign org
      category_id: catB, // foreign org
      entry_type: 'income',
      status: 'active',
      posting_state: 'draft',
      entry_date: '2026-06-01',
      amount: 10,
      currency: 'ILS',
      direction: 'credit',
      created_by: env.userId,
      is_archived: false,
    });
    assert.ok(orgMismatch.error, 'cross-org references should fail');

    // summary must have valid period FK
    const badSummary = await supabaseAdmin.from('accounting_summaries').insert({
      id: randomUUID(),
      organization_id: env.orgA,
      period_id: randomUUID(),
      summary_scope: 'period',
      summary_key: 'x',
      amount_total: 1,
      currency: 'ILS',
    });
    assert.ok(badSummary.error, 'summary without valid period should fail');
  } finally {
    await cleanupTestEnv(env);
  }
});
