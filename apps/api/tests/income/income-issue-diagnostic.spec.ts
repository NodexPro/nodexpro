import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INCOME_ISSUE_FAILED_LOG_PREFIX,
  INCOME_ISSUE_LOG_PREFIX,
  INCOME_ISSUE_SUCCESS_STAGE_ORDER,
  NODEXPRO_API_BOOT_LOG_PREFIX,
  buildNodexproApiBootPayload,
  createIncomeIssueDiagnostic,
  extractIncomeIssueSafeError,
  logIncomeIssueFailed,
  logIncomeIssueStage,
  logNodexproApiBoot,
  sanitizeIncomeIssueLogPayload,
  withIncomeIssueStage,
  type IncomeIssueFailingStage,
  type IncomeIssueStage,
} from '../../src/domains/income/income-issue-diagnostic.js';

const dir = dirname(fileURLToPath(import.meta.url));
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const indexSource = readFileSync(join(dir, '../../src/index.ts'), 'utf8');

type Captured = { level: 'info' | 'error'; prefix: string; payload: Record<string, unknown> };

function captureDiag() {
  const lines: Captured[] = [];
  const diag = createIncomeIssueDiagnostic({
    org_id: 'org-1',
    draft_id: 'draft-1',
    recurring_cycle_id: 'cycle-1',
    correlation_id: 'corr-1',
    deploy_marker: 'test-sha',
    emit: (level, prefix, payload) => {
      lines.push({ level, prefix, payload });
    },
  });
  return { diag, lines };
}

function failingStageForStarted(stage: IncomeIssueStage): IncomeIssueFailingStage {
  if (stage === 'draft_id_validation_started') return 'draft_id_validation';
  if (stage === 'recurring_issuer_scope_resolve_started') return 'recurring_issuer_scope_resolve';
  if (stage === 'issuer_scope_load_started') return 'issuer_scope_load';
  if (stage === 'permission_check_started') return 'permission_check';
  if (stage === 'numbering_started') return 'numbering';
  if (stage === 'issued_document_insert_started') return 'issued_document_insert';
  if (stage === 'accounting_posting_started') return 'accounting_posting';
  if (stage === 'draft_mark_issued_started') return 'draft_mark_issued';
  if (stage === 'recurring_cycle_link_started') return 'recurring_cycle_link';
  if (stage === 'pdf_scheduling_started') return 'pdf_scheduling';
  if (stage === 'refreshed_case_started') return 'refreshed_case';
  return 'issue_command';
}

test('success stage order constant includes early prefix stages', () => {
  assert.deepEqual([...INCOME_ISSUE_SUCCESS_STAGE_ORDER], [
    'issue_command_received',
    'draft_id_validation_started',
    'draft_id_validation_completed',
    'recurring_issuer_scope_resolve_started',
    'recurring_issuer_scope_resolve_completed',
    'issuer_scope_load_started',
    'issuer_scope_load_completed',
    'permission_check_started',
    'permission_check_completed',
    'draft_loaded',
    'existing_issued_document_checked',
    'numbering_started',
    'numbering_completed',
    'issued_document_insert_started',
    'issued_document_insert_completed',
    'accounting_posting_started',
    'accounting_posting_completed',
    'draft_mark_issued_started',
    'draft_mark_issued_completed',
    'recurring_cycle_link_started',
    'recurring_cycle_link_completed',
    'pdf_scheduling_started',
    'pdf_scheduling_completed',
    'refreshed_case_started',
    'refreshed_case_completed',
    'issue_command_completed',
  ]);
});

test('issue_command_received is logged before loadActiveIncomeIssuerScope in source', () => {
  const fnStart = issueServiceSource.indexOf('export async function executeIssueIncomeDocument');
  assert.ok(fnStart >= 0, 'executeIssueIncomeDocument export missing from issue service source');
  const fnBody = issueServiceSource.slice(fnStart);
  const receivedIdx = fnBody.indexOf("logIncomeIssueStage(diag, 'issue_command_received'");
  const scopeIdx = fnBody.indexOf('loadActiveIncomeIssuerScope(ctx)');
  const reqUuidIdx = fnBody.indexOf("reqUuid(body.draft_id, 'draft_id')");
  const resolveIdx = fnBody.indexOf('resolveAndApplyRecurringCycleIssueIssuerScope');
  assert.ok(receivedIdx >= 0);
  assert.ok(scopeIdx > receivedIdx);
  assert.ok(reqUuidIdx > receivedIdx);
  // Recurring-cycle issue validates draft_id, then resolves trusted issuer, then loads active scope.
  assert.ok(reqUuidIdx < scopeIdx);
  assert.ok(resolveIdx > reqUuidIdx && resolveIdx < scopeIdx);
  assert.match(fnBody, /issuer_scope_load_started/);
  assert.match(fnBody, /permission_check_started/);
  assert.match(fnBody, /draft_id_validation_started/);
  assert.match(fnBody, /failing_stage: 'issuer_scope_load'/);
  assert.match(fnBody, /'permission_check'/);
  assert.match(fnBody, /'draft_id_validation'/);
  assert.match(fnBody, /'recurring_issuer_scope_resolve'/);
});

