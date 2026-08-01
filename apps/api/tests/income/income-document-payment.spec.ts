import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

test('INV-5B record_income_document_payment orchestration', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { executeIncomeCommand } = await import('../../src/domains/income/income-commands.service.js');
  const { ensureOrgIncomeIssuerProfile } = await import(
    '../../src/domains/income/income-issuer-context.service.js'
  );
  const { supabaseAdmin } = await import('../../src/db/client.js');
  const {
    FULL_PERMS,
    buildCtx,
    cleanupTestEnv,
    createClient,
    createTestEnv,
  } = await import('../accounting-base/test-helpers.js');
  type TestEnv = Awaited<ReturnType<typeof createTestEnv>>;

  const { error: tableErr } = await supabaseAdmin
    .from('income_document_payment_operations')
    .select('id')
    .limit(1);
  if (tableErr) {
    t.skip('migration 149 not applied');
    return;
  }

  const PERMS = [
    ...FULL_PERMS,
    'income.view',
    'income.edit',
    'income.issue',
    'income.issue_on_behalf',
    'clients:read',
  ];

  async function seedIssuedTaxInvoice(
    env: TestEnv,
    amount: number,
    opts?: { clientId?: string },
  ): Promise<string> {
    const issuer = await ensureOrgIncomeIssuerProfile(env.orgA);
    const clientId = opts?.clientId ?? null;
    await supabaseAdmin.from('income_user_workspace_contexts').upsert(
      {
        organization_id: env.orgA,
        user_id: env.userId,
        acting_mode: clientId ? 'office_representative' : 'self',
        issuer_business_id: clientId ?? issuer.id,
        represented_client_id: clientId,
      },
      { onConflict: 'organization_id,user_id' },
    );
    const documentId = randomUUID();
    const { error } = await supabaseAdmin.from('income_documents').insert({
      id: documentId,
      organization_id: env.orgA,
      represented_client_id: clientId,
      issuer_business_id: clientId ?? issuer.id,
      actor_user_id: env.userId,
      acting_mode: clientId ? 'office_representative' : 'self',
      document_type: 'tax_invoice',
      document_number: `INV-5B-${documentId.slice(0, 8)}`,
      document_status: 'issued',
      issue_date: '2026-07-01',
      currency: 'ILS',
      language: 'he',
      customer_snapshot_json: { display_name: 'Customer 5B' },
      lines_snapshot_json: [],
      totals_snapshot_json: {
        grand_total_reference: amount,
        subtotal_reference: amount,
      },
      legal_snapshot_json: {},
      issuer_snapshot_json: {},
    });
    if (error) throw error;
    return documentId;
  }

  async function pay(
    env: TestEnv,
    incomeDocumentId: string,
    amount: number,
    idempotencyKey: string,
  ) {
    const ctx = buildCtx(env.orgA, env.userId, PERMS);
    return executeIncomeCommand(ctx, {
      command: 'record_income_document_payment',
      income_document_id: incomeDocumentId,
      payment_date: '2026-08-01',
      payment_method_key: 'bank_transfer',
      amount,
      currency: 'ILS',
      reference_number: 'R-5B',
      note: 'test',
      idempotency_key: idempotencyKey,
    });
  }

  const env = await createTestEnv('inv5b');
  try {
    await t.test('1) partial payment creates allocation + receipt + Hebrew text + case', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 4000);
      const res = await pay(env, invoiceId, 1500, `5b-partial-${invoiceId}`);
      assert.equal(res.ok, true);
      assert.equal(res.command, 'record_income_document_payment');
      assert.ok(res.income_workspace_aggregate);
      assert.ok(res.income_workspace_context_aggregate);
      assert.ok(res.income_document_payment_case);
      const pc = res.income_document_payment_case!;
      assert.equal(pc.financial_summary.allocated_amount, 1500);
      assert.equal(pc.financial_summary.remaining_balance, 2500);
      assert.equal(pc.financial_summary.payment_state_label, 'שולם חלקית');
      assert.equal(pc.linked_receipts.length, 1);
      assert.equal(pc.linked_receipts[0]?.amount, 1500);
      assert.match(pc.linked_receipts[0]?.relationship_label ?? '', /תשלום חלקי/);
      assert.ok(res.meta?.receipt_document_id);

      const { data: receipt } = await supabaseAdmin
        .from('income_documents')
        .select('document_type, document_status, notes, totals_snapshot_json')
        .eq('id', res.meta!.receipt_document_id!)
        .single();
      assert.equal((receipt as { document_type: string }).document_type, 'receipt');
      assert.equal((receipt as { document_status: string }).document_status, 'issued');
      assert.match(String((receipt as { notes: string | null }).notes ?? ''), /תשלום חלקי/);
    });

    await t.test('2) full payment → paid + check icon', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 2000);
      const res = await pay(env, invoiceId, 2000, `5b-full-${invoiceId}`);
      const fs = res.income_document_payment_case!.financial_summary;
      assert.equal(fs.remaining_balance, 0);
      assert.equal(fs.payment_state_key, 'paid');
      assert.equal(fs.payment_state_label, 'שולם');
      assert.equal(fs.payment_state_icon, 'check');
      assert.ok(res.income_document_payment_case!.document_type_counters.receipt >= 1);
    });

    await t.test('3) second payment completes and links both receipts', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 3000);
      await pay(env, invoiceId, 1000, `5b-p2a-${invoiceId}`);
      const res = await pay(env, invoiceId, 2000, `5b-p2b-${invoiceId}`);
      assert.equal(res.income_document_payment_case!.linked_receipts.length, 2);
      assert.equal(res.income_document_payment_case!.financial_summary.payment_state_key, 'paid');
    });

    await t.test('4) idempotency retry creates no duplicates', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 5000);
      const key = `5b-idem-${invoiceId}`;
      const first = await pay(env, invoiceId, 1000, key);
      const second = await pay(env, invoiceId, 1000, key);
      assert.equal(first.meta?.payment_id, second.meta?.payment_id);
      assert.equal(first.meta?.receipt_document_id, second.meta?.receipt_document_id);
      assert.equal(second.meta?.idempotent_replay, true);
      const { data: ops } = await supabaseAdmin
        .from('income_document_payment_operations')
        .select('id')
        .eq('organization_id', env.orgA)
        .eq('idempotency_key', key);
      assert.equal((ops ?? []).length, 1);
    });

    await t.test('5-10) validation rejections', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 1000);
      const ctx = buildCtx(env.orgA, env.userId, PERMS);

      await assert.rejects(
        () =>
          executeIncomeCommand(ctx, {
            command: 'record_income_document_payment',
            income_document_id: invoiceId,
            payment_date: '2026-08-01',
            payment_method_key: 'bank_transfer',
            amount: 100,
            currency: 'USD',
            idempotency_key: `5b-ccy-${invoiceId}`,
          }),
        /currency/i,
      );

      await assert.rejects(
        () =>
          executeIncomeCommand(ctx, {
            command: 'record_income_document_payment',
            income_document_id: invoiceId,
            payment_date: '2026-08-01',
            payment_method_key: 'bank_transfer',
            amount: 1001,
            currency: 'ILS',
            idempotency_key: `5b-over-${invoiceId}`,
          }),
        /remaining balance|exceeds/i,
      );

      const quoteId = randomUUID();
      const issuer = await ensureOrgIncomeIssuerProfile(env.orgA);
      await supabaseAdmin.from('income_documents').insert({
        id: quoteId,
        organization_id: env.orgA,
        issuer_business_id: issuer.id,
        actor_user_id: env.userId,
        acting_mode: 'self',
        document_type: 'quote',
        document_number: `Q-${quoteId.slice(0, 6)}`,
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
      await assert.rejects(
        () => pay(env, quoteId, 50, `5b-quote-${quoteId}`),
        /tax_invoice/i,
      );

      const cancelledId = randomUUID();
      await supabaseAdmin.from('income_documents').insert({
        id: cancelledId,
        organization_id: env.orgA,
        issuer_business_id: issuer.id,
        actor_user_id: env.userId,
        acting_mode: 'self',
        document_type: 'tax_invoice',
        document_number: `C-${cancelledId.slice(0, 6)}`,
        document_status: 'cancelled_future',
        issue_date: '2026-07-01',
        currency: 'ILS',
        language: 'he',
        customer_snapshot_json: {},
        lines_snapshot_json: [],
        totals_snapshot_json: { grand_total_reference: 100 },
        legal_snapshot_json: {},
        issuer_snapshot_json: {},
      });
      await assert.rejects(
        () => pay(env, cancelledId, 50, `5b-draft-${cancelledId}`),
        /issued/i,
      );

      const ctxB = buildCtx(env.orgB, env.userId, PERMS);
      await assert.rejects(
        () =>
          executeIncomeCommand(ctxB, {
            command: 'record_income_document_payment',
            income_document_id: invoiceId,
            payment_date: '2026-08-01',
            payment_method_key: 'bank_transfer',
            amount: 10,
            currency: 'ILS',
            idempotency_key: `5b-xorg-${invoiceId}`,
          }),
        /not found|issuer|scope|Organization/i,
      );

      const clientA = await createClient({
        orgId: env.orgA,
        userId: env.userId,
        displayName: `${env.marker}-a`,
      });
      const clientB = await createClient({
        orgId: env.orgA,
        userId: env.userId,
        displayName: `${env.marker}-b`,
      });
      const repInvoice = await seedIssuedTaxInvoice(env, 800, { clientId: clientA });
      await supabaseAdmin.from('income_user_workspace_contexts').upsert(
        {
          organization_id: env.orgA,
          user_id: env.userId,
          acting_mode: 'office_representative',
          issuer_business_id: clientB,
          represented_client_id: clientB,
        },
        { onConflict: 'organization_id,user_id' },
      );
      await assert.rejects(
        () => pay(env, repInvoice, 100, `5b-rep-${repInvoice}`),
        /issuer scope|represented client/i,
      );
    });

    await t.test('15) no payment_status column on income_documents', async () => {
      const invoiceId = await seedIssuedTaxInvoice(env, 500);
      await pay(env, invoiceId, 500, `5b-nostatus-${invoiceId}`);
      const { data } = await supabaseAdmin.from('income_documents').select('*').eq('id', invoiceId).single();
      assert.equal(Object.prototype.hasOwnProperty.call(data, 'payment_status'), false);
    });
  } finally {
    await cleanupTestEnv(env);
  }
});
