import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcknowledgeEscalation,
  canEscalateWorkItem,
  canManualEscalateWorkState,
  canReassignEscalationOwner,
  canResolveEscalation,
  escalationSourceLabel,
  isOrgManagerRole,
  parseEscalationReason,
  parseEscalationSource,
} from '../../src/domains/work-engine/work-engine.escalation.logic.js';
import type { WorkItemRow } from '../../src/domains/work-engine/work-engine.types.js';

function baseRow(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    org_id: '22222222-2222-4222-8222-222222222222',
    client_id: '33333333-3333-4333-8333-333333333333',
    module_key: 'payroll',
    work_type: 'payroll_document_collection',
    period_key: 'payroll:2026-05',
    work_state: 'waiting_client',
    owner_user_id: null,
    assigned_user_id: '44444444-4444-4444-8444-444444444444',
    reviewer_user_id: null,
    escalation_owner_id: null,
    escalation_reason: null,
    escalation_source: null,
    escalation_prior_work_state: null,
    escalation_acknowledged_at: null,
    escalation_acknowledged_by_user_id: null,
    due_at: null,
    sla_status: 'on_track',
    source_module: 'test',
    source_entity_type: 'test',
    source_entity_id: 'ent-1',
    created_by_rule_id: null,
    created_by_event_id: null,
    created_by_user_id: null,
    creation_source_type: 'command',
    version: 1,
    override_active: false,
    override_summary_json: null,
    claimed_by_user_id: null,
    claimed_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

test('parseEscalationSource accepts allowlisted values', () => {
  assert.equal(parseEscalationSource('manual_escalation'), 'manual_escalation');
  assert.throws(
    () => parseEscalationSource('unknown'),
    (e: Error & { code?: string }) => e.code === 'invalid_escalation_source',
  );
});

test('parseEscalationReason requires non-empty text', () => {
  assert.equal(parseEscalationReason('SLA breached twice'), 'SLA breached twice');
  assert.throws(
    () => parseEscalationReason('  '),
    (e: Error & { code?: string }) => e.code === 'escalation_reason_required',
  );
});

test('isOrgManagerRole recognizes owner and admin', () => {
  assert.equal(isOrgManagerRole('owner'), true);
  assert.equal(isOrgManagerRole('admin'), true);
  assert.equal(isOrgManagerRole('staff'), false);
});

test('canEscalateWorkItem allows managers from waiting_client', () => {
  const row = baseRow();
  const ctx = { userId: 'u1', roleCode: 'admin', permissions: [] as string[] };
  assert.equal(canEscalateWorkItem(ctx, row, false), true);
  assert.equal(canManualEscalateWorkState('waiting_client'), true);
  assert.equal(canManualEscalateWorkState('done'), false);
});

test('canAcknowledgeEscalation allows escalation owner', () => {
  const ownerId = '55555555-5555-4555-8555-555555555555';
  const row = baseRow({
    work_state: 'escalated',
    escalation_owner_id: ownerId,
    escalation_acknowledged_at: null,
  });
  const ownerCtx = { userId: ownerId, roleCode: 'staff', permissions: [] as string[] };
  const otherCtx = { userId: '99999999-9999-4999-8999-999999999999', roleCode: 'staff', permissions: [] };
  assert.equal(canAcknowledgeEscalation(ownerCtx, row), true);
  assert.equal(canAcknowledgeEscalation(otherCtx, row), false);
});

test('canResolveEscalation allows manager and escalation owner', () => {
  const ownerId = '55555555-5555-4555-8555-555555555555';
  const row = baseRow({ work_state: 'escalated', escalation_owner_id: ownerId });
  assert.equal(
    canResolveEscalation({ userId: ownerId, roleCode: 'staff', permissions: [] }, row),
    true,
  );
  assert.equal(
    canResolveEscalation({ userId: 'x', roleCode: 'admin', permissions: [] }, row),
    true,
  );
});

test('canReassignEscalationOwner is manager-only', () => {
  const row = baseRow({ work_state: 'escalated', escalation_owner_id: 'o1' });
  assert.equal(canReassignEscalationOwner({ userId: 'x', roleCode: 'admin', permissions: [] }, row), true);
  assert.equal(
    canReassignEscalationOwner(
      { userId: 'o1', roleCode: 'staff', permissions: ['work_engine.escalation.reassign'] },
      row,
    ),
    true,
  );
  assert.equal(canReassignEscalationOwner({ userId: 'o1', roleCode: 'staff', permissions: [] }, row), false);
});

test('escalationSourceLabel maps known sources', () => {
  assert.equal(escalationSourceLabel('sla_breached'), 'SLA breached');
});
