/**
 * INV-5A — verify migration 148 objects in the connected Supabase DB.
 * Requires apps/api/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage: node --env-file=.env scripts/verify-inv5a-migration-148.mjs
 *    or: npx dotenv -e .env -- node scripts/verify-inv5a-migration-148.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const checks = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ name, ok: false, detail: msg });
    console.error(`FAIL  ${name} — ${msg}`);
  }
}

await check('accounting_payments table readable', async () => {
  const { error } = await sb.from('accounting_payments').select('id').limit(1);
  if (error) throw new Error(error.message);
  return 'ok';
});

await check('accounting_payment_allocations table readable', async () => {
  const { error } = await sb.from('accounting_payment_allocations').select('id').limit(1);
  if (error) throw new Error(error.message);
  return 'ok';
});

await check('atomic RPC exists', async () => {
  // Call with nulls → expect a validation error from the function, not "function not found".
  const { error } = await sb.rpc('accounting_base_record_and_allocate_income_payment', {
    p_organization_id: null,
    p_income_document_id: null,
    p_issuer_business_id: null,
    p_represented_client_id: null,
    p_payment_date: '2026-01-01',
    p_payment_method_key: 'bank_transfer',
    p_amount: 1,
    p_currency: 'ILS',
    p_reference_number: null,
    p_note: null,
    p_idempotency_key: 'verify-probe',
    p_created_by: null,
    p_original_amount: 1,
  });
  if (!error) throw new Error('expected validation error from RPC');
  const msg = String(error.message ?? '');
  if (/Could not find the function|schema cache|404/i.test(msg)) {
    throw new Error(`RPC missing: ${msg}`);
  }
  return `RPC reachable (${msg.slice(0, 80)})`;
});

await check('permission accounting_base.payment.write', async () => {
  const { data, error } = await sb
    .from('permissions')
    .select('code')
    .eq('code', 'accounting_base.payment.write')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('permission row missing');
  return 'present';
});

const failed = checks.filter((c) => !c.ok).length;
console.log(`\nSummary: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
