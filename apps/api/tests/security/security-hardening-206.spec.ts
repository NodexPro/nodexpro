import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

test('migration 206 only adds scan_status and does not alter Phase 5 tables', () => {
  const sql = readFileSync(join(dir, '../../../../supabase/migrations/206_security_hardening_uploads.sql'), 'utf8');
  assert.match(sql, /add column if not exists scan_status/);
  assert.match(sql, /file_assets_scan_status_check/);
  assert.match(sql, /create table if not exists public\.security_journal_entries/);
  assert.match(sql, /hidden_at/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /delete from/i);
  assert.doesNotMatch(sql, /security_incidents/);
  assert.doesNotMatch(sql, /security_alert_deliveries/);
});