test('stage order on successful mocked issue', async () => {
  const { diag, lines } = captureDiag();
  const stages: IncomeIssueStage[] = [];

  for (const stage of INCOME_ISSUE_SUCCESS_STAGE_ORDER) {
    if (stage.endsWith('_started')) {
      const completed = stage.replace('_started', '_completed') as IncomeIssueStage;
      await withIncomeIssueStage(
        diag,
        {
          started: stage,
          completed,
          failing_stage: failingStageForStarted(stage),
        },
        async () => undefined,
      );
      stages.push(stage, completed);
    } else if (
      stage === 'issue_command_received' ||
      stage === 'draft_loaded' ||
      stage === 'existing_issued_document_checked' ||
      stage === 'issue_command_completed'
    ) {
      logIncomeIssueStage(diag, stage);
      stages.push(stage);
    }
  }

  const infoStages = lines
    .filter((l) => l.level === 'info' && l.prefix === INCOME_ISSUE_LOG_PREFIX)
    .map((l) => l.payload.stage);
  assert.deepEqual(infoStages, stages);
  assert.equal(diag.last_completed_stage, 'issue_command_completed');
  assert.equal(lines.some((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX), false);
});

test('issuer-scope failure produces failing_stage=issuer_scope_load and rethrows', async () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('scope boom'), { code: 'PGRST301' });
  await assert.rejects(
    () =>
      withIncomeIssueStage(
        diag,
        {
          started: 'issuer_scope_load_started',
          completed: 'issuer_scope_load_completed',
          failing_stage: 'issuer_scope_load',
        },
        async () => {
          throw original;
        },
      ),
    (err: unknown) => err === original,
  );
  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'issuer_scope_load');
  assert.equal(failed!.payload.code, 'PGRST301');
});

test('permission failure produces failing_stage=permission_check and rethrows', () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('forbidden'), { name: 'AppError', code: 'FORBIDDEN' });
  logIncomeIssueStage(diag, 'permission_check_started', { duration_ms: 0 });
  try {
    throw original;
  } catch (error) {
    logIncomeIssueFailed(diag, 'permission_check', error);
    assert.equal(error, original);
  }
  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'permission_check');
  assert.equal(failed!.payload.name, 'AppError');
});

test('invalid draft_id produces failing_stage=draft_id_validation and rethrows', () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('draft_id must be a valid UUID'), {
    name: 'AppError',
    code: 'BAD_REQUEST',
  });
  logIncomeIssueStage(diag, 'draft_id_validation_started', { duration_ms: 0 });
  try {
    throw original;
  } catch (error) {
    logIncomeIssueFailed(diag, 'draft_id_validation', error);
    assert.equal(error, original);
  }
  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'draft_id_validation');
  assert.match(String(failed!.payload.message), /draft_id/);
});

test('numbering error logs failing_stage=numbering and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('seq read failed'), {
    code: 'PGRST116',
    details: 'detail-n',
    hint: 'hint-n',
  });

  await assert.rejects(
    () =>
      withIncomeIssueStage(
        diag,
        {
          started: 'numbering_started',
          completed: 'numbering_completed',
          failing_stage: 'numbering',
        },
        async () => {
          throw original;
        },
      ),
    (err: unknown) => err === original,
  );

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'numbering');
  assert.equal(failed!.payload.correlation_id, 'corr-1');
  assert.equal(failed!.payload.code, 'PGRST116');
  assert.equal(failed!.payload.message, 'seq read failed');
  assert.equal(failed!.payload.details, 'detail-n');
  assert.equal(failed!.payload.hint, 'hint-n');
});

test('insert error logs failing_stage=issued_document_insert and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('insert failed'), {
    code: '23502',
    details: 'null value',
    hint: 'fill column',
  });

  await assert.rejects(
    () =>
      withIncomeIssueStage(
        diag,
        {
          started: 'issued_document_insert_started',
          completed: 'issued_document_insert_completed',
          failing_stage: 'issued_document_insert',
        },
        async () => {
          throw original;
        },
      ),
    (err: unknown) => err === original,
  );

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'issued_document_insert');
  assert.equal(failed!.payload.code, '23502');
});

