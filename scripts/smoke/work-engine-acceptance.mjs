#!/usr/bin/env node
/**
 * Stage 10 Phase 3E — Work Engine acceptance runner (local/staging).
 * Orchestrates checklist probes; does not replace full manual QA.
 *
 * Required for API probes:
 *   API_BASE_URL, AUTH_TOKEN, ORG_ID, CLIENT_ID
 *
 * Optional:
 *   INTERNAL_CRON_SECRET — scheduler endpoint probes
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — audit row spot-checks
 *   SMOKE_RUN_ID
 */

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const REQUIRED = ['API_BASE_URL', 'AUTH_TOKEN', 'ORG_ID', 'CLIENT_ID'];

function missingEnv(keys) {
  return keys.filter((k) => !String(process.env[k] ?? '').trim());
}

function baseUrl() {
  return String(process.env.API_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.AUTH_TOKEN.trim()}`,
    'x-organization-id': process.env.ORG_ID.trim(),
    'Content-Type': 'application/json',
  };
}

async function fetchJson(method, path, body, extraHeaders = {}) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const init = { method, headers: { ...authHeaders(), ...extraHeaders } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { res, json };
}

function runNodeTests() {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', '--test', 'tests/work-engine/*.spec.ts'],
    { cwd: path.join(ROOT, 'apps/api'), shell: process.platform === 'win32', encoding: 'utf8' },
  );
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    detail: r.status === 0 ? '28 unit tests' : (r.stderr || r.stdout || 'test run failed').slice(0, 300),
  };
}

async function main() {
  const miss = missingEnv(REQUIRED);
  if (miss.length) {
    console.error('Missing env for API acceptance:', miss.join(', '));
    console.error('See docs/work-engine-stage10-acceptance-report.md');
    process.exit(2);
  }

  const orgId = process.env.ORG_ID.trim();
  const clientId = process.env.CLIENT_ID.trim();
  const smokeRunId = String(process.env.SMOKE_RUN_ID ?? '').trim() || `acceptance-${Date.now()}`;
  const intakePeriodKey = String(process.env.TEST_PERIOD_KEY ?? '').trim() || 'payroll:2026-05';
  const results = [];

  results.push({
    section: '0-unit',
    name: 'work-engine unit tests (logic)',
    ...(runNodeTests()),
  });

  const { res: healthRes, json: healthJson } = await fetchJson('GET', '/health');
  results.push({
    section: '8-scheduler',
    name: 'GET /health',
    ok: healthRes.status === 200 && healthJson?.ok === true,
    status: healthRes.status,
    detail: healthRes.status === 200 ? 'ok' : String(healthJson?.message ?? 'failed'),
  });

  const cronSecret = String(process.env.INTERNAL_CRON_SECRET ?? '').trim();
  if (cronSecret) {
    const noSecret = await fetchJson(
      'POST',
      '/work-engine/internal/scheduler/run',
      { dry_run: true },
      {},
    );
    results.push({
      section: '8-scheduler',
      name: 'scheduler rejects missing secret',
      ok: noSecret.res.status === 403,
      status: noSecret.res.status,
      detail: '403 expected',
    });

    const withSecret = await fetchJson(
      'POST',
      '/work-engine/internal/scheduler/run',
      { dry_run: true, batch_size: 5, max_work_items_per_run: 5 },
      { 'X-Internal-Cron-Secret': cronSecret },
    );
    results.push({
      section: '8-scheduler',
      name: 'scheduler dry_run with secret',
      ok: withSecret.res.status === 200 && withSecret.json?.ok === true,
      status: withSecret.res.status,
      detail: withSecret.json?.skipped
        ? `skipped=${withSecret.json.skipped}`
        : `scanned=${withSecret.json?.scanned_work_items ?? '?'}`,
    });
  } else {
    results.push({
      section: '8-scheduler',
      name: 'scheduler endpoint (skipped)',
      ok: true,
      status: 0,
      detail: 'Set INTERNAL_CRON_SECRET to probe scheduler',
    });
  }

  const validIntake = {
    client_id: clientId,
    source_module: 'acceptance_test',
    source_entity_type: 'acceptance_entity',
    source_entity_id: `acceptance-${smokeRunId}`,
    event_type: 'payroll.documents_missing',
    period_key: intakePeriodKey,
    occurred_at: new Date().toISOString(),
    schema_version: 1,
    emitted_by_type: 'system',
    emitted_by_id: null,
    payload: { acceptance: true },
  };

  const firstIntake = await fetchJson('POST', '/work-engine/commands', {
    command: 'intake_work_event',
    payload: { ...validIntake, event_id: randomUUID(), idempotency_key: `${smokeRunId}-valid-1` },
  });
  const firstOk =
    firstIntake.res.status === 200 &&
    firstIntake.json?.ok === true &&
    ['created', 'reused_existing', 'duplicate_event', 'pending_mapping'].includes(
      firstIntake.json?.meta?.intake_result,
    );
  results.push({
    section: '1-intake',
    name: 'intake_work_event valid mapped event',
    ok: firstOk,
    status: firstIntake.res.status,
    detail: firstIntake.json?.meta?.intake_result ?? JSON.stringify(firstIntake.json).slice(0, 120),
  });

  const dupBody = {
    command: 'intake_work_event',
    payload: {
      ...validIntake,
      event_id: randomUUID(),
      idempotency_key: `${smokeRunId}-valid-1`,
    },
  };
  const dup2 = await fetchJson('POST', '/work-engine/commands', dupBody);
  results.push({
    section: '1-intake',
    name: 'intake idempotency_key dedup',
    ok: dup2.res.status === 200 && dup2.json?.meta?.intake_result === 'duplicate_event',
    status: dup2.res.status,
    detail: dup2.json?.meta?.intake_result ?? 'n/a',
  });

  const unknownIntake = await fetchJson('POST', '/work-engine/commands', {
    command: 'intake_work_event',
    payload: {
      ...validIntake,
      event_id: randomUUID(),
      idempotency_key: `${smokeRunId}-unknown`,
      event_type: 'acceptance.unknown_event_type',
    },
  });
  results.push({
    section: '1-intake',
    name: 'unknown event_type → pending_mapping',
    ok:
      unknownIntake.res.status === 200 &&
      unknownIntake.json?.meta?.intake_result === 'pending_mapping',
    status: unknownIntake.res.status,
    detail: unknownIntake.json?.meta?.intake_result ?? JSON.stringify(unknownIntake.json).slice(0, 120),
  });

  const queue = await fetchJson('GET', '/work-engine/aggregates/queue');
  const queueOk =
    queue.res.status === 200 &&
    queue.json?.aggregate_key === 'work_engine_queue_aggregate' &&
    Array.isArray(queue.json?.rows) &&
    queue.json?.reminder_review_summary != null;
  results.push({
    section: '5-ux',
    name: 'queue aggregate includes reminder_review_summary',
    ok: queueOk,
    status: queue.res.status,
    detail: queueOk
      ? `pending_reminders=${queue.json.reminder_review_summary?.pending_count ?? 0}`
      : 'shape mismatch',
  });

  if (queueOk && queue.json.org_id !== orgId) {
    results.push({
      section: '1-intake',
      name: 'tenant org_id on aggregate',
      ok: false,
      status: queue.res.status,
      detail: `aggregate org mismatch`,
    });
  } else if (queueOk) {
    results.push({
      section: '1-intake',
      name: 'tenant org_id on aggregate',
      ok: true,
      status: queue.res.status,
      detail: 'org_id matches auth header',
    });
  }

  const stale = await fetchJson('POST', '/work-engine/commands', {
    command: 'set_work_deadline',
    payload: {
      work_item_id: '00000000-0000-4000-8000-000000000001',
      expected_version: 0,
      due_at: new Date().toISOString(),
      idempotency_key: `${smokeRunId}-stale`,
      refresh_aggregate: 'work_engine_queue_aggregate',
    },
  });
  results.push({
    section: '10-failure',
    name: 'invalid/stale command fails safely',
    ok: stale.res.status === 404 || stale.res.status === 409 || stale.res.status === 400,
    status: stale.res.status,
    detail: stale.json?.code ?? 'rejected',
  });

  let failed = 0;
  console.log('\nWork Engine Stage 10 acceptance (3E)\n');
  for (const r of results) {
    const label = r.ok ? 'PASS' : 'FAIL';
    console.log(`${label}  [${r.section}] ${r.name}`);
    if (!r.ok) {
      console.log(`       ${r.detail}`);
      failed += 1;
    }
  }
  console.log('\nFull lifecycle coverage: run scripts/smoke/work-engine-smoke.mjs');
  console.log('Reminder commands: scripts/smoke/work-engine-reminder-smoke.mjs');
  console.log('Report: docs/work-engine-stage10-acceptance-report.md\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
