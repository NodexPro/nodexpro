/**
 * P11.5 — Observability closure tests (correlation, command lifecycle, slow aggregate, health).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CRITICAL_INCOME_COMMANDS,
  emitSlowAggregateWarning,
  extractSafeErrorMessage,
  resolveCorrelationId,
  slowAggregateThresholdMs,
  withCriticalCommandObs,
} from '../../src/shared/observability.js';

const dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(dir, '../../src/index.ts'), 'utf8');
const correlationSource = readFileSync(join(dir, '../../src/middleware/correlation.ts'), 'utf8');
const incomeRoutesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const schedulerSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.scheduler.service.ts'),
  'utf8',
);
const failedOpsPure = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-failed-operations.pure.ts'),
  'utf8',
);

test('P11.5 correlation middleware is mounted early and error responses include correlation_id', () => {
  assert.match(indexSource, /correlationMiddleware/);
  assert.match(indexSource, /correlation_id/);
  assert.match(correlationSource, /CORRELATION_HEADER/);
  assert.match(correlationSource, /resolveCorrelationId/);
  assert.match(
    readFileSync(join(dir, '../../src/shared/observability.ts'), 'utf8'),
    /x-correlation-id/,
  );
});

test('P11.5 resolveCorrelationId reuses valid UUID and otherwise generates', () => {
  const fixed = '11111111-1111-4111-8111-111111111111';
  assert.equal(resolveCorrelationId(fixed), fixed);
  assert.notEqual(resolveCorrelationId('not-a-uuid'), 'not-a-uuid');
  assert.match(resolveCorrelationId(null), /^[0-9a-f-]{36}$/i);
});

test('P11.5 critical income commands are observed at route layer', () => {
  assert.ok(CRITICAL_INCOME_COMMANDS.has('issue_income_document'));
  assert.ok(CRITICAL_INCOME_COMMANDS.has('record_income_document_payment'));
  assert.ok(CRITICAL_INCOME_COMMANDS.has('send_income_document_by_email'));
  assert.match(incomeRoutesSource, /withCriticalCommandObs/);
  assert.match(incomeRoutesSource, /CRITICAL_INCOME_COMMANDS/);
});

test('P11.5 withCriticalCommandObs logs success duration and failure safe_error', async () => {
  const lines: Array<{ level: string; prefix: string; payload: Record<string, unknown> }> = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = ((prefix: string, payload: Record<string, unknown>) => {
    lines.push({ level: 'info', prefix, payload });
  }) as typeof console.info;
  console.error = ((prefix: string, payload: Record<string, unknown>) => {
    lines.push({ level: 'error', prefix, payload });
  }) as typeof console.error;
  try {
    await withCriticalCommandObs(
      {
        enabled: true,
        correlation_id: '22222222-2222-4222-8222-222222222222',
        module: 'income',
        command: 'save_income_document_draft',
        organization_id: '33333333-3333-4333-8333-333333333333',
        draft_id: '44444444-4444-4444-8444-444444444444',
      },
      async () => ({ ok: true }),
    );
    assert.ok(lines.some((l) => l.prefix === '[command_received]'));
    assert.ok(lines.some((l) => l.prefix === '[command_completed]'));
    const completed = lines.find((l) => l.prefix === '[command_completed]');
    assert.equal(typeof completed?.payload.duration_ms, 'number');
    assert.doesNotMatch(JSON.stringify(completed?.payload), /password|secret|Bearer/i);

    lines.length = 0;
    await assert.rejects(() =>
      withCriticalCommandObs(
        {
          enabled: true,
          correlation_id: '22222222-2222-4222-8222-222222222222',
          module: 'income',
          command: 'issue_income_document',
          organization_id: '33333333-3333-4333-8333-333333333333',
        },
        async () => {
          throw new Error('boom-db');
        },
      ),
    );
    const failed = lines.find((l) => l.prefix === '[command_failed]');
    assert.ok(failed);
    assert.equal(failed?.payload.safe_error, 'boom-db');
    assert.equal(failed?.payload.correlation_id, '22222222-2222-4222-8222-222222222222');
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test('P11.5 issue diagnostics reuse request correlation_id', () => {
  assert.match(issueSource, /correlation_id: ctx\.correlationId/);
});

test('P11.5 slow aggregate warns over threshold and stays silent when fast', () => {
  const lines: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = ((prefix: string, payload: unknown) => {
    lines.push({ prefix, payload });
  }) as typeof console.warn;
  try {
    const threshold = slowAggregateThresholdMs();
    emitSlowAggregateWarning({
      aggregate_key: 'work_engine_invoices_tab_aggregate',
      correlation_id: '55555555-5555-4555-8555-555555555555',
      organization_id: '66666666-6666-4666-8666-666666666666',
      duration_ms: threshold - 1,
      payload_bytes: 100,
    });
    assert.equal(lines.length, 0);

    emitSlowAggregateWarning({
      aggregate_key: 'work_engine_invoices_tab_aggregate',
      correlation_id: '55555555-5555-4555-8555-555555555555',
      organization_id: '66666666-6666-4666-8666-666666666666',
      duration_ms: threshold + 50,
      payload_bytes: 2048,
    });
    assert.equal(lines.length, 1);
    assert.equal((lines[0] as { prefix: string }).prefix, '[slow-aggregate]');
  } finally {
    console.warn = originalWarn;
  }
});

test('P11.5 health returns deploy_marker and db probe', () => {
  assert.match(indexSource, /deploy_marker: resolveApiDeployMarker\(\)/);
  assert.match(indexSource, /db/);
  assert.match(indexSource, /unavailable/);
});

test('P11.5 scheduler summary exposes run_id correlation and timestamps', () => {
  assert.match(schedulerSource, /correlation_id/);
  assert.match(schedulerSource, /started_at/);
  assert.match(schedulerSource, /completed_at/);
  assert.match(schedulerSource, /\[scheduler\]\[result\]/);
});

test('P11.5 failed operations notes payment gap and includes PDF/delivery/AB/retainer', () => {
  assert.match(failedOpsPure, /income_pdf_render_failed/);
  assert.match(failedOpsPure, /delivery_attempts_failed/);
  assert.match(failedOpsPure, /accounting_posting_failed/);
  assert.match(failedOpsPure, /retainer_generation_failed/);
  assert.match(failedOpsPure, /Payment match failures: not included yet/);
});

test('P11.5 extractSafeErrorMessage never invents secrets', () => {
  assert.equal(extractSafeErrorMessage(new Error('x')), 'x');
  assert.equal(extractSafeErrorMessage('y'), 'y');
});
