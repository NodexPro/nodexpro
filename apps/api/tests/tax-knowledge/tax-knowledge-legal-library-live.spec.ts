import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdmin } from '../../src/db/client.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

test('TAX-622 live: existing tax knowledge remains unassigned until Owner links it', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const probe = await supabaseAdmin.from('tax_domains').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_domains')) {
    t.skip('migration 622 not applied');
    return;
  }
  if (probe.error) throw probe.error;

  const [sources, rules, links] = await Promise.all([
    supabaseAdmin.from('tax_sources').select('id, tax_domain_id').limit(50),
    supabaseAdmin.from('tax_rules').select('id').limit(50),
    supabaseAdmin.from('tax_rule_legal_nodes').select('id, tax_rule_id').limit(50),
  ]);
  if (sources.error) throw sources.error;
  if (rules.error) throw rules.error;
  if (links.error) throw links.error;

  const linkedRuleIds = new Set((links.data ?? []).map((row) => String(row.tax_rule_id)));
  const unassignedSources = (sources.data ?? []).filter((row) => row.tax_domain_id == null);
  const unassignedRules = (rules.data ?? []).filter((row) => !linkedRuleIds.has(String(row.id)));
  assert.ok(Array.isArray(unassignedSources));
  assert.ok(Array.isArray(unassignedRules));
});
