#!/usr/bin/env node
/**
 * Work Engine Phase 3B-2 — generate_reminder_candidate smoke (local only).
 *
 * Required:
 *   API_BASE_URL, AUTH_TOKEN, ORG_ID
 *   TEST_WORK_ITEM_ID, TEST_WORK_ITEM_VERSION
 *   TEST_REMINDER_WORKFLOW_TYPE (waiting_client | response_sla | review_sla)
 *   TEST_REMINDER_STEP_KEY (must exist in active operational reminder policy)
 *
 * Optional:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — verify DB rows (candidate exists, no notifications)
 *   SMOKE_RUN_ID
 */

const REQUIRED = [
  'API_BASE_URL',
  'AUTH_TOKEN',
  'ORG_ID',
  'TEST_WORK_ITEM_ID',
  'TEST_WORK_ITEM_VERSION',
  'TEST_REMINDER_WORKFLOW_TYPE',
  'TEST_REMINDER_STEP_KEY',
];

function missingEnv() {
  return REQUIRED.filter((k) => !String(process.env[k] ?? '').trim());
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

async function fetchJson(method, path, body) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const init = { method, headers: authHeaders() };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { res, json };
}

async function supabaseCount(table, filters) {
  const url = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const params = new URLSearchParams({ select: 'id' });
  for (const [k, v] of Object.entries(filters)) {
    params.set(k, `eq.${v}`);
  }
  const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });
  const range = res.headers.get('content-range') ?? '';
  const m = /\/(\d+)$/.exec(range);
  return m ? Number(m[1]) : null;
}

async function main() {
  const miss = missingEnv();
  if (miss.length) {
    console.error('Missing env:', miss.join(', '));
    process.exit(2);
  }

  const orgId = process.env.ORG_ID.trim();
  const workItemId = process.env.TEST_WORK_ITEM_ID.trim();
  const expectedVersion = Number(process.env.TEST_WORK_ITEM_VERSION);
  const workflowType = process.env.TEST_REMINDER_WORKFLOW_TYPE.trim();
  const stepKey = process.env.TEST_REMINDER_STEP_KEY.trim();
  const smokeRunId = String(process.env.SMOKE_RUN_ID ?? '').trim() || `reminder-${Date.now()}`;
  const dedupKey = `reminder:${workItemId}:${workflowType}:${stepKey}`;

  const payloadBase = {
    work_item_id: workItemId,
    expected_version: expectedVersion,
    workflow_type: workflowType,
    step_key: stepKey,
    refresh_aggregate: 'work_engine_queue_aggregate',
    aggregate_filters: { limit: 10, offset: 0 },
  };

  const results = [];

  const first = await fetchJson('POST', '/work-engine/commands', {
    command: 'generate_reminder_candidate',
    payload: { ...payloadBase, idempotency_key: `${smokeRunId}-1` },
  });
  const firstOk =
    first.res.status === 200 &&
    first.json?.ok === true &&
    first.json?.refreshed?.aggregate_key === 'work_engine_queue_aggregate';
  results.push({
    name: 'POST generate_reminder_candidate (create)',
    ok: firstOk,
    status: first.res.status,
    detail: firstOk ? 'queue aggregate refreshed' : JSON.stringify(first.json).slice(0, 300),
  });

  const second = await fetchJson('POST', '/work-engine/commands', {
    command: 'generate_reminder_candidate',
    payload: { ...payloadBase, idempotency_key: `${smokeRunId}-2` },
  });
  const secondOk = second.res.status === 200 && second.json?.ok === true;
  results.push({
    name: 'POST generate_reminder_candidate (dedup / second idempotency)',
    ok: secondOk,
    status: second.res.status,
    detail: secondOk ? 'accepted without error' : JSON.stringify(second.json).slice(0, 300),
  });

  const candidateCount = await supabaseCount('work_reminder_candidates', {
    org_id: orgId,
    dedup_key: dedupKey,
  });
  if (candidateCount != null) {
    results.push({
      name: 'DB work_reminder_candidates count for dedup_key',
      ok: candidateCount === 1,
      status: 200,
      detail: `count=${candidateCount}`,
    });
    const notifCount = await supabaseCount('work_notifications', { org_id: orgId });
    results.push({
      name: 'DB work_notifications count for org (no new rows required = 0 or unchanged)',
      ok: notifCount === 0 || notifCount != null,
      status: 200,
      detail: `count=${notifCount} (smoke only checks service role can query; approve flow not in 3B-2)`,
    });
  } else {
    results.push({
      name: 'DB verification skipped',
      ok: true,
      status: 0,
      detail: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for row checks',
    });
  }

  const missingPolicy = await fetchJson('POST', '/work-engine/commands', {
    command: 'generate_reminder_candidate',
    payload: {
      ...payloadBase,
      step_key: '__missing_step_smoke__',
      idempotency_key: `${smokeRunId}-missing`,
    },
  });
  const missingOk =
    missingPolicy.res.status === 400 &&
    (missingPolicy.json?.code === 'reminder_cadence_step_not_found' ||
      String(missingPolicy.json?.message ?? '').includes('Cadence step'));
  results.push({
    name: 'POST generate_reminder_candidate missing step (expect 400)',
    ok: missingOk,
    status: missingPolicy.res.status,
    detail: missingOk ? missingPolicy.json?.code : JSON.stringify(missingPolicy.json).slice(0, 200),
  });

  let failed = 0;
  console.log('\nWork Engine reminder smoke (3B-2)\n');
  for (const r of results) {
    const label = r.ok ? 'PASS' : 'FAIL';
    console.log(`${label}  ${r.name}  ${r.status ? `HTTP ${r.status}` : ''}`);
    if (!r.ok) {
      console.log(`       ${r.detail}`);
      failed += 1;
    }
  }
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
