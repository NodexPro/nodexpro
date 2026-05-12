#!/usr/bin/env node
/**
 * Local-only Work Engine smoke test (Stage 3G).
 * NOT product code. Reads secrets from environment only — never logs tokens.
 *
 * Required: API_BASE_URL, AUTH_TOKEN, ORG_ID, CLIENT_ID
 * Optional: TEST_PERIOD_KEY (default payroll:2026-05)
 */

const REQUIRED_ENV = ['API_BASE_URL', 'AUTH_TOKEN', 'ORG_ID', 'CLIENT_ID'];
const DEFAULT_PERIOD_KEY = 'payroll:2026-05';

function missingEnv() {
  const missing = REQUIRED_ENV.filter((k) => !String(process.env[k] ?? '').trim());
  return missing;
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
  const init = {
    method,
    headers: authHeaders(),
  };
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

async function main() {
  const miss = missingEnv();
  if (miss.length) {
    console.error('');
    console.error('Work Engine smoke test — missing required environment variables:');
    for (const k of miss) console.error(`  - ${k}`);
    console.error('');
    console.error('Set them in your shell or a local .env file (never commit .env):');
    console.error('  export API_BASE_URL=https://your-host.com/api/v1');
    console.error('  export AUTH_TOKEN="<Supabase access token>"');
    console.error('  export ORG_ID="<organization uuid>"');
    console.error('  export CLIENT_ID="<client uuid in that org>"');
    console.error('  # optional:');
    console.error(`  export TEST_PERIOD_KEY="${DEFAULT_PERIOD_KEY}"`);
    console.error('');
    console.error('See docs/work-engine-smoke-test.md');
    console.error('');
    process.exit(2);
  }

  const orgId = process.env.ORG_ID.trim();
  const clientId = process.env.CLIENT_ID.trim();
  const periodKey = String(process.env.TEST_PERIOD_KEY ?? '').trim() || DEFAULT_PERIOD_KEY;

  const results = [];

  // T1 — health
  {
    const { res, json } = await fetchJson('GET', '/health');
    const ok = res.status === 200 && json && json.ok === true;
    results.push({ name: 'GET /health', ok, status: res.status, detail: ok ? 'ok:true' : JSON.stringify(json).slice(0, 200) });
  }

  // T2 — foundation aggregate
  {
    const { res, json } = await fetchJson('GET', '/work-engine/aggregates/foundation');
    const ok =
      res.status === 200 &&
      json &&
      json.aggregate_key === 'work_engine_foundation_aggregate' &&
      typeof json.org_id === 'string';
    if (ok && json.org_id !== orgId) {
      throw new Error(`foundation aggregate org_id mismatch (expected ${orgId})`);
    }
    results.push({
      name: 'GET /work-engine/aggregates/foundation',
      ok,
      status: res.status,
      detail: ok ? `aggregate_key=${json.aggregate_key}` : JSON.stringify(json).slice(0, 240),
    });
  }

  // T3 — queue aggregate
  {
    const { res, json } = await fetchJson('GET', '/work-engine/aggregates/queue');
    const ok =
      res.status === 200 &&
      json &&
      json.aggregate_key === 'work_engine_queue_aggregate' &&
      json.summary_cards &&
      Array.isArray(json.rows) &&
      json.filters &&
      json.pending_mapping_section;
    results.push({
      name: 'GET /work-engine/aggregates/queue',
      ok,
      status: res.status,
      detail: ok ? 'shape ok' : JSON.stringify(json).slice(0, 240),
    });
  }

  const intakePayload = {
    client_id: clientId,
    source_module: 'smoke_test',
    source_entity_type: 'smoke_test_entity',
    source_entity_id: 'smoke-test-client-period',
    event_type: 'payroll.documents_missing',
    period_key: periodKey,
    occurred_at: new Date().toISOString(),
    schema_version: 1,
    emitted_by_type: 'system',
    emitted_by_id: null,
    payload: { smoke: true },
  };

  // T4 — first intake
  let firstMeta = null;
  {
    const body = { command: 'intake_work_event', payload: intakePayload };
    const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
    firstMeta = json?.meta ?? null;
    const ok =
      res.status === 200 &&
      json &&
      json.ok === true &&
      firstMeta &&
      ['created', 'reused_existing', 'duplicate_event', 'pending_mapping'].includes(
        firstMeta.intake_result,
      );
    results.push({
      name: 'POST /work-engine/commands intake_work_event (1st)',
      ok,
      status: res.status,
      detail: ok ? `intake_result=${firstMeta.intake_result}` : JSON.stringify(json).slice(0, 280),
    });
  }

  // T5 — repeat intake (dedup)
  {
    const body = { command: 'intake_work_event', payload: intakePayload };
    const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
    const meta = json?.meta ?? null;
    const ok =
      res.status === 200 &&
      json?.ok === true &&
      meta?.intake_result === 'duplicate_event';
    results.push({
      name: 'POST /work-engine/commands intake_work_event (2nd dedup)',
      ok,
      status: res.status,
      detail: ok ? 'intake_result=duplicate_event' : JSON.stringify(json).slice(0, 280),
    });
  }

  // T6 — queue again
  {
    const { res, json } = await fetchJson('GET', '/work-engine/aggregates/queue');
    const ok =
      res.status === 200 &&
      json &&
      json.aggregate_key === 'work_engine_queue_aggregate' &&
      Array.isArray(json.rows);
    results.push({
      name: 'GET /work-engine/aggregates/queue (after intake)',
      ok,
      status: res.status,
      detail: ok ? 'shape ok' : JSON.stringify(json).slice(0, 240),
    });
  }

  console.log('');
  console.log('Work Engine smoke test');
  console.log(`API_BASE_URL: ${baseUrl()}`);
  console.log(`ORG_ID:       ${orgId}`);
  console.log(`CLIENT_ID:    ${clientId}`);
  console.log(`period_key:   ${periodKey}`);
  console.log('(AUTH_TOKEN is set — value not printed)');
  console.log('');

  let failed = 0;
  for (const r of results) {
    const label = r.ok ? 'PASS' : 'FAIL';
    console.log(`${label}  ${r.name}  HTTP ${r.status}`);
    if (!r.ok) {
      console.log(`       ${r.detail}`);
      failed += 1;
    }
  }
  console.log('');

  if (failed) {
    console.log(`Summary: ${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('Summary: all checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('');
  console.error('FAIL  unexpected error:', e.message);
  process.exit(1);
});
