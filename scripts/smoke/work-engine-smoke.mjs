#!/usr/bin/env node
/**
 * Local-only Work Engine smoke test (Stage 3G + Stage 4B command coverage).
 * NOT product code. Reads secrets from environment only — never logs tokens.
 *
 * Required: API_BASE_URL, AUTH_TOKEN, ORG_ID, CLIENT_ID
 * Optional: TEST_PERIOD_KEY (default smoke:2026-05), TEST_ASSIGNEE_USER_ID,
 *            TEST_REVIEWER_USER_ID, SMOKE_RUN_ID (default: timestamp)
 */

const REQUIRED_ENV = ['API_BASE_URL', 'AUTH_TOKEN', 'ORG_ID', 'CLIENT_ID'];
/** Default period_key for create/commands; must match work-engine period_key regex. */
const DEFAULT_COMMAND_PERIOD_KEY = 'smoke:2026-05';
/** Intake dedup tests use a stable mapper-friendly period when TEST_PERIOD_KEY unset. */
const DEFAULT_INTAKE_PERIOD_KEY = 'payroll:2026-05';

function missingEnv() {
  return REQUIRED_ENV.filter((k) => !String(process.env[k] ?? '').trim());
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

function assertQueueRefreshed(json) {
  return (
    json &&
    json.ok === true &&
    json.refreshed &&
    json.refreshed.aggregate_key === 'work_engine_queue_aggregate' &&
    json.refreshed.aggregate &&
    json.refreshed.aggregate.aggregate_key === 'work_engine_queue_aggregate' &&
    Array.isArray(json.refreshed.aggregate.rows)
  );
}

function queueRefreshPayload(periodKey, clientId, extra = {}) {
  return {
    refresh_aggregate: 'work_engine_queue_aggregate',
    aggregate_filters: {
      module_key: 'smoke_test',
      period_key: periodKey,
      client_id: clientId,
      limit: 50,
      offset: 0,
      ...extra,
    },
  };
}

function findSmokeRow(aggregate, clientId, periodKey) {
  const rows = aggregate?.rows ?? [];
  return rows.find(
    (r) =>
      r.module_key === 'smoke_test' &&
      r.work_type === 'smoke_validation' &&
      r.period_key === periodKey &&
      r.client_id === clientId,
  );
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
    console.error(`  export TEST_PERIOD_KEY="${DEFAULT_COMMAND_PERIOD_KEY}"`);
    console.error('  export TEST_ASSIGNEE_USER_ID="<user uuid in org>"');
    console.error('  export TEST_REVIEWER_USER_ID="<user uuid>"');
    console.error('  export SMOKE_RUN_ID="my-local-run-1"');
    console.error('');
    console.error('See docs/work-engine-smoke-test.md');
    console.error('');
    process.exit(2);
  }

  const orgId = process.env.ORG_ID.trim();
  const clientId = process.env.CLIENT_ID.trim();
  const smokeRunId = String(process.env.SMOKE_RUN_ID ?? '').trim() || `run-${Date.now()}`;
  const commandPeriodKey =
    String(process.env.TEST_PERIOD_KEY ?? '').trim() || DEFAULT_COMMAND_PERIOD_KEY;
  const intakePeriodKey =
    String(process.env.TEST_PERIOD_KEY ?? '').trim() || DEFAULT_INTAKE_PERIOD_KEY;
  const optionalAssignee = String(process.env.TEST_ASSIGNEE_USER_ID ?? '').trim() || null;

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
    period_key: intakePeriodKey,
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

  // T6 — queue again (after intake)
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

  const sourceEntityId = `smoke-stage4b-${smokeRunId}`;
  const createPayload = {
    ...queueRefreshPayload(commandPeriodKey, clientId),
    idempotency_key: `${smokeRunId}-create-work-item`,
    client_id: clientId,
    module_key: 'smoke_test',
    work_type: 'smoke_validation',
    period_key: commandPeriodKey,
    source_module: 'smoke_test',
    source_entity_type: 'smoke_validation_entity',
    source_entity_id: sourceEntityId,
    creation_source_type: 'command',
  };

  // T7 — create_work_item + queue refresh
  let workItemId = null;
  let workVersion = 0;
  {
    const body = { command: 'create_work_item', payload: createPayload };
    const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
    const ok = res.status === 200 && assertQueueRefreshed(json);
    const row = ok ? findSmokeRow(json.refreshed.aggregate, clientId, commandPeriodKey) : null;
    if (ok && row) {
      workItemId = row.work_item_id;
      workVersion = row.version;
    }
    results.push({
      name: 'POST /work-engine/commands create_work_item (+ queue refresh)',
      ok: ok && !!workItemId,
      status: res.status,
      detail: ok && workItemId ? `work_item_id=${workItemId} version=${workVersion}` : JSON.stringify(json).slice(0, 280),
    });
  }

  if (!workItemId) {
    results.push({
      name: 'SKIP downstream command tests (create_work_item did not return smoke row)',
      ok: false,
      status: 0,
      detail: 'Fix create_work_item / client / period and re-run',
    });
  } else {
    // T8 — assign_work_item + queue refresh (first assign only; requires TEST_ASSIGNEE_USER_ID)
    if (!optionalAssignee) {
      results.push({
        name: 'SKIP assign_work_item (set TEST_ASSIGNEE_USER_ID for first-assign coverage)',
        ok: true,
        status: 0,
        detail: 'assign_work_item requires a non-null assigned_user_id',
      });
    } else {
      const body = {
        command: 'assign_work_item',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          assigned_user_id: optionalAssignee,
          idempotency_key: `${smokeRunId}-assign-1`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok = res.status === 200 && assertQueueRefreshed(json);
      const row = ok ? findSmokeRow(json.refreshed.aggregate, clientId, commandPeriodKey) : null;
      const vOk = ok && row && row.work_item_id === workItemId && row.version === workVersion + 1;
      if (vOk) workVersion = row.version;
      results.push({
        name: 'POST assign_work_item (TEST_ASSIGNEE_USER_ID) + queue refresh',
        ok: vOk,
        status: res.status,
        detail: vOk
          ? `version=${workVersion} state=${row.work_state}`
          : JSON.stringify(json).slice(0, 280),
      });
    }

    // T9 — change_work_state + queue refresh
    {
      const body = {
        command: 'change_work_state',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          to_state: 'waiting_client',
          reason_text: 'smoke change_state',
          idempotency_key: `${smokeRunId}-change-waiting-client`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok = res.status === 200 && assertQueueRefreshed(json);
      const row = ok ? findSmokeRow(json.refreshed.aggregate, clientId, commandPeriodKey) : null;
      const vOk = ok && row && row.work_item_id === workItemId && row.work_state === 'waiting_client';
      if (vOk) workVersion = row.version;
      results.push({
        name: 'POST change_work_state → waiting_client + queue refresh',
        ok: vOk,
        status: res.status,
        detail: vOk ? `version=${workVersion}` : JSON.stringify(json).slice(0, 280),
      });
    }

    // T9b — illegal transition (should fail, no ok)
    {
      const body = {
        command: 'change_work_state',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          to_state: 'approved',
          reason_text: 'smoke illegal',
          idempotency_key: `${smokeRunId}-change-illegal`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok =
        res.status === 400 &&
        json &&
        json.code === 'invalid_transition' &&
        String(json.message ?? '').toLowerCase().includes('invalid transition');
      results.push({
        name: 'POST change_work_state illegal transition (expect 400)',
        ok,
        status: res.status,
        detail: ok ? 'blocked as expected' : JSON.stringify(json).slice(0, 240),
      });
    }

    // T10 — set_work_deadline + queue refresh
    {
      const dueIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const body = {
        command: 'set_work_deadline',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          due_at: dueIso,
          idempotency_key: `${smokeRunId}-set-deadline`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok = res.status === 200 && assertQueueRefreshed(json);
      const row = ok ? findSmokeRow(json.refreshed.aggregate, clientId, commandPeriodKey) : null;
      const vOk = ok && row && row.work_item_id === workItemId && row.due_at != null;
      if (vOk) workVersion = row.version;
      results.push({
        name: 'POST set_work_deadline + queue refresh',
        ok: vOk,
        status: res.status,
        detail: vOk ? `version=${workVersion}` : JSON.stringify(json).slice(0, 280),
      });
    }

    // T11 — apply_work_override (assignment) must be rejected (command purity)
    {
      const body = {
        command: 'apply_work_override',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          override_kind: 'assignment',
          reason_text: null,
          idempotency_key: `${smokeRunId}-override-assignment`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok =
        res.status === 400 &&
        json &&
        json.code === 'assignment_override_forbidden';
      results.push({
        name: 'POST apply_work_override assignment kind (expect 400 assignment_override_forbidden)',
        ok,
        status: res.status,
        detail: ok ? 'blocked as expected' : JSON.stringify(json).slice(0, 280),
      });
    }

    // T11b — apply_work_override (escalation_cancel) + queue refresh
    {
      const body = {
        command: 'apply_work_override',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: workVersion,
          override_kind: 'escalation_cancel',
          reason_text: 'smoke escalation cancel override',
          idempotency_key: `${smokeRunId}-override-escalation-cancel`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok = res.status === 200 && assertQueueRefreshed(json);
      const row = ok ? findSmokeRow(json.refreshed.aggregate, clientId, commandPeriodKey) : null;
      const vOk = ok && row && row.work_item_id === workItemId && row.override_active === true;
      if (vOk) workVersion = row.version;
      results.push({
        name: 'POST apply_work_override (escalation_cancel) + queue refresh',
        ok: vOk,
        status: res.status,
        detail: vOk ? `version=${workVersion} override_active=true` : JSON.stringify(json).slice(0, 280),
      });
    }

    // T12 — expected_version conflict (stale)
    {
      const body = {
        command: 'set_work_deadline',
        payload: {
          ...queueRefreshPayload(commandPeriodKey, clientId),
          work_item_id: workItemId,
          expected_version: 0,
          due_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          idempotency_key: `${smokeRunId}-deadline-stale`,
        },
      };
      const { res, json } = await fetchJson('POST', '/work-engine/commands', body);
      const ok =
        res.status === 409 &&
        json &&
        json.ok !== true &&
        (json.code === 'version_conflict' || String(json.message ?? '').includes('Version conflict'));
      results.push({
        name: 'POST set_work_deadline stale expected_version (expect 409 version_conflict)',
        ok,
        status: res.status,
        detail: ok ? `code=${json.code}` : JSON.stringify(json).slice(0, 240),
      });
    }
  }

  console.log('');
  console.log('Work Engine smoke test (Stage 3G + 4B)');
  console.log(`API_BASE_URL:     ${baseUrl()}`);
  console.log(`ORG_ID:          ${orgId}`);
  console.log(`CLIENT_ID:       ${clientId}`);
  console.log(`SMOKE_RUN_ID:     ${smokeRunId}`);
  console.log(`command period:  ${commandPeriodKey}`);
  console.log(`intake period:   ${intakePeriodKey}`);
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