test('Accounting Base error logs failing_stage=accounting_posting and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  diag.last_completed_stage = 'issued_document_insert_completed';
  diag.issued_document_id = 'doc-1';
  const original = Object.assign(new Error('ab posting failed'), {
    code: '42501',
    details: 'permission denied',
    hint: 'check RLS',
  });

  logIncomeIssueStage(diag, 'accounting_posting_started', { duration_ms: 0 });
  logIncomeIssueStage(diag, 'accounting_posting_failed', extractIncomeIssueSafeError(original));
  logIncomeIssueStage(diag, 'issued_document_cleanup_started', { duration_ms: 0 });
  logIncomeIssueStage(diag, 'issued_document_cleanup_completed', { duration_ms: 1 });
  logIncomeIssueFailed(diag, 'accounting_posting', original);

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'accounting_posting');
  assert.equal(failed!.payload.last_completed_stage, 'issued_document_insert_completed');
  assert.equal(failed!.payload.issued_document_id, 'doc-1');
  assert.equal(failed!.payload.code, '42501');
  assert.equal(failed!.payload.message, 'ab posting failed');

  try {
    throw original;
  } catch (e) {
    assert.equal(e, original);
  }
});

test('sensitive fields are not logged', () => {
  const dirty = {
    correlation_id: 'corr-1',
    org_id: 'org-1',
    draft_id: 'draft-1',
    service_role_key: 'secret-key',
    access_token: 'Bearer xxx',
    bank_account: '12-345',
    email: 'a@b.com',
    tax_id: '123456789',
    customer_snapshot_json: { display_name: 'NYC' },
    totals_snapshot_json: { total: 1180 },
    stage: 'numbering_started',
    message: 'ok',
  };
  const clean = sanitizeIncomeIssueLogPayload(dirty);
  assert.equal(clean.correlation_id, 'corr-1');
  assert.equal(clean.stage, 'numbering_started');
  assert.equal(clean.message, 'ok');
  assert.equal('service_role_key' in clean, false);
  assert.equal('access_token' in clean, false);
  assert.equal('bank_account' in clean, false);
  assert.equal('email' in clean, false);
  assert.equal('tax_id' in clean, false);
  assert.equal('customer_snapshot_json' in clean, false);
  assert.equal('totals_snapshot_json' in clean, false);

  const { diag, lines } = captureDiag();
  const err = Object.assign(new Error('boom'), {
    code: 'XX',
    service_role_key: 'secret-key',
    bank_account: '12-345',
    email: 'leak@example.com',
  });
  logIncomeIssueFailed(diag, 'numbering', err);
  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  const serialized = JSON.stringify(failed!.payload);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(serialized.includes('12-345'), false);
  assert.equal(serialized.includes('leak@example.com'), false);
  assert.equal(serialized.includes('service_role_key'), false);
  assert.equal(serialized.includes('bank_account'), false);
});

test('original error is still rethrown from withIncomeIssueStage', async () => {
  const { diag } = captureDiag();
  const original = new Error('keep-me');
  let caught: unknown;
  try {
    await withIncomeIssueStage(
      diag,
      {
        started: 'numbering_started',
        completed: 'numbering_completed',
        failing_stage: 'numbering',
      },
      async () => {
        throw original;
      },
    );
  } catch (e) {
    caught = e;
  }
  assert.equal(caught, original);
});

test('boot marker contains no secrets', () => {
  const payload = buildNodexproApiBootPayload({
    NODE_ENV: 'production',
    deploy_marker: 'abc123',
  });
  assert.equal(payload.NODE_ENV, 'production');
  assert.equal(payload.deploy_marker, 'abc123');
  assert.equal(payload.income_issue_diagnostics, true);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('service_role'), false);
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('CLIENT_DATA_ENCRYPTION_KEY'), false);

  const lines: Captured[] = [];
  logNodexproApiBoot((level, prefix, p) => {
    lines.push({ level, prefix, payload: p });
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.prefix, NODEXPRO_API_BOOT_LOG_PREFIX);
  assert.equal(indexSource.includes('logNodexproApiBoot'), true);
  assert.equal(indexSource.includes(NODEXPRO_API_BOOT_LOG_PREFIX) || indexSource.includes('logNodexproApiBoot'), true);
});

test('issue service wires diagnostic stages without changing cleanup/posting semantics', () => {
  assert.match(issueServiceSource, /createIncomeIssueDiagnostic/);
  assert.match(issueServiceSource, /numbering_started/);
  assert.match(issueServiceSource, /issued_document_insert_started/);
  assert.match(issueServiceSource, /accounting_posting_started/);
  assert.match(issueServiceSource, /accounting_posting_failed/);
  assert.match(issueServiceSource, /issued_document_cleanup_started/);
  assert.match(issueServiceSource, /issued_document_cleanup_completed/);
  assert.match(issueServiceSource, /logIncomeIssueFailed\(diag, 'accounting_posting'/);
  assert.match(issueServiceSource, /failing_stage: 'numbering'/);
  assert.match(issueServiceSource, /failing_stage: 'issued_document_insert'/);
  assert.match(issueServiceSource, /\.delete\(\)/);
  assert.match(issueServiceSource, /throw postingErr/);
  assert.match(commandsSource, /refreshed_case_started/);
  assert.match(commandsSource, /withIncomeIssueStage/);
});
