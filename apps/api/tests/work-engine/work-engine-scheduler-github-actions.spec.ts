import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(dir, '../../../../.github/workflows/work-engine-scheduler.yml'), 'utf8');

test('scheduler workflow probes health with limited retries before a single POST', () => {
  assert.match(workflow, /HEALTH_URL: https:\/\/nodexpro\.onrender\.com\/api\/v1\/health/);
  assert.match(workflow, /Probing GET \/api\/v1\/health before scheduler POST/);
  assert.match(workflow, /for attempt in 1 2 3/);
  assert.match(workflow, /curl_timed GET "\$HEALTH_URL" 20/);
  assert.match(workflow, /Scheduler POST was not sent/);
});

test('scheduler POST is once, 360s, and never retried on timeout or uncertain result', () => {
  assert.match(workflow, /curl_timed POST "\$SCHEDULER_URL" 360/);
  assert.match(workflow, /--retry 0/);
  assert.match(workflow, /curl exit 28/);
  assert.match(workflow, /Not retrying — result is uncertain/);
  assert.match(workflow, /Not retrying uncertain result/);
  assert.match(workflow, /Not retrying POST/);
  assert.doesNotMatch(workflow, /invoke_scheduler "retry"/);
  assert.doesNotMatch(workflow, /--max-time 180/);
});

test('scheduler workflow logs HTTP status, connect, TTFB and total duration', () => {
  assert.match(workflow, /time_connect/);
  assert.match(workflow, /time_starttransfer/);
  assert.match(workflow, /time_total/);
  assert.match(workflow, /log_curl_timings "Scheduler POST"/);
  assert.match(workflow, /HTTP status:/);
  assert.match(workflow, /connect time:/);
  assert.match(workflow, /time to first byte:/);
  assert.match(workflow, /total duration:/);
});

test('scheduler workflow does not change Work Engine business logic', () => {
  const scheduler = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine.scheduler.service.ts'),
    'utf8',
  );
  assert.match(scheduler, /export async function runWorkEngineScheduler/);
  assert.doesNotMatch(workflow, /runWorkEngineScheduler/);
  assert.doesNotMatch(workflow, /batch_size":100/);
});
