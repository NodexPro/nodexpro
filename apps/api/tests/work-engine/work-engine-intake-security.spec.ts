import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertIncomeDocumentIntakeOwnership,
  type IncomeDocumentIntakeOwnershipContext,
} from '../../src/domains/work-engine/work-engine-income-intake.guards.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.commands.service.ts'),
  'utf8',
);
const intakeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-intake.service.ts'),
  'utf8',
);

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherClientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherOrgId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function baseCtx(
  overrides: Partial<IncomeDocumentIntakeOwnershipContext> = {},
): IncomeDocumentIntakeOwnershipContext {
  return {
    org_id: orgId,
    client_id: clientId,
    source_module: 'income',
    source_entity_type: 'income_document',
    source_entity_id: docId,
    event_type: 'income.invoice_overdue',
    ...overrides,
  };
}

test('rejects intake without permission', () => {
  assert.match(
    commandsSource,
    /case 'intake_work_event':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('intakeWorkEvent validates income document source_entity before processing', () => {
  assert.match(intakeSource, /assertIncomeDocumentIntakeSourceEntity/);
});

test('rejects fake invoice UUID (not found)', () => {
  assert.throws(
    () => assertIncomeDocumentIntakeOwnership(null, baseCtx()),
    (err: { code?: string }) => err.code === 'income_document_not_found',
  );
});

test('rejects invoice from another org', () => {
  assert.throws(
    () =>
      assertIncomeDocumentIntakeOwnership(
        {
          organization_id: otherOrgId,
          represented_client_id: clientId,
          document_status: 'issued',
        },
        baseCtx(),
      ),
    (err: { code?: string }) => err.code === 'income_document_org_mismatch',
  );
});

test('rejects invoice from another client', () => {
  assert.throws(
    () =>
      assertIncomeDocumentIntakeOwnership(
        {
          organization_id: orgId,
          represented_client_id: otherClientId,
          document_status: 'issued',
        },
        baseCtx(),
      ),
    (err: { code?: string }) => err.code === 'income_document_client_mismatch',
  );
});

test('accepts valid issued invoice overdue event ownership', () => {
  assert.doesNotThrow(() =>
    assertIncomeDocumentIntakeOwnership(
      {
        organization_id: orgId,
        represented_client_id: clientId,
        document_status: 'issued',
      },
      baseCtx(),
    ),
  );
});

test('rejects non-issued document for overdue event', () => {
  assert.throws(
    () =>
      assertIncomeDocumentIntakeOwnership(
        {
          organization_id: orgId,
          represented_client_id: clientId,
          document_status: 'cancelled_future',
        },
        baseCtx(),
      ),
    (err: { code?: string }) => err.code === 'income_document_not_issued',
  );
});

test('skips validation for non-income modules', () => {
  assert.doesNotThrow(() =>
    assertIncomeDocumentIntakeOwnership(null, baseCtx({ source_module: 'docflow' })),
  );
});

test('rejects malformed source_entity_id', () => {
  assert.throws(
    () =>
      assertIncomeDocumentIntakeOwnership(null, baseCtx({ source_entity_id: 'not-a-uuid' })),
    (err: { code?: string }) => err.code === 'income_document_invalid_id',
  );
});

test('rejects random uuid that does not resolve to a document row', () => {
  const fakeId = randomUUID();
  assert.throws(
    () => assertIncomeDocumentIntakeOwnership(null, baseCtx({ source_entity_id: fakeId })),
    (err: { code?: string }) => err.code === 'income_document_not_found',
  );
});
