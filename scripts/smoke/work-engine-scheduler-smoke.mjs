#!/usr/bin/env node
/**
 * Work Engine Phase 3D — internal scheduler smoke.
 *
 * Required:
 *   API_BASE_URL
 *   INTERNAL_CRON_SECRET
 *
 * Optional:
 *   SMOKE_DRY_RUN (default true — no SLA/reminder/escalation writes)
 */

const REQUIRED = ['API_BASE_URL', 'INTERNAL_CRON_SECRET'];

function missingEnv() {
  return REQUIRED.filter((k) => !String(process.env[k] ?? '').trim());
}

function baseUrl() {
  return String(process.env.API_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function cronHeaders(secret) {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Cron-Secret': secret,
  };
}

async function fetchJson(method, path, body, headers) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const init = { method, headers };
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
    console.error('Missing env:', miss.join(', '));
    process.exit(2);
  }

  const secret = process.env.INTERNAL_CRON_SECRET.trim();
  const dryRun = String(process.env.SMOKE_DRY_RUN ?? 'true').trim().toLowerCase() !== 'false';
  const results = [];

  const health = await fetchJson('GET', '/health', undefined, { Accept: 'application/json' });
  results.push({
    name: 'GET /health',
    ok: health.res.status === 200 && health.json?.ok === true,
    status: health.res.status,
    detail: health.json?.ok ? 'ok' : JSON.stringify(health.json).slice(0, 200),
  });

  const noSecret = await fetchJson(
    'POST',
    '/work-engine/internal/scheduler/run',
    { dry_run: true },
    { 'Content-Type': 'application/json' },
  );
  const rejectOk = noSecret.res.status === 403 || noSecret.res.status === 401;
  results.push({
    name: 'POST scheduler without secret (expect 403)',
    ok: rejectOk,
    status: noSecret.res.status,
    detail: rejectOk ? 'rejected' : JSON.stringify(noSecret.json).slice(0, 200),
  });

  const withSecret = await fetchJson(
    'POST',
    '/work-engine/internal/scheduler/run',
    { dry_run: dryRun, batch_size: 10, max_work_items_per_run: 10 },
    cronHeaders(secret),
  );
  const acceptOk =
    withSecret.res.status === 200 &&
    withSecret.json?.ok === true &&
    typeof withSecret.json?.scanned_work_items === 'number' &&
    typeof withSecret.json?.recomputed_sla === 'number' &&
    typeof withSecret.json?.reminders_created === 'number' &&
    typeof withSecret.json?.escalations_created === 'number' &&
    typeof withSecret.json?.snoozed_woken === 'number' &&
    Array.isArray(withSecret.json?.errors);
  results.push({
    name: 'POST scheduler with secret (summary shape)',
    ok: acceptOk,
    status: withSecret.res.status,
    detail: acceptOk
      ? `dry_run=${dryRun} scanned=${withSecret.json.scanned_work_items}`
      : JSON.stringify(withSecret.json).slice(0, 300),
  });

  if (acceptOk && dryRun) {
    results.push({
      name: 'dry_run did not require reminder sends',
      ok: withSecret.json.reminders_created === 0 && withSecret.json.escalations_created === 0,
      status: withSecret.res.status,
      detail: `reminders=${withSecret.json.reminders_created} escalations=${withSecret.json.escalations_created}`,
    });
  }

  let failed = 0;
  console.log('\nWork Engine scheduler smoke (3D)\n');
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
