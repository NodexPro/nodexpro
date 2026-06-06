#!/usr/bin/env node
/**
 * Diagnose Income Client Document Management panel row counts.
 *
 * Usage (from repo root, with apps/api/.env configured):
 *   node scripts/diagnose-income-client-document-panel.mjs <organization_id>
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PANEL_DOCUMENT_TYPES = [
  'quote',
  'deal_invoice',
  'tax_invoice',
  'tax_invoice_receipt',
  'receipt',
  'credit_tax_invoice',
];

function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = resolve(root, 'apps/api/.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
}

function resolveOfficeClientGroupKey(row) {
  if (row.represented_client_id) return row.represented_client_id;
  if (row.acting_mode === 'office_representative') return row.issuer_business_id;
  return null;
}

loadEnv();

const orgId = process.argv[2]?.trim();
if (!orgId) {
  console.error('Usage: node scripts/diagnose-income-client-document-panel.mjs <organization_id>');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set apps/api/.env)');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function count(table, filters) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
}

async function main() {
  console.log(`\nIncome Client Document Panel diagnostics — org ${orgId}\n`);

  const issuedTotal = await count('income_documents', { document_status: 'issued' });
  const draftTotal = await count('income_document_drafts', { status: 'draft' });

  console.log('1) income_documents issued total:', issuedTotal);
  console.log('2) income_document_drafts active total:', draftTotal);

  const { data: issuedRows, error: issuedErr } = await supabase
    .from('income_documents')
    .select('represented_client_id, issuer_business_id, acting_mode, document_type, document_status')
    .eq('organization_id', orgId)
    .eq('document_status', 'issued')
    .in('document_type', PANEL_DOCUMENT_TYPES)
    .limit(5000);
  if (issuedErr) throw issuedErr;

  const { data: draftRows, error: draftErr } = await supabase
    .from('income_document_drafts')
    .select('represented_client_id, issuer_business_id, acting_mode, document_type, status')
    .eq('organization_id', orgId)
    .eq('status', 'draft')
    .limit(5000);
  if (draftErr) throw draftErr;

  let issuedSelf = 0;
  let issuedOfficeWithClient = 0;
  let issuedOfficeNoClientKey = 0;
  const issuedByClient = new Map();

  for (const raw of issuedRows ?? []) {
    const key = resolveOfficeClientGroupKey(raw);
    if (!key) {
      if (raw.acting_mode === 'self') issuedSelf += 1;
      else issuedOfficeNoClientKey += 1;
      continue;
    }
    issuedOfficeWithClient += 1;
    issuedByClient.set(key, (issuedByClient.get(key) ?? 0) + 1);
  }

  let draftSelf = 0;
  let draftOfficeWithClient = 0;
  const draftByClient = new Map();

  for (const raw of draftRows ?? []) {
    const key = resolveOfficeClientGroupKey(raw);
    if (!key) {
      draftSelf += 1;
      continue;
    }
    draftOfficeWithClient += 1;
    draftByClient.set(key, (draftByClient.get(key) ?? 0) + 1);
  }

  console.log('\n3) Issued (panel document types):');
  console.log('   self-mode (excluded from panel):', issuedSelf);
  console.log('   office with client key (included):', issuedOfficeWithClient);
  console.log('   office without client key:', issuedOfficeNoClientKey);

  console.log('\n4) Drafts:');
  console.log('   self-mode (excluded):', draftSelf);
  console.log('   office with client key (included):', draftOfficeWithClient);

  const panelClientIds = new Set([...issuedByClient.keys(), ...draftByClient.keys()]);
  console.log('\n5) Expected panel row count:', panelClientIds.size);

  console.log('\n6) Grouped by client key (issued | drafts):');
  for (const clientId of [...panelClientIds].sort()) {
    console.log(
      `   ${clientId}  issued=${issuedByClient.get(clientId) ?? 0}  drafts=${draftByClient.get(clientId) ?? 0}`,
    );
  }

  if (panelClientIds.size === 0) {
    console.log('\n7) Panel empty because no office-client documents/drafts exist for this org.');
    console.log(
      '   To populate: select office client (office_representative), create a draft or issue a quote/invoice for that client.',
    );
    if (issuedSelf > 0 || draftSelf > 0) {
      console.log(
        `   Note: ${issuedSelf} issued + ${draftSelf} draft self-mode rows exist but are intentionally excluded.`,
      );
    }
  } else {
    console.log('\n7) Data exists — panel aggregate should return rows after API deploy with draft + fallback grouping.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
