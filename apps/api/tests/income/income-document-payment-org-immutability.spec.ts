import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

test('INV-5B migration 150 org immutability for payment orchestration tables', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const { ensureOrgIncomeIssuerProfile } = await import(
    '../../src/domains/income/income-issuer-context.service.js'
  );
  const { cleanupTestEnv, createTestEnv } = await import('../accounting-base/test-helpers.js');

  const { error: tableErr } = await supabaseAdmin
    .from('income_document_payment_operations')
    .select('id')
    .limit(1);
  if (tableErr) {
    t.skip('migration 149 not applied');
    return;
  }

  const env = await createTestEnv('inv5b-org');
  try {
    const issuer = await ensureOrgIncomeIssuerProfile(env.orgA);

    async function seedDoc(documentType: 'tax_invoice' | 'receipt'): Promise<string> {
      const id = randomUUID();
      const { error } = await supabaseAdmin.from('income_documents').insert({
        id,
        organization_id: env.orgA,
        issuer_business_id: issuer.id,
        actor_user_id: env.userId,
        acting_mode: 'self',
        document_type: documentType,
        document_number: `ORG-${documentType.slice(0, 3)}-${id.slice(0, 6)}`,
        document_status: 'issued',
        issue_date: '2026-07-01',
        currency: 'ILS',
        language: 'he',
        customer_snapshot_json: {},
        lines_snapshot_json: [],
        totals_snapshot_json: { grand_total_reference: 100 },
        legal_snapshot_json: {},
        issuer_snapshot_json: {},
      });
      if (error) throw error;
      return id;
    }

    const invoiceId = await seedDoc('tax_invoice');
    const receiptId = await seedDoc('receipt');

    const linkId = randomUUID();
    const { error: linkInsErr } = await supabaseAdmin.from('income_document_links').insert({
      id: linkId,
      organization_id: env.orgA,
      relationship_key: 'payment_receipt_for_invoice',
      relationship_label: 'תשלום עבור חשבונית מס מס׳ X',
      source_document_id: invoiceId,
      target_document_id: receiptId,
      payment_id: randomUUID(),
      allocation_id: randomUUID(),
      allocated_amount: 100,
      currency: 'ILS',
      created_by: env.userId,
    });
    if (linkInsErr) throw linkInsErr;

    const opId = randomUUID();
    const { error: opInsErr } = await supabaseAdmin
      .from('income_document_payment_operations')
      .insert({
        id: opId,
        organization_id: env.orgA,
        idempotency_key: `org-imm-${opId}`,
        command_type: 'record_income_document_payment',
        invoice_document_id: invoiceId,
        status: 'started',
        amount: 100,
        currency: 'ILS',
        payment_date: '2026-08-01',
        payment_method_key: 'bank_transfer',
        created_by: env.userId,
      });
    if (opInsErr) throw opInsErr;

    await t.test('org_id update rejected on income_document_links', async () => {
      const { error } = await supabaseAdmin
        .from('income_document_links')
        .update({ organization_id: env.orgB })
        .eq('id', linkId);
      assert.ok(error, 'expected organization_id update to fail');
      assert.match(String(error.message ?? error), /organization_id is immutable/i);
    });

    await t.test('non-org field update allowed on income_document_links', async () => {
      const { error } = await supabaseAdmin
        .from('income_document_links')
        .update({ relationship_label: 'תשלום חלקי עבור חשבונית מס מס׳ X' })
        .eq('id', linkId);
      assert.equal(error, null, error?.message);
      const { data, error: readErr } = await supabaseAdmin
        .from('income_document_links')
        .select('organization_id, relationship_label')
        .eq('id', linkId)
        .single();
      assert.equal(readErr, null, readErr?.message);
      assert.equal(data?.organization_id, env.orgA);
      assert.match(String(data?.relationship_label ?? ''), /תשלום חלקי/);
    });

    await t.test('org_id update rejected on income_document_payment_operations', async () => {
      const { error } = await supabaseAdmin
        .from('income_document_payment_operations')
        .update({ organization_id: env.orgB })
        .eq('id', opId);
      assert.ok(error, 'expected organization_id update to fail');
      assert.match(String(error.message ?? error), /organization_id is immutable/i);
    });

    await t.test('lifecycle non-org field update allowed on payment operations', async () => {
      const { error } = await supabaseAdmin
        .from('income_document_payment_operations')
        .update({
          status: 'failed',
          failure_reason: 'org-immutability-test',
        })
        .eq('id', opId);
      assert.equal(error, null, error?.message);
      const { data, error: readErr } = await supabaseAdmin
        .from('income_document_payment_operations')
        .select('organization_id, status, failure_reason')
        .eq('id', opId)
        .single();
      assert.equal(readErr, null, readErr?.message);
      assert.equal(data?.organization_id, env.orgA);
      assert.equal(data?.status, 'failed');
      assert.equal(data?.failure_reason, 'org-immutability-test');
    });
  } finally {
    await cleanupTestEnv(env);
  }
});
