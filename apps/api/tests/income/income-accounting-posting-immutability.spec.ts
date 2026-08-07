/**
 * Contract + optional DB integration for income → Accounting Base posting.
 * Avoids importing supabaseAdmin at module load so pure contract tests run without .env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const hasDb =
  Boolean(process.env.SUPABASE_URL?.trim()) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

test('immutability trigger forbids totals_snapshot_json mutation (migration contract)', () => {
  const mig124 = readFileSync(
    join(dir, '../../../../supabase/migrations/124_income_documents_pdf_inc6.sql'),
    'utf8',
  );
  assert.match(mig124, /OLD\.totals_snapshot_json is distinct from NEW\.totals_snapshot_json/);
  assert.match(mig124, /income_documents business fields are immutable after issue/);
});

test(
  'tax_invoice posting marks posted without rewriting totals_snapshot_json',
  { skip: !hasDb },
  async () => {
    await import('dotenv/config');
    const { randomUUID } = await import('node:crypto');
    const { applyAccountingPostingForIssuedDocument } = await import(
      '../../src/domains/income/income-accounting-posting.service.js'
    );
    const { supabaseAdmin } = await import('../../src/db/client.js');
    const { FULL_PERMS, buildCtx, cleanupTestEnv, createTestEnv } = await import(
      '../accounting-base/test-helpers.js'
    );

    const env = await createTestEnv('inc-ab-post');
    try {
      const ctx = buildCtx(env.orgA, env.userId, FULL_PERMS);
      const docId = randomUUID();
      const issuerId = randomUUID();
      const docNumber = `T-${env.marker.slice(-8)}`;
      const totals = {
        preview: true,
        subtotal_reference: 100,
        vat_reference: 17,
        grand_total_reference: 117,
        currency: 'ILS',
      };
      const lines = [{ description: 'svc', amount_reference: 100 }];

      const { error: insertErr } = await supabaseAdmin.from('income_documents').insert({
        id: docId,
        organization_id: env.orgA,
        represented_client_id: null,
        issuer_business_id: issuerId,
        actor_user_id: env.userId,
        acting_mode: 'self',
        income_customer_id: null,
        customer_snapshot_json: { source: 'one_time_snapshot', display_name: 'T' },
        document_type: 'tax_invoice',
        document_number: docNumber,
        document_status: 'issued',
        issue_date: '2026-08-07',
        currency: 'ILS',
        language: 'he',
        lines_snapshot_json: lines,
        totals_snapshot_json: totals,
        legal_snapshot_json: {},
        issuer_snapshot_json: {},
        source_draft_id: null,
        accounting_posting_status: 'pending',
      });
      assert.ifError(insertErr);

      const result = await applyAccountingPostingForIssuedDocument(ctx, {
        id: docId,
        organization_id: env.orgA,
        document_type: 'tax_invoice',
        document_number: docNumber,
        issue_date: '2026-08-07',
        currency: 'ILS',
        represented_client_id: null,
        totals_snapshot_json: totals,
        lines_snapshot_json: lines,
        accounting_posting_status: 'pending',
        accounting_entry_id: null,
      });

      assert.equal(result.accounting_posting_status, 'posted');
      assert.ok(result.accounting_entry_id);
      assert.ok(result.accounting_entry_link_id);

      const { data: row, error: readErr } = await supabaseAdmin
        .from('income_documents')
        .select('accounting_posting_status, accounting_entry_id, totals_snapshot_json')
        .eq('id', docId)
        .single();
      assert.ifError(readErr);
      assert.equal(row?.accounting_posting_status, 'posted');
      assert.equal(row?.accounting_entry_id, result.accounting_entry_id);

      const storedTotals = row?.totals_snapshot_json as Record<string, unknown>;
      assert.equal(storedTotals.subtotal_reference, 100);
      assert.equal(storedTotals.grand_total_reference, 117);
      assert.equal(storedTotals.accounting_entry_ids, undefined);
      assert.equal(storedTotals.authoritative_financial_truth, undefined);

      const { data: links } = await supabaseAdmin
        .from('accounting_entry_links')
        .select('id')
        .eq('organization_id', env.orgA)
        .eq('target_entity_id', docId);
      assert.equal((links ?? []).length, 1);

      const again = await applyAccountingPostingForIssuedDocument(ctx, {
        id: docId,
        organization_id: env.orgA,
        document_type: 'tax_invoice',
        document_number: docNumber,
        issue_date: '2026-08-07',
        currency: 'ILS',
        represented_client_id: null,
        totals_snapshot_json: totals,
        lines_snapshot_json: lines,
        accounting_posting_status: 'posted',
        accounting_entry_id: result.accounting_entry_id,
      });
      assert.equal(again.accounting_entry_id, result.accounting_entry_id);

      const { data: linksAfter } = await supabaseAdmin
        .from('accounting_entry_links')
        .select('id')
        .eq('organization_id', env.orgA)
        .eq('target_entity_id', docId);
      assert.equal((linksAfter ?? []).length, 1);
    } finally {
      await cleanupTestEnv(env);
    }
  },
);
